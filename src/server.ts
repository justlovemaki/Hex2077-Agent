import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import cors from '@fastify/cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Hex2077Tool } from './Hex2077Tool.js';
import { ServiceContext, LogService, AIProvider, KnowledgeBaseService, AIResponse, AIMessage } from './base.js';
import { SimpleKnowledgeBaseService } from './KnowledgeBaseService.js';
import { DocumentProcessor } from './DocumentProcessor.js';
import OpenAI from 'openai';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. AI 提供商实现 ---
class MyAIProvider implements AIProvider {
  name = 'AIProvider';
  private client: OpenAI;
  private model: string;
  constructor(apiKey: string, baseURL?: string, model: string = 'gpt-4o') {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }
  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const messages = this.formatMessages(prompt, systemInstruction);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      tools: tools.length > 0 ? (tools as any) : undefined,
      temperature: 0.7,
    });
    return { content: response.choices[0].message.content || '' };
  }

  async *generateStream(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): AsyncIterable<string> {
    const messages = this.formatMessages(prompt, systemInstruction);
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      tools: tools.length > 0 ? (tools as any) : undefined,
      temperature: 0.7,
      stream: true,
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) yield content;
    }
  }

  private formatMessages(prompt: string | AIMessage[], systemInstruction?: string): any[] {
    const messages: any[] = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    if (typeof prompt === 'string') {
      messages.push({ role: 'user', content: prompt });
    } else {
      const formattedHistory = prompt.map(m => ({ role: m.role, content: m.content }));
      messages.push(...formattedHistory);
    }
    return messages;
  }
}

function getAIProvider() {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseURL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.AI_MODEL || 'gpt-4o';
  if (!apiKey) throw new Error('Missing AI_API_KEY');
  return new MyAIProvider(apiKey, baseURL, model);
}

// --- 2. 初始化服务 ---
let kbService: SimpleKnowledgeBaseService;
const docProcessor = new DocumentProcessor();

// --- 3. 启动服务器 ---
const fastify = Fastify({ 
  logger: false,
  trustProxy: true 
});
const uiPath = path.join(__dirname, '../ui');

fastify.register(cors);
fastify.register(fastifyMultipart as any);

const checkAuth = async (request: any, reply: any) => {
  const password = process.env.KB_PASSWORD || 'admin123';
  const authHeader = request.headers['authorization'];
  if (authHeader !== password) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
};

// --- API 路由 (先定义路由，确保优先级高于静态文件) ---

// 对话 API (支持流式输出)
fastify.post('/api/chat', async (request, reply) => {
  let { input, history } = request.body as { input: string; history?: AIMessage[] };
  
  // 限制输入长度
  if (input && input.length > 500) {
    input = input.slice(0, 500);
  }

  const fingerprint = request.headers['x-fingerprint'] || 'unknown';
  const requestId = Math.random().toString(36).substring(2, 7);
  const timestamp = new Date().toLocaleString();
  
  console.log(`\n[${timestamp}] [FINGERPRINT: ${fingerprint}] [RID: ${requestId}] USER: ${input}`);
  
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  try {
    const aiProvider = getAIProvider();
    const context: ServiceContext = { aiProvider, knowledgeBaseService: kbService };
    const tool = new Hex2077Tool(context, { info: (m: string) => console.log(m), error: (m: string) => console.error(m), warn: (m: string) => console.warn(m) });
    
    let fullResponse = '';
    for await (const chunk of tool.streamHandler({ input, history })) {
      if (chunk.type === 'content') {
        fullResponse += chunk.data;
      }
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    const endTimestamp = new Date().toLocaleString();
    const brief = fullResponse.length > 150 ? `${fullResponse.slice(0, 150).replace(/\n/g, ' ')}...` : fullResponse.replace(/\n/g, ' ');
    console.log(`[${endTimestamp}] [FINGERPRINT: ${fingerprint}] [RID: ${requestId}] ASSISTANT: ${brief} (${fullResponse.length} chars)`);
  } catch (err: any) {
    reply.raw.write(`data: ${JSON.stringify({ type: 'content', data: `⚠️ 错误: ${err.message}` })}\n\n`);
  } finally {
    reply.raw.end();
  }
});

// 知识库登录
fastify.post('/api/knowledge/login', async (request, reply) => {
  const { password } = request.body as { password: string };
  const target = process.env.KB_PASSWORD || 'admin123';
  if (password === target) return { success: true };
  reply.status(401).send({ success: false });
});

// 知识库管理
fastify.get('/api/knowledge', { preHandler: checkAuth }, async () => await kbService.listDocuments());

fastify.post('/api/knowledge/upload', { preHandler: checkAuth }, async (request: any, reply: any) => {
  const data = await request.file();
  if (!data) return reply.status(400).send({ error: 'No file uploaded' });
  try {
    const buffer = await data.toBuffer();
    const text = await docProcessor.parse(data.filename, buffer);
    return await kbService.addItem(data.filename, text);
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/api/knowledge', { preHandler: checkAuth }, async (request) => {
  const { title, content } = request.body as { title: string; content: string };
  return await kbService.addItem(title, content);
});

fastify.delete('/api/knowledge/:id', { preHandler: checkAuth }, async (request) => {
  const { id } = request.params as { id: string };
  await kbService.deleteDocument(id);
  return { success: true };
});

// 获取具体板块的全文预览 (修复 404 关键点)
fastify.get('/api/knowledge/part/:docId/:partId', { preHandler: checkAuth }, async (request, reply) => {
  const { docId, partId } = request.params as { docId: string; partId: string };
  try {
    const filePath = path.join(__dirname, '../data/knowledge_store', docId, `${partId}.md`);
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { content };
  } catch (err: any) {
    return reply.status(404).send({ error: 'File not found' });
  }
});

// --- 静态文件路由 ---
fastify.register(fastifyStatic, {
  root: uiPath,
  prefix: '/',
  index: ['index.html'],
});

fastify.get('/', async (req, reply) => reply.sendFile('index.html'));
fastify.get('/knowledge', async (req, reply) => reply.sendFile('knowledge.html'));

const start = async () => {
  try {
    const aiProvider = getAIProvider();
    kbService = new SimpleKnowledgeBaseService(path.join(__dirname, '../data'), aiProvider);
    await kbService.init();
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`\n🚀 何夕2077 已启动: http://localhost:${port}\n`);
  } catch (err: any) {
    console.error(`启动失败: ${err.message}`);
    process.exit(1);
  }
};

start();
