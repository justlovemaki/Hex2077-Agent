import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import cors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { SimpleKnowledgeBaseService } from './services/KnowledgeBaseService.js';
import { DocumentProcessor } from './services/DocumentProcessor.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { MemoryHistoryService } from './services/HistoryService.js';
import { PersonaService } from './services/PersonaService.js';
import chatRoutes from './api/chat.js';
import knowledgeRoutes from './api/knowledge.js';
import adminRoutes from './api/admin.js';
import { OpenClawChinaAdapter } from './adapters/openclaw-china/Adapter.js';
import fs from 'node:fs';
import { ErrorHandler } from './utils/ErrorHandler.js';
import { FingerprintRateLimiter } from './utils/RateLimiter.js';
import 'dotenv/config';

// 强制设置时区为东 8 区 (北京时间)
process.env.TZ = 'Asia/Shanghai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ 
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  },
  trustProxy: true,
  disableRequestLogging: true // 禁用 Fastify 默认的请求日志 (incoming request / request completed)
});

// Setup Global Error Handling
ErrorHandler.setup(fastify);

// 支持微信及其他渠道的 XML/Text 推送 (不预先解析 body，交给插件处理流)
fastify.addContentTypeParser(['text/xml', 'application/xml', 'text/plain'], (request, payload, done) => {
  done(null, payload);
});

// Initialize Rate Limiter
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX) || 30;
const rateLimitWindow = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;

FingerprintRateLimiter.init({
  windowMs: rateLimitWindow,
  maxRequests: rateLimitMax,
  excludePaths: ['/static', '/favicon.ico', '/assets', '/api/knowledge', '/api/wiki', '/api/admin', '/knowledge'],
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
const historyService = new MemoryHistoryService(maxHistoryRounds);
const docProcessor = new DocumentProcessor();
const personaService = new PersonaService(aiProvider, dataPath);

// Register Routes
fastify.register(chatRoutes, { 
  prefix: '/api', 
  kbService,
  historyService,
  personaService,
  maxInputLength,
  maxHistoryRounds
});
fastify.register(knowledgeRoutes, { prefix: '/api', kbService, docProcessor });
fastify.register(adminRoutes, { prefix: '/api', personaService });

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
    
    // 初始化 OpenClaw China 适配器
    if (process.env.OPENCLAW_ENABLED === 'true') {
      try {
        const openclawConfigPath = path.join(dataPath, 'openclaw.json');
        let openclawConfig: any = { channels: {} };
        if (fs.existsSync(openclawConfigPath)) {
          openclawConfig = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
        }

        // 环境变量覆盖逻辑
        const mergeEnv = (channelId: string, mapping: Record<string, string>, envEnabled: string) => {
          if (!openclawConfig.channels[channelId]) openclawConfig.channels[channelId] = { enabled: false };
          
          for (const [key, envKey] of Object.entries(mapping)) {
            if (process.env[envKey]) {
              openclawConfig.channels[channelId][key] = process.env[envKey];
              // 自动启用包含必需凭据的渠道 (只要没显式关掉)
              if (['clientId', 'appId', 'corpId', 'appSecret', 'clientSecret', 'corpSecret', 'botId', 'secret', 'token'].includes(key)) {
                if (process.env[envEnabled] !== 'false') {
                  openclawConfig.channels[channelId].enabled = true;
                }
              }
            }
          }

          // 显式开关具有最高优先级
          if (process.env[envEnabled] === 'true') {
            openclawConfig.channels[channelId].enabled = true;
          } else if (process.env[envEnabled] === 'false') {
            openclawConfig.channels[channelId].enabled = false;
          }
        };

        mergeEnv('feishu-china', { 
          appId: 'FEISHU_APP_ID', 
          appSecret: 'FEISHU_APP_SECRET',
          connectionMode: 'FEISHU_CONNECTION_MODE',
          sendMarkdownAsCard: 'FEISHU_SEND_MARKDOWN_AS_CARD'
        }, 'FEISHU_ENABLED');

        mergeEnv('dingtalk', { 
          clientId: 'DINGTALK_CLIENT_ID', 
          clientSecret: 'DINGTALK_CLIENT_SECRET',
          connectionMode: 'DINGTALK_CONNECTION_MODE'
        }, 'DINGTALK_ENABLED');

        mergeEnv('qqbot', { 
          appId: 'QQBOT_APP_ID', 
          clientSecret: 'QQBOT_CLIENT_SECRET' 
        }, 'QQBOT_ENABLED');

        mergeEnv('wecom', { 
          botId: 'WECOM_BOT_ID',
          receiveId: 'WECOM_BOT_RECEIVE_ID',
          secret: 'WECOM_BOT_SECRET',
          token: 'WECOM_BOT_TOKEN',
          encodingAESKey: 'WECOM_BOT_AES_KEY',
          webhookPath: 'WECOM_BOT_WEBHOOK_PATH',
          mode: 'WECOM_BOT_MODE'
        }, 'WECOM_ENABLED');

        mergeEnv('wechat-mp', { 
          appId: 'WECHAT_MP_APP_ID', 
          appSecret: 'WECHAT_MP_APP_SECRET',
          token: 'WECHAT_MP_TOKEN',
          encodingAESKey: 'WECHAT_MP_AES_KEY',
          webhookPath: 'WECHAT_MP_WEBHOOK_PATH',
          messageMode: 'WECHAT_MP_MESSAGE_MODE',
          replyMode: 'WECHAT_MP_REPLY_MODE'
        }, 'WECHAT_MP_ENABLED');

        mergeEnv('wecom-app', { 
          corpId: 'WECOM_APP_CORP_ID', 
          corpSecret: 'WECOM_APP_CORP_SECRET',
          agentId: 'WECOM_APP_AGENT_ID',
          token: 'WECOM_APP_TOKEN',
          encodingAESKey: 'WECOM_APP_AES_KEY',
          webhookPath: 'WECOM_APP_WEBHOOK_PATH'
        }, 'WECOM_APP_ENABLED');

        mergeEnv('wecom-kf', { 
          corpId: 'WECOM_KF_CORP_ID', 
          corpSecret: 'WECOM_KF_CORP_SECRET',
          openKfId: 'WECOM_KF_OPEN_KFID',
          token: 'WECOM_KF_TOKEN',
          encodingAESKey: 'WECOM_KF_AES_KEY',
          webhookPath: 'WECOM_KF_WEBHOOK_PATH'
        }, 'WECOM_KF_ENABLED');

        mergeEnv('wechat-app', { 
          storage: 'WECHAT_APP_STORAGE', 
          storageDir: 'WECHAT_APP_STORAGE_DIR',
          logLevel: 'WECHAT_APP_LOG_LEVEL'
        }, 'WECHAT_APP_ENABLED');

        const openclawAdapter = new OpenClawChinaAdapter(fastify, openclawConfig, aiProvider, kbService, historyService);
        await openclawAdapter.start();
        fastify.log.info('OpenClaw China 适配器已加载');
      } catch (err: any) {
        fastify.log.error(`加载 OpenClaw 配置失败: ${err.message}`);
      }
    }

    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`何夕2077 已启动: http://localhost:${port}`);
  } catch (err: any) {
    fastify.log.error(`启动失败: ${err.message}`);
    process.exit(1);
  }
};

start();
