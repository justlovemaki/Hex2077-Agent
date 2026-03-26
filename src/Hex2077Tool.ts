import { BaseTool, ServiceContext, LogService, AIMessage } from './base.js';
import { persona } from './prompts/persona.js';
import { style } from './prompts/style.js';
import { knowledge } from './prompts/knowledge.js';
import { projects } from './prompts/projects.js';
import { strategy } from './prompts/strategy.js';
import { cooperation } from './prompts/cooperation.js';

export class Hex2077Tool extends BaseTool {
  readonly id = 'hex2077_persona';
  readonly name = '何夕2077 分身 (优化版)';
  readonly description = '调用 何夕2077 的 AI 分身，采用优化的高效编排架构。';
  readonly parameters = {
    type: 'object',
    properties: {
      input: { type: 'string', description: '对话输入内容' },
      history: { type: 'array', items: { type: 'object' }, description: '历史对话记录' }
    },
    required: ['input']
  };

  private logger: LogService;
  private context: ServiceContext;

  constructor(context: ServiceContext, logger: LogService) {
    super();
    this.context = context;
    this.logger = logger;
  }

  async handler(args: { input: string; history?: AIMessage[] }): Promise<{ strategy: string; content: string; steps: any[] }> {
    const results = [];
    let content = '';
    let strategyTag = '';
    for await (const chunk of this.streamHandler(args)) {
      if (chunk.type === 'status') results.push(chunk.data);
      if (chunk.type === 'content') content += chunk.data;
      if (chunk.type === 'strategy') strategyTag = chunk.data;
    }
    return { strategy: strategyTag, content, steps: results };
  }

  async *streamHandler(args: { input: string; history?: AIMessage[] }): AsyncGenerator<{ type: 'status' | 'content' | 'strategy' | 'done', data: any }> {
    let { input, history = [] } = args;
    input = input.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();

    yield { type: 'status', data: { agent: 'System', message: '清理输入...' } };

    const aiProvider = this.context.aiProvider;
    if (!aiProvider) throw new Error('AI Provider not initialized');

    // 构造内置工具 (如 Google Search, URL Context)
    const builtinTools: any[] = [{ google_search: {} }];
    builtinTools.push({ url_context: {} });

    const fullPrompt: AIMessage[] = [...history, { role: 'user', content: input }];

    try {
      // --- 1. 意图策略识别 (Strategist) ---
      yield { type: 'status', data: { agent: 'Response Strategist', message: '正在分析意图...' } };
      const strategyPrompt = `${strategy}\n请判断问题类型（A-F），并以 "[Strategy: 类型X]" 格式输出。`;
      const strategyRes = await aiProvider.generateContent(fullPrompt, builtinTools, strategyPrompt);
      const strategyMatch = strategyRes.content?.match(/\[Strategy: 类型\s*([A-F])\s*\]/);
      const strategyTag = strategyMatch ? `[Strategy: 类型${strategyMatch[1]}]` : '[Strategy: 类型E]';
      const typeCode = strategyMatch ? strategyMatch[1] : 'E';
      yield { type: 'strategy', data: strategyTag };
      yield { type: 'status', data: { agent: 'Response Strategist', message: `识别到策略: ${strategyTag}` } };

      // --- 2. 动态分支：闲聊/简单回应直接退出 ---
      if (typeCode === 'E') {
        yield { type: 'status', data: { agent: 'Identity Shaper', message: '正在以 何夕2077 风格快速响应...' } };
        const chatPrompt = `${persona}\n${style}\n任务：以 何夕2077 风格直接回复用户的闲聊，不要废话。`;
        
        if (aiProvider.generateStream) {
          const stream = aiProvider.generateStream(fullPrompt, builtinTools, chatPrompt);
          for await (const chunk of stream) {
            yield { type: 'content', data: chunk };
          }
        } else {
          const chatRes = await aiProvider.generateContent(fullPrompt, builtinTools, chatPrompt);
          yield { type: 'content', data: chatRes.content.replace(/\[Strategy: 类型.\]/g, '').trim() };
        }
        yield { type: 'done', data: {} };
        return;
      }

      // --- 3. 并行干货提取 (Knowledge & Project) ---
      yield { type: 'status', data: { agent: 'Multi-Agent', message: '正在并行提取知识库与项目数据...' } };
      const knowledgeTask = async () => {
        if (!['A', 'B', 'C', 'D', 'F'].includes(typeCode)) return { content: 'N/A' };
        const kbRes = await this.context.knowledgeBaseService.queryKnowledge(input, { limit: 3 });
        if (!kbRes) return { content: 'No specific knowledge found' };
        const knowledgePrompt = `${knowledge}\n\n参考背景：\n${kbRes}`;
        return aiProvider.generateContent(fullPrompt, [], knowledgePrompt);
      };

      const projectTask = async () => {
        const isProjectQuery = input.includes('项目') || input.includes('做过') || input.includes('经历') || input.includes('作品');
        if (!['A', 'F'].includes(typeCode) && !isProjectQuery) return { content: 'N/A' };
        return aiProvider.generateContent(fullPrompt, [], projects);
      };

      const [knowledgeRes, projectRes] = await Promise.all([knowledgeTask(), projectTask()]);
      yield { type: 'status', data: { agent: 'Knowledge Expert', message: '知识库数据已就绪' } };
      yield { type: 'status', data: { agent: 'Project Archivist', message: '项目信息已就绪' } };

      // --- 4. 角色合并：身份塑造 (Identity Shaper) ---
      yield { type: 'status', data: { agent: 'Identity Shaper', message: '正在合并事实并重塑风格...' } };
      const identityPrompt = `
${persona}
${style}
${typeCode === 'F' ? cooperation : ''}

任务：基于以下事实，以 何夕2077 的身份撰写回复。
要求：
1. 专业的亲和力（ISTJ）：删除 AI 废话，但保持表达的温度。
2. 激发欲望：通过深度洞察和反问，引导用户继续深入探讨。
3. 逻辑严密：以事实为准，提供有条理的、启发性的信息。
${typeCode === 'F' ? '4. 商务对接：专业、温和且高效地引导对方进一步合作。' : ''}

收集到的事实：
${knowledgeRes.content}
${projectRes.content}
`;
      
      const finalInput = `针对用户输入 "${input}"，整合事实并以你的语感回复。`;
      if (aiProvider.generateStream) {
        const stream = aiProvider.generateStream(finalInput, builtinTools, identityPrompt);
        for await (const chunk of stream) {
          yield { type: 'content', data: chunk };
        }
      } else {
        const finalRes = await aiProvider.generateContent(finalInput, builtinTools, identityPrompt);
        yield { type: 'content', data: finalRes.content.replace(/\[Strategy: 类型.\]/g, '').trim() };
      }

      yield { type: 'done', data: {} };
    } catch (error: any) {
      this.logger.error(`[Hex2077Tool] ERROR: ${error.message}`);
      throw error;
    }
  }
}
