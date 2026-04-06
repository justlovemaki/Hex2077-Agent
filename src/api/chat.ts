import { FastifyInstance } from 'fastify';
import { Hex2077Tool } from '../tools/Hex2077Tool.js';
import { ServiceContext, AIMessage, LogService } from '../core/base.js';
import { OpenAIProvider } from '../providers/OpenAIProvider.js';
import { FingerprintHelper } from '../utils/Fingerprint.js';

export default async function chatRoutes(fastify: FastifyInstance, options: { 
  kbService: any;
  historyService?: any;
  personaService?: any;
  maxInputLength?: number;
  maxHistoryRounds?: number;
}) {
  const { 
    kbService, 
    historyService,
    personaService,
    maxInputLength = 500, 
    maxHistoryRounds = 30 
  } = options;

  function getAIProvider() {
    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseURL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.AI_MODEL || 'gpt-4o';
    if (!apiKey) throw new Error('Missing AI_API_KEY');
    return new OpenAIProvider(apiKey, baseURL, model);
  }

  fastify.get('/config', async (request, reply) => {
    const config = personaService?.getConfig();
    return config || { 
      title: '何夕', 
      title_suffix: '2077', 
      greeting: '你好，我是何夕2077。我更喜欢聊点透彻的：不管是我的项目背景、AI 日报背后的逻辑，还是具体的合作可能。如果你有正在纠结的技术卡点，或者只想找个懂行的人聊聊，我都在。你想从哪个话题开始？',
      placeholder: '聊聊技术卡点、合作可能或我的背景...'
    };
  });

  fastify.post('/chat', async (request, reply) => {
    const { input, history = [], ru } = request.body as { input: string; history?: AIMessage[]; ru?: string };
    
    let processedInput = input || '';
    if (processedInput.length > maxInputLength) {
      processedInput = processedInput.slice(0, maxInputLength);
    }

    const fingerprint = FingerprintHelper.getFingerprint(request);
    const sessionId = (request.headers['x-session-id'] as string) || 'unknown';
    const requestId = Math.random().toString(36).substring(2, 7);
    const showDebug = process.env.DEBUG_LOGS === 'true';
    
    if (showDebug) fastify.log.info({ fingerprint, sessionId, requestId, input: processedInput }, 'User message received');
    
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    // 校验 history 轮数（仅计算用户对话次数），如果超过限制，以 Stream 结构返回报错提示
    const userRounds = (history || []).filter(m => m.role === 'user').length;
    if (userRounds >= maxHistoryRounds) {
      reply.raw.write(`data: ${JSON.stringify({ 
        type: 'content', 
        data: `⚠️ 历史对话记录已达上限(${maxHistoryRounds}轮)，为了保证回复质量，请清理对话后再试。` 
      })}\n\n`);
      reply.raw.end();
      return;
    }

    try {
      const aiProvider = getAIProvider();
      const context: ServiceContext = { 
        aiProvider, 
        knowledgeBaseService: kbService,
        historyService,
        personaService
      };
      const logger: LogService = { 
        info: (m) => fastify.log.info(m), 
        error: (m) => fastify.log.error(m), 
        warn: (m) => fastify.log.warn(m) 
      };
      const tool = new Hex2077Tool(context, logger);
      
      let fullResponse = '';
      for await (const chunk of tool.streamHandler({ 
        input: processedInput, 
        history, 
        fingerprint, 
        sessionId,
        ru
      })) {
        if (chunk.type === 'strategy' && showDebug) {
          fastify.log.info({ requestId, strategy: chunk.data }, 'Strategy identified');
        }
        if (chunk.type === 'content') fullResponse += chunk.data;
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      
      if (showDebug) fastify.log.info({ requestId, responseLength: fullResponse.length }, 'Assistant response completed');
    } catch (err: any) {
      fastify.log.error({ requestId, error: err.message }, 'Chat error');
      reply.raw.write(`data: ${JSON.stringify({ type: 'content', data: `⚠️ 错误: ${err.message}` })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  // --- OpenAI 兼容协议层 (/v1/chat/completions) ---
  fastify.post('/v1/chat/completions', async (request, reply) => {
    const body = request.body as any;
    const messages = body.messages || [];
    const stream = body.stream === true;
    
    if (messages.length === 0) {
      return reply.status(400).send({ error: "Messages are required" });
    }

    const lastMessage = messages[messages.length - 1];
    const input = lastMessage.content || '';
    const history = messages.slice(0, -1);
    
    const fingerprint = FingerprintHelper.getFingerprint(request);
    const sessionId = (request.headers['x-session-id'] as string) || 'openai-compat';
    const model = body.model || 'hex2077';
    const requestId = `chatcmpl-${Math.random().toString(36).substring(2, 11)}`;

    try {
      const aiProvider = getAIProvider();
      const context: ServiceContext = { 
        aiProvider, 
        knowledgeBaseService: kbService,
        historyService,
        personaService
      };
      const logger: LogService = { 
        info: (m) => fastify.log.info(m), 
        error: (m) => fastify.log.error(m), 
        warn: (m) => fastify.log.warn(m) 
      };
      const tool = new Hex2077Tool(context, logger);

      if (stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        for await (const chunk of tool.streamHandler({ input, history, fingerprint, sessionId })) {
          if (chunk.type === 'content') {
            const openaiChunk = {
              id: requestId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{
                index: 0,
                delta: { content: chunk.data },
                finish_reason: null
              }]
            };
            reply.raw.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
          }
        }
        
        // Final chunk
        reply.raw.write(`data: ${JSON.stringify({
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      } else {
        let fullContent = '';
        for await (const chunk of tool.streamHandler({ input, history, fingerprint, sessionId })) {
          if (chunk.type === 'content') fullContent += chunk.data;
        }
        
        return {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: fullContent },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 0, // Placeholder
            completion_tokens: 0,
            total_tokens: 0
          }
        };
      }
    } catch (err: any) {
      fastify.log.error({ requestId, error: err.message }, 'OpenAI Compat Error');
      if (stream) {
        reply.raw.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
        reply.raw.end();
      } else {
        reply.status(500).send({ error: { message: err.message } });
      }
    }
  });
}
