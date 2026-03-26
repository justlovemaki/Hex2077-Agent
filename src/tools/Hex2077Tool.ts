import { BaseTool, ServiceContext, LogService, AIMessage, AIProvider } from '../core/base.js';
import { persona } from '../prompts/persona.js';
import { style } from '../prompts/style.js';
import { knowledge } from '../prompts/knowledge.js';
import { projects } from '../prompts/projects.js';
import { strategy } from '../prompts/strategy.js';
import { cooperation } from '../prompts/cooperation.js';
import { antiHallucination } from '../prompts/antiHallucination.js';
import { AIHelper } from '../utils/AIHelper.js';

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
    const results: any[] = [];
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
    input = AIHelper.cleanInput(input);

    const aiProvider = this.context.aiProvider;
    if (!aiProvider) throw new Error('AI Provider not initialized');

    const fullPrompt: AIMessage[] = [...history, { role: 'user', content: input }];

    try {
      // --- 1. 意图策略识别 (Strategist) ---
      yield { type: 'status' as const, data: { agent: 'Response Strategist', message: '正在分析意图...' } };
      const { typeCode, strategyTag } = await this.identifyStrategy(aiProvider, fullPrompt);
      yield { type: 'strategy' as const, data: strategyTag };
      yield { type: 'status' as const, data: { agent: 'Response Strategist', message: `识别到策略: ${strategyTag}` } };

      // --- 2. 动态分支：闲聊/简单回应直接退出 ---
      if (typeCode === 'E') {
        yield* this.handleSimpleChat(aiProvider, fullPrompt);
        yield { type: 'done' as const, data: {} };
        return;
      }

      // --- 3. 并行干货提取 (Knowledge & Project) ---
      yield { type: 'status' as const, data: { agent: 'Multi-Agent', message: '正在并行提取知识库与项目数据...' } };
      const facts = await this.extractFacts(aiProvider, typeCode, input, fullPrompt);

      // --- 4. 角色合并：身份塑造 (Identity Shaper) ---
      yield { type: 'status' as const, data: { agent: 'Identity Shaper', message: '正在合并事实并重塑风格...' } };
      yield* this.generateFinalResponse(aiProvider, typeCode, input, facts);

      yield { type: 'done' as const, data: {} };
    } catch (error: any) {
      this.logger.error(`[Hex2077Tool] ERROR: ${error.message}`);
      throw error;
    }
  }

  private async identifyStrategy(aiProvider: AIProvider, fullPrompt: AIMessage[]): Promise<{ typeCode: string, strategyTag: string }> {
    const builtinTools = [{ google_search: {} }, { url_context: {} }];
    const strategyPrompt = `${strategy}\n请判断问题类型（A-F），并以 "[Strategy: 类型X]" 格式输出。`;
    const strategyRes = await aiProvider.generateContent(fullPrompt, builtinTools, strategyPrompt);
    const strategyMatch = strategyRes.content?.match(/\[Strategy: 类型\s*([A-F])\s*\]/);
    const typeCode = strategyMatch ? strategyMatch[1] : 'E';
    return { 
      typeCode, 
      strategyTag: `[Strategy: 类型${typeCode}]` 
    };
  }

  private async *handleSimpleChat(aiProvider: AIProvider, fullPrompt: AIMessage[]): AsyncGenerator<{ type: 'status' | 'content' | 'strategy' | 'done', data: any }> {
    yield { type: 'status' as const, data: { agent: 'Identity Shaper', message: '正在以 何夕2077 风格快速响应...' } };
    const chatPrompt = `
${persona}
${style}
${antiHallucination}

任务：以 何夕2077 风格直接回复用户的闲聊，不要废话。`;
    const builtinTools = [{ google_search: {} }, { url_context: {} }];
    
    if (aiProvider.generateStream) {
      const stream = aiProvider.generateStream(fullPrompt, builtinTools, chatPrompt);
      for await (const chunk of stream) yield { type: 'content' as const, data: chunk };
    } else {
      const chatRes = await aiProvider.generateContent(fullPrompt, builtinTools, chatPrompt);
      yield { type: 'content' as const, data: chatRes.content.replace(/\[Strategy: 类型.\]/g, '').trim() };
    }
  }

  private async extractFacts(aiProvider: AIProvider, typeCode: string, input: string, fullPrompt: AIMessage[]): Promise<string> {
    const kbTask = async () => {
      if (!['A', 'B', 'C', 'D', 'F'].includes(typeCode)) return 'N/A';
      const kbRes = await this.context.knowledgeBaseService.queryKnowledge(input, { limit: 3 });
      if (!kbRes) return 'No specific knowledge found in user uploads.';
      const kbPrompt = `${knowledge}\n\n任务：基于以下从用户私有知识库中检索到的内容，提取并总结与用户问题相关的干货。\n参考背景：\n${kbRes}`;
      return (await aiProvider.generateContent(fullPrompt, [], kbPrompt)).content;
    };

    const aiUpdateTask = async () => {
      // 针对 AI 行业洞察、技术深度、或跨界分析等类型，并行提取 AI 基础知识库及更新
      if (!['A', 'B', 'C'].includes(typeCode)) return 'N/A';
      const aiBasePrompt = `${knowledge}\n\n任务：作为领域专家，请提供关于 "${input}" 的 AI 基础认知逻辑、行业共识判断及当前最新行业动态。`;
      return (await aiProvider.generateContent(fullPrompt, [], aiBasePrompt)).content;
    };

    const projectTask = async () => {
      const isProjectQuery = input.includes('项目') || input.includes('做过') || input.includes('经历') || input.includes('作品');
      if (!['A', 'F'].includes(typeCode) && !isProjectQuery) return 'N/A';
      return (await aiProvider.generateContent(fullPrompt, [], projects)).content;
    };

    const [kbRes, aiUpdateRes, projectRes] = await Promise.all([kbTask(), aiUpdateTask(), projectTask()]);
    
    // 汇总各路事实
    let combinedFacts = '';
    if (kbRes !== 'N/A') combinedFacts += `【用户知识库】\n${kbRes}\n\n`;
    if (aiUpdateRes !== 'N/A') combinedFacts += `【AI基础知识库及更新】\n${aiUpdateRes}\n\n`;
    if (projectRes !== 'N/A') combinedFacts += `【个人项目履历】\n${projectRes}\n`;

    return combinedFacts.trim() || 'No relevant facts found.';
  }

  private async *generateFinalResponse(aiProvider: AIProvider, typeCode: string, input: string, facts: string): AsyncGenerator<{ type: 'status' | 'content' | 'strategy' | 'done', data: any }> {
    // 完全还原原始的 identityPrompt 文案
    const identityPrompt = `
${persona}
${style}
${antiHallucination}
${typeCode === 'F' ? cooperation : ''}

任务：基于以下事实，以 何夕2077 的身份撰写回复。
要求：
1. 专业的亲和力（ISTJ）：删除 AI 废话，但保持表达的温度。
2. 激发欲望：通过深度洞察和反问，引导用户继续深入探讨。
3. 逻辑严密：以事实为准，提供有条理的、启发性的信息。
4. 严格遵守反幻觉协议：确保所有信息（包括模型名称、具体术语、数字、链接）均保持字面一致，严禁擅自篡改或升级。
${typeCode === 'F' ? '5. 商务对接：专业、温和且高效地引导对方进一步合作。' : ''}

收集到的事实：
${facts}
`;

    // 还原原始的 finalInput 文案
    const finalInput = `针对用户输入 "${input}"，整合事实并以你的语感回复。`;
    const builtinTools = [{ google_search: {} }, { url_context: {} }];

    if (aiProvider.generateStream) {
      const stream = aiProvider.generateStream(finalInput, builtinTools, identityPrompt);
      for await (const chunk of stream) yield { type: 'content' as const, data: chunk };
    } else {
      const finalRes = await aiProvider.generateContent(finalInput, builtinTools, identityPrompt);
      yield { type: 'content' as const, data: finalRes.content.replace(/\[Strategy: 类型.\]/g, '').trim() };
    }
  }
}
