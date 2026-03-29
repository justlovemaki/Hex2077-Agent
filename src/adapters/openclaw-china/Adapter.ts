import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AIProvider, KnowledgeBaseService, ServiceContext, LogService, HistoryService } from '../../core/base.js';
import { Hex2077Tool } from '../../tools/Hex2077Tool.js';

/**
 * OpenClawChinaAdapter
 * 
 * 一个深度适配层，用于在不使用 OpenClaw 框架的情况下直接运行 openclaw-china 插件。
 */
export class OpenClawChinaAdapter {
  private plugins = new Map<string, any>();
  private aiProvider: AIProvider;
  private kbService: KnowledgeBaseService;
  private historyService?: HistoryService;
  private log: any;
  private config: any;

  constructor(
    private fastify: FastifyInstance,
    config: any,
    aiProvider: AIProvider,
    kbService: KnowledgeBaseService,
    historyService?: HistoryService
  ) {
    this.aiProvider = aiProvider;
    this.kbService = kbService;
    this.historyService = historyService;
    this.log = fastify.log;
    this.config = config;
  }

  public async start() {
    const api = this.createPluginApi();

    for (const channelId in this.config.channels) {
      if (this.config.channels[channelId].enabled) {
        await this.loadAndRegisterPlugin(channelId, api);
      }
    }

    // 启动所有已注册插件的网关 (用于 WebSocket/长连接模式)
    for (const [id, plugin] of this.plugins.entries()) {
      if (plugin.gateway && typeof plugin.gateway.startAccount === 'function') {
        this.log.info(`[OpenClawAdapter] 启动渠道网关: ${id}`);
        // 注意：不要 await，因为部分网关（如钉钉）的 startAccount 会一直运行直到连接关闭
        plugin.gateway.startAccount({
          cfg: this.config,
          runtime: api.runtime,
          log: api.logger,
          accountId: 'default'
        }).catch((err: any) => {
          this.log.error(`[OpenClawAdapter] 渠道网关 ${id} 运行异常: ${err.message}`);
        });
      }
    }
  }

  private createPluginApi(): any {
    return {
      config: this.config,
      logger: {
        info: (m: string) => this.log.info(m),
        warn: (m: string) => this.log.warn(m),
        error: (m: string) => this.log.error(m),
      },
      runtime: this.createRuntime(),
      registerChannel: ({ plugin }: any) => {
        this.log.info(`[OpenClawAdapter] 注册渠道插件: ${plugin.id}`);
        this.plugins.set(plugin.id, plugin);
      },
      registerHttpRoute: (route: any) => {
        this.registerFastifyRoute(route);
      }
    };
  }

  private async loadAndRegisterPlugin(channelId: string, api: any) {
    try {
      let module;
      switch (channelId) {
        case 'dingtalk':
          module = await import('@openclaw-china/dingtalk');
          if (module.setDingtalkRuntime) module.setDingtalkRuntime(api.runtime);
          break;
        case 'wecom-app':
          module = await import('@openclaw-china/wecom-app');
          if (module.setWecomAppRuntime) module.setWecomAppRuntime(api.runtime);
          break;
        case 'qqbot':
          module = await import('@openclaw-china/qqbot');
          if (module.setQQBotRuntime) module.setQQBotRuntime(api.runtime);
          break;
        case 'wechat-mp':
          module = await import('@openclaw-china/wechat-mp');
          if (module.setWechatMpRuntime) module.setWechatMpRuntime(api.runtime);
          break;
        case 'feishu-china':
          module = await import('@openclaw-china/feishu-china');
          if (module.setFeishuRuntime) module.setFeishuRuntime(api.runtime);
          break;
        case 'wecom':
          module = await import('@openclaw-china/wecom');
          if (module.setWecomRuntime) module.setWecomRuntime(api.runtime);
          break;
        case 'wecom-kf':
          module = await import('@openclaw-china/wecom-kf');
          if (module.setWecomKfRuntime) module.setWecomKfRuntime(api.runtime);
          break;
        case 'wechat-app':
          module = await import('./plugins/wechat-app.js');
          break;
        default:
          return;
      }

      const plugin = module.default || module;
      if (plugin && typeof plugin.register === 'function') {
        await plugin.register(api);
      }
    } catch (err: any) {
      this.log.error(`[OpenClawAdapter] 加载插件 ${channelId} 失败: ${err.message}`);
    }
  }

