import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function knowledgeRoutes(fastify: FastifyInstance, options: { kbService: any; docProcessor: any }) {
  const { kbService, docProcessor } = options;
  const SECRET = process.env.JWT_SECRET || process.env.KB_PASSWORD || 'hex2077-secret-key';

  const checkAuth = async (request: any, reply: any) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      reply.status(401).send({ error: 'Missing authorization header' });
      return;
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      jwt.verify(token, SECRET);
    } catch (err) {
      reply.status(401).send({ error: 'Invalid or expired token' });
      return;
    }
  };

  fastify.post('/knowledge/login', async (request, reply) => {
    const { password } = request.body as { password: string };
    const target = process.env.KB_PASSWORD || 'admin123';
    
    if (password === target) {
      const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '24h' });
      return { success: true, token };
    }
    
    reply.status(401).send({ success: false, error: 'Invalid password' });
  });

  fastify.get('/knowledge', { preHandler: checkAuth }, async () => await kbService.listDocuments());

  fastify.post('/knowledge/upload', { preHandler: checkAuth }, async (request: any, reply: any) => {
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

  fastify.post('/knowledge', { preHandler: checkAuth }, async (request) => {
    const { title, content } = request.body as { title: string; content: string };
    return await kbService.addItem(title, content);
  });

  fastify.delete('/knowledge/:id', { preHandler: checkAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await kbService.deleteDocument(id);
    return { success: true };
  });

  fastify.get('/knowledge/part/:docId/:partId', { preHandler: checkAuth }, async (request, reply) => {
    const { docId, partId } = request.params as { docId: string; partId: string };
    try {
      // Note: adjust path according to new structure
      const filePath = path.join(__dirname, '../../data/knowledge_store', docId, `${partId}.md`);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { content };
    } catch (err: any) {
      return reply.status(404).send({ error: 'File not found' });
    }
  });
}
