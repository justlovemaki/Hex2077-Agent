import { WeChatBot } from '@wechatbot/wechatbot';

let bot: WeChatBot | null = null;

/**
 * 微信 App 渠道插件 (基于 @wechatbot/wechatbot)
 * 为 Hex2077 提供微信 App 接入能力
 */
const wechatAppPlugin = {
  id: 'wechat-app',
  
  async register(api: any) {
    api.registerChannel({ plugin: wechatAppPlugin });
  },

  gateway: {
    /**
     * 启动渠道网关，负责与微信服务器建立连接并处理入站消息
     */
    async startAccount({ cfg, runtime, log, accountId }: any) {
      const config = cfg.channels['wechat-app'] || {};
      
      // 初始化 wechatbot 实例
      bot = new WeChatBot({
        storage: config.storage || 'file',
        storageDir: config.storageDir || './data/wechatbot',
        logLevel: config.logLevel || 'info',
        loginCallbacks: {
          onQrUrl: (url: string) => {
            log.info(`\n[WeChatApp] ==========================================`);
            log.info(`[WeChatApp] 请扫描二维码登录微信:`);
            log.info(`[WeChatApp] URL: ${url}`);
            log.info(`[WeChatApp] ==========================================\n`);
          },
          onScanned: () => log.info('[WeChatApp] 已扫描二维码，等待确认...'),
        },
      });
      
      // 注册消息处理器
      bot.onMessage(async (msg) => {
        // 忽略非文本消息 (目前主要处理文本)
        if (msg.type !== 'text' || !msg.text) return;

        // 忽略 2 分钟之前的过期消息 (防重放、防离线消息堆积)
        const now = Date.now();
        const rawMsg = msg as any;
        
        // 解析消息时间戳 (优先使用更准确的 create_time_ms，兼容 ISO 字符串与数值)
        let msgTs: number = now;
        if (rawMsg.raw?.create_time_ms) {
          msgTs = Number(rawMsg.raw.create_time_ms);
        } else if (typeof rawMsg.timestamp === 'string') {
          msgTs = new Date(rawMsg.timestamp).getTime();
        } else if (typeof rawMsg.timestamp === 'number') {
          msgTs = rawMsg.timestamp;
        } else if (rawMsg.time) {
          msgTs = rawMsg.time * 1000;
        }

        const diff = Math.abs(now - msgTs);
        if (diff > 120 * 1000) {
          log.info(`[WeChatApp] 忽略过期消息: [${msg.userId}] ${msg.text} (偏移: ${Math.round(diff / 1000)}s)`);
          return;
        }

        log.info(`[WeChatApp] 收到消息: [${msg.userId}] ${msg.text} (msgTs: ${msgTs})`);
        
        // 构造标准的入站消息格式，适配 OpenClawChinaAdapter
        const inboundMsg = {
          source: {
            channelId: 'wechat-app',
            userId: msg.userId,
            accountId: accountId || 'default'
          },
          text: msg.text,
          raw: msg
        };
        
        // 分发给核心运行时处理
        try {
          if (runtime.channel?.routing?.match) {
            await runtime.channel.routing.match(inboundMsg);
          } else {
            log.error('[WeChatApp] Runtime 路由接口不可用');
          }
        } catch (err: any) {
          log.error(`[WeChatApp] 处理消息异常: ${err.message}`);
        }
      });

      // 启动机器人
      log.info('[WeChatApp] 正在登录微信...');
      await bot.login();
      await bot.start();
      log.info('[WeChatApp] 微信机器人已成功启动并开始监听消息');
    }
  },

  outbound: {
    /**
     * 发送出站消息 (回复 AI 生成的内容)
     */
    async sendText({ cfg, accountId, to, text }: any) {
      if (!bot) {
        return { ok: false, error: 'Bot not initialized' };
      }
      
      try {
        await bot.send(to, text);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }
  }
};

export default wechatAppPlugin;
export { wechatAppPlugin };
