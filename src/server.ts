import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import cors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { SimpleKnowledgeBaseService } from './services/KnowledgeBaseService.js';
import { DocumentProcessor } from './services/DocumentProcessor.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import chatRoutes from './api/chat.js';
import knowledgeRoutes from './api/knowledge.js';
import adminRoutes from './api/admin.js';
import { ErrorHandler } from './utils/ErrorHandler.js';
import { FingerprintRateLimiter } from './utils/RateLimiter.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ 
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
  trustProxy: true,
  disableRequestLogging: true // 禁用 Fastify 默认的请求日志 (incoming request / request completed)
});

// Setup Global Error Handling
ErrorHandler.setup(fastify);

// Initialize Rate Limiter
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX) || 30;
const rateLimitWindow = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;

FingerprintRateLimiter.init({
  windowMs: rateLimitWindow,
  maxRequests: rateLimitMax,
  excludePaths: ['/static', '/favicon.ico', '/assets'],
});

// Add Rate Limit Hook
fastify.addHook('onRequest', FingerprintRateLimiter.getMiddleware());

const uiPath = path.join(__dirname, '../ui');
const dataPath = path.join(__dirname, '../data');

fastify.register(cors);
fastify.register(fastifyMultipart as any);

// Initialize Services
const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
const baseURL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const model = process.env.AI_MODEL || 'gpt-4o';

// Chat Limits
const maxInputLength = Number(process.env.CHAT_MAX_INPUT_LENGTH) || 500;
const maxHistoryRounds = Number(process.env.CHAT_MAX_HISTORY_ROUNDS) || 30;

if (!apiKey) throw new Error('Missing AI_API_KEY');

const aiProvider = new OpenAIProvider(apiKey, baseURL, model);
const kbService = new SimpleKnowledgeBaseService(dataPath, aiProvider, fastify.log);
const docProcessor = new DocumentProcessor();

// Register Routes
fastify.register(chatRoutes, { 
  prefix: '/api', 
  kbService,
  maxInputLength,
  maxHistoryRounds
});
fastify.register(knowledgeRoutes, { prefix: '/api', kbService, docProcessor });
fastify.register(adminRoutes, { prefix: '/api' });

// Static Files
fastify.register(fastifyStatic, {
  root: uiPath,
  prefix: '/',
  index: ['index.html'],
});

fastify.get('/', async (req, reply) => reply.sendFile('index.html'));
fastify.get('/knowledge', async (req, reply) => reply.sendFile('knowledge.html'));

const start = async () => {
  try {
    await kbService.init();
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`何夕2077 已启动: http://localhost:${port}`);
  } catch (err: any) {
    fastify.log.error(`启动失败: ${err.message}`);
    process.exit(1);
  }
};

start();