  private createRuntime() {
    // 模拟 OpenClaw 核心运行时接口
    const runtime: any = {
      log: (m: string) => this.log.info(m),
      error: (m: string) => this.log.error(m),
      channel: {
        routing: {
          match: async (msg: any) => this.handleInbound(msg),
          resolveAgentRoute: (params: any) => ({
            sessionKey: `session:${params.peer.id}`,
            accountId: params.accountId || 'default',
            agentId: 'hexi'
          })
        },
        reply: {
          // 统一使用此内部方法处理来自插件的派发请求
          dispatchReply: async (params: any) => this.unifiedDispatch(params),
          dispatchReplyFromConfig: async (params: any) => this.unifiedDispatch(params),
          dispatchReplyWithDispatcher: async (params: any) => this.unifiedDispatch(params),
          dispatchReplyWithBufferedBlockDispatcher: async (params: any) => this.unifiedDispatch(params),
          
          createReplyDispatcher: (options: any) => ({
            dispatcher: { deliver: options.deliver },
            replyOptions: {},
            markDispatchIdle: () => {}
          }),
          createReplyDispatcherWithTyping: (options: any) => ({
            dispatcher: { deliver: options.deliver },
            replyOptions: {},
            markDispatchIdle: () => {}
          }),
          finalizeInboundContext: (ctx: any) => ctx,
          resolveHumanDelayConfig: () => undefined
        }
      }
    };
    return runtime;
  }

  /**
   * 统一处理来自 OpenClaw 插件的所有派发请求
   * 这是连接插件(Channel)与 AI 逻辑(Hex2077)的核心桥梁
   */
  private async unifiedDispatch(params: any) {
    const ctx = params.ctx;
    
    // 1. 提取消息文本
    const text = params.text || ctx?.BodyForAgent || ctx?.Body || ctx?.RawBody;
    
    // 2. 提取并归一化来源信息 (Source)
    const source = params.source || {
      channelId: ctx?.OriginatingChannel || 'unknown',
      userId: ctx?.SenderId,
      groupId: ctx?.ChatType === 'group' ? ctx?.GroupSubject : undefined,
      to: ctx?.OriginatingTo,
      accountId: ctx?.AccountId || 'default'
    };

    // 3. 构造 Dispatcher (用于将回复传回插件)
    // 优先使用显式传递的 dispatcher，其次是从 options 中构造
    const dispatcher = params.dispatcher || (params.dispatcherOptions?.deliver ? {
      deliver: params.dispatcherOptions.deliver,
      markDispatchIdle: params.dispatcherOptions.markDispatchIdle || (() => {})
    } : undefined);

    // 4. 判断逻辑：是有新消息输入，还是纯发送回复
    // 如果有文本输入且不是 pure-reply 模式，则进入 AI 处理流程
    if (text && !params.isReplyOnly) {
      return this.handleInboundWithDispatcher({ source, text }, dispatcher);
    }
    
    // 否则，这可能是一个主动发送回复的请求（如 AI 已经思考完后异步调用的发送）
    return this.handleOutbound({ source, text, ctx, ...params });
  }

  private async handleInbound(msg: any) {
    return this.handleInboundWithDispatcher(msg);
  }

  private async handleInboundWithDispatcher(msg: any, dispatcher?: any) {
    if (!msg.text) {
      return { handled: false, counts: { final: 0 } };
    }

    const channelId = msg.source?.channelId || 'unknown';
    this.log.info(`[OpenClawAdapter] 收到消息: [${channelId}] ${msg.text}`);

    // 0. 获取会话 ID
    const fingerprint = msg.source?.channelId || 'unknown';
    const sessionId = msg.source?.userId || msg.source?.groupId || msg.source?.to || 'unknown';

    // 0.5 检查是否为清空历史命令
    const cleanText = msg.text.trim().toLowerCase();
    if (['/clear', '清空', '重置', 'clear'].includes(cleanText)) {
      if (this.historyService) {
        this.historyService.clearHistory(sessionId);
        this.log.info(`[OpenClawAdapter] 已清空会话历史: ${sessionId}`);
        await this.handleOutbound({
          source: msg.source,
          text: '✅ 已成功清空当前会话历史。'
        });
        return { handled: true, counts: { final: 1 } };
      }
    }

    // 先回复 "思考中..." 表示已收到消息
    try {
      if (dispatcher && typeof dispatcher.deliver === 'function') {
        // 使用 kind: 'final' 确保即使配置了 replyFinalOnly: true 也能发送
        await dispatcher.deliver({ text: '思考中...' }, { kind: 'final' });
      } else {
        await this.handleOutbound({
          source: msg.source,
          text: '思考中...'
        });
      }
    } catch (err: any) {
      this.log.warn(`[OpenClawAdapter] 发送确认消息失败: ${err.message}`);
    }

    try {
      // 0.7 获取历史记录
      const history = this.historyService?.getHistory(sessionId) || [];

      // 1. 初始化 Hex2077Tool
      const context: ServiceContext = { 
        aiProvider: this.aiProvider, 
        knowledgeBaseService: this.kbService,
        historyService: this.historyService
      };
      const logger: LogService = { 
        info: (m) => this.log.info(m), 
        error: (m) => this.log.error(m), 
        warn: (m) => this.log.warn(m) 
      };
      const tool = new Hex2077Tool(context, logger);

      // 2. 调用 Hex2077 分身逻辑处理
      const result = await tool.handler({ 
        input: msg.text, 
        history: history,
        fingerprint,
        sessionId
      });

      // 2.5 记录历史 (如果启用了历史服务)
      if (this.historyService) {
        this.historyService.pushMessage(sessionId, { role: 'user', content: msg.text });
        this.historyService.pushMessage(sessionId, { role: 'assistant', content: result.content });
      }

      // 3. 发送回复
      if (dispatcher && typeof dispatcher.deliver === 'function') {
        this.log.info(`[OpenClawAdapter] 使用插件 Dispatcher 发送回复`);
        await dispatcher.deliver({ text: result.content }, { kind: 'final' });
      } else {
        this.log.info(`[OpenClawAdapter] 使用默认出站适配器发送回复`);
        await this.handleOutbound({
          source: msg.source,
          text: result.content
        });
      }

      // 通知派发器已完成，以便清除 "正在输入" 等状态
      if (dispatcher && typeof dispatcher.markDispatchIdle === 'function') {
        dispatcher.markDispatchIdle();
      }

      return { handled: true, queuedFinal: false, counts: { final: 1 } };
    } catch (err: any) {
      this.log.error(`[OpenClawAdapter] 业务处理失败: ${err.message}`);
      return { handled: false, counts: { final: 0 } };
    }
  }

  private async handleOutbound(params: any) {
    if (!params) return { success: false };
    
    let { source, text, ctx } = params;

    // 如果没有 source 但有 ctx，从 ctx 中恢复 source
    if (!source && ctx) {
      source = ctx.source || {
        channelId: ctx.OriginatingChannel || 'unknown',
        userId: ctx.SenderId,
        groupId: ctx.ChatType === 'group' ? ctx.GroupSubject : undefined,
        to: ctx.OriginatingTo,
        accountId: ctx.AccountId || 'default'
      };
    }
    
    // 如果没有 text 但有 ctx，从 ctx 中恢复 text
    if (!text && ctx) {
      text = ctx.Body || ctx.RawBody || ctx.text;
    }

    if (!source || !text) {
      this.log.warn(`[OpenClawAdapter] handleOutbound: 缺少 source 或 text`, { hasSource: !!source, hasText: !!text });
      return { success: false };
    }
    
    const channelId = source.channelId;
    const plugin = this.plugins.get(channelId);

    if (plugin && plugin.outbound) {
      try {
        // 尝试使用插件的出站适配器发送
        this.log.info(`[OpenClawAdapter] 正在通过插件 ${channelId} 发送出站消息...`);
        const result = await plugin.outbound.sendText({
          cfg: this.config,
          accountId: source.accountId || 'default',
          to: source.userId || source.groupId || source.to,
          text: text
        });
        
        if (result && result.ok === false) {
          this.log.error(`[OpenClawAdapter] 插件发送失败: ${result.error || result.message || '未知错误'}`);
          return { success: false };
        }
        
        this.log.info(`[OpenClawAdapter] 插件发送成功`);
        return { success: true };
      } catch (err: any) {
        this.log.error(`[OpenClawAdapter] 出站消息发送失败 (异常): ${err.message}`);
      }
    } else {
      this.log.warn(`[OpenClawAdapter] 未找到插件或出站适配器: ${channelId}`);
    }
    return { success: false };
  }

  private registerFastifyRoute(route: any) {
    const method = route.method ? (Array.isArray(route.method) ? route.method : [route.method]) : ['GET', 'POST'];
    this.fastify.route({
      method: method as any,
      url: route.path,
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          // 适配 OpenClaw 插件通常需要的 Node.js 原生 req/res 接口
          // 同时保留对原 body/query 模式的兼容（如果插件需要）
          const result = await route.handler(request.raw, reply.raw, request.body, request.query);
          
          // 如果插件处理函数没有直接结束响应（例如返回了数据），则由 Fastify 发送
          if (!reply.raw.writableEnded && result) {
            return result;
          }
          if (!reply.raw.writableEnded) {
            return 'OK';
          }
        } catch (err: any) {
          this.log.error(`[OpenClawAdapter] 路由处理异常 [${route.path}]: ${err.message}`);
          if (!reply.raw.writableEnded) {
            return reply.status(500).send({ error: 'Internal Error' });
          }
        }
      }
    });
  }
}
