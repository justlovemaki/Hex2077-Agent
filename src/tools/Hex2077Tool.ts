import { BaseTool, ServiceContext, LogService, AIMessage, AIProvider } from '../core/base.js';
import { persona } from '../prompts/persona.js';
import { style } from '../prompts/style.js';
import { knowledge } from '../prompts/knowledge.js';
import { projects } from '../prompts/projects.js';
import { strategy } from '../prompts/strategy.js';
import { cooperation } from '../prompts/cooperation.js';
import { antiHallucination } from '../prompts/antiHallucination.js';
import { orchestrator } from '../prompts/orchestrator.js'; // 引入调度器 prompt
import { AIHelper } from '../utils/AIHelper.js';

export class Hex2077Tool extends BaseTool {
  readonly id = 'hex2077_persona';
  readonly name = '何夕2077 分身 (优化版)';
  readonly description = '调用 何夕2077 的 AI 分身，采用动态 Agent 调度架构。';
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

  async handler(args: { input: string; history?: AIMessage[]; fingerprint?: string; sessionId?: string }): Promise<{ strategy: string; content: string; steps: any[] }> {
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

  async *streamHandler(args: { input: string; history?: AIMessage[]; fingerprint?: string; sessionId?: string }): AsyncGenerator<{ type: 'status' | 'content' | 'strategy' | 'done', data: any }> {
    let { input, history = [], fingerprint = 'unknown', sessionId = 'unknown' } = args;
    input = AIHelper.cleanInput(input);
    const logPrefix = `[${fingerprint}][${sessionId}]`;
    this.logger.info(`${logPrefix} Starting streamHandler for input: "${input.slice(0, 50)}${input.length > 50 ? '...' : ''}"`);

    const aiProvider = this.context.aiProvider;
    if (!aiProvider) throw new Error('AI Provider not initialized');

    const fullPrompt: AIMessage[] = [...history, { role: 'user', content: input }];

    try {
      // --- 1. 意图调度决策 (Strategist) ---
      yield { type: 'status' as const, data: { agent: 'Response Strategist', message: '分析意图并制定调度计划...' } };
      const { typeCode, strategyTag, agentsToCall, keywords } = await this.strategize(aiProvider, fullPrompt, logPrefix);
      this.logger.info(`${logPrefix} Strategy decided: ${strategyTag}, Agents: [${agentsToCall.join(', ')}], Keywords: [${keywords.join(', ')}]`);
      
      yield { type: 'strategy' as const, data: strategyTag };
      yield { type: 'status' as const, data: { agent: 'Response Strategist', message: `制定完成: 意图 [${typeCode}], 调度 Agent: [${agentsToCall.join(', ')}]` } };

      // --- 2. 动态并行调度 (Agent Dispatcher) ---
      yield { type: 'status' as const, data: { agent: 'Multi-Agent', message: '正在并行执行各路 Agent...' } };
      this.logger.info(`${logPrefix} Dispatching agents: ${agentsToCall.join(', ')}`);
      const facts = await this.dispatchAgents(aiProvider, agentsToCall, input, fullPrompt, keywords, logPrefix);
      this.logger.info(`${logPrefix} Agents execution completed. Facts gathered (length: ${facts.length})`);

      // --- 3. 最终响应生成 (Identity Shaper) ---
      yield { type: 'status' as const, data: { agent: 'Identity Shaper', message: '整合事实并重塑风格...' } };
      this.logger.info(`${logPrefix} Generating final response...`);
      
      let finalContent = '';
      for await (const chunk of this.generateFinalResponse(aiProvider, typeCode, fullPrompt, facts)) {
        if (chunk.type === 'content') finalContent += chunk.data;
        yield chunk;
      }

      this.logger.info(`${logPrefix} Summary: 
        Input: "${input.slice(0, 100)}${input.length > 100 ? '...' : ''}"
        Output: "${finalContent.slice(0, 100)}${finalContent.length > 100 ? '...' : ''}"
        Total Length: ${finalContent.length} chars`);
      
      this.logger.info(`${logPrefix} streamHandler completed successfully.`);
      yield { type: 'done' as const, data: {} };
    } catch (error: any) {
      this.logger.error(`${logPrefix} ERROR: ${error.message}`);
      throw error;
    }
  }

  private async strategize(aiProvider: AIProvider, fullPrompt: AIMessage[], logPrefix: string): Promise<{ typeCode: string, strategyTag: string, agentsToCall: string[], keywords: string[] }> {
    const builtinTools = [{ google_search: {} }, { url_context: {} }];
    // 结合 orchestrator 与 strategy 进行决策
    const strategyPrompt = `${orchestrator}\n\n${strategy}\n\n请严格基于上述逻辑输出。`;
    this.logger.info(`${logPrefix} Calling Strategizer AI...`);
    const strategyRes = await aiProvider.generateContent(fullPrompt, builtinTools, strategyPrompt);
    
    // 匹配 [Strategy: 类型X]
    const strategyMatch = strategyRes.content?.match(/\[Strategy: 类型\s*([A-F])\s*\]/);
    const typeCode = strategyMatch ? strategyMatch[1] : 'E';
    
    // 匹配 [Call: Agent1, Agent2...]
    const callMatch = strategyRes.content?.match(/\[Call:\s*([^\]]+)\s*\]/);
    const agentsToCall = callMatch ? callMatch[1].split(',').map(a => a.trim()) : ['PersonaChat'];

    // 匹配 [Keywords:词1, 词2...]
    const keywordMatch = strategyRes.content?.match(/\[Keywords:\s*([^\]]+)\s*\]/);
    const keywords = keywordMatch && keywordMatch[1] !== 'None' 
      ? keywordMatch[1].split(',').map(k => k.trim()) 
      : [];
    
    return { 
      typeCode, 
      strategyTag: `[Strategy: 类型${typeCode}]`,
      agentsToCall,
      keywords
    };
  }

  private async dispatchAgents(aiProvider: AIProvider, agents: string[], input: string, fullPrompt: AIMessage[], keywords: string[], logPrefix: string): Promise<string> {
    const tasks: Promise<string>[] = [];

    // 动态映射并加入任务队列
    if (agents.includes('KnowledgeExpert')) {
      tasks.push(this.callKnowledgeExpert(aiProvider, input, fullPrompt, keywords, logPrefix));
    }
    if (agents.includes('ProjectArchivist')) {
      tasks.push(this.callProjectArchivist(aiProvider, fullPrompt, logPrefix));
    }
    if (agents.includes('AIInsightAgent')) {
      tasks.push(this.callAIInsightAgent(aiProvider, input, fullPrompt, logPrefix));
    }
    if (agents.includes('BusinessConsultant')) {
      tasks.push(this.callBusinessConsultant(aiProvider, input, fullPrompt, logPrefix));
    }

    // 处理 PersonaChat 这种简单的直接通过最终 Identity Shaper 处理或提供上下文
    if (agents.includes('PersonaChat') && tasks.length === 0) {
      return 'Simple Interaction Mode.';
    }

    const results = await Promise.all(tasks);
    
    // 聚合各路事实数据
    let combinedFacts = '';
    let resultIdx = 0;
    if (agents.includes('KnowledgeExpert')) combinedFacts += `【用户知识库】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('ProjectArchivist')) combinedFacts += `【个人项目履历】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('AIInsightAgent')) combinedFacts += `【AI行业见解】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('BusinessConsultant')) combinedFacts += `【商务合作建议】\n${results[resultIdx++]}\n`;

    return combinedFacts.trim() || 'No relevant facts found.';
  }

  // --- Sub-Agents 实操逻辑 ---

  private async callKnowledgeExpert(aiProvider: AIProvider, input: string, fullPrompt: AIMessage[], keywords: string[], logPrefix: string): Promise<string> {
    const query = keywords.length > 0 ? keywords.join(' ') : input;
    this.logger.info(`${logPrefix} [KnowledgeExpert] Querying KB with: "${query}"`);
    const kbRes = await this.context.knowledgeBaseService.queryKnowledge(query, { 
      limit: 3,
      skipAiSearch: keywords.length > 0 // 如果已经有关键词，跳过 AI 生成
    });
    if (!kbRes) {
      this.logger.info(`${logPrefix} [KnowledgeExpert] No relevant knowledge found.`);
      return 'No specific knowledge found.';
    }
    this.logger.info(`${logPrefix} [KnowledgeExpert] Knowledge found (length: ${kbRes.length}). Extracting dry goods...`);
    const kbPrompt = `${knowledge}\n\n任务：从以下内容中提取与用户问题【直接相关】的干货点。\n要求：以无序列表输出，每点不超过 30 字，严禁润色或增加前言后语。\n内容：\n${kbRes}`;
    // 明确不使用 builtinTools
    const res = await aiProvider.generateContent(fullPrompt, [], kbPrompt);
    this.logger.info(`${logPrefix} [KnowledgeExpert] Dry goods extracted.`);
    return res.content;
  }

  private async callProjectArchivist(aiProvider: AIProvider, fullPrompt: AIMessage[], logPrefix: string): Promise<string> {
    this.logger.info(`${logPrefix} [ProjectArchivist] Screening project archives...`);
    const projectPrompt = `${projects}\n\n任务：筛选与当前问题相关的项目经历。\n要求：仅提供项目名和核心成果（单句描述），严禁背景介绍。`;
    // 明确不使用 builtinTools
    const res = await aiProvider.generateContent(fullPrompt, [], projectPrompt);
    this.logger.info(`${logPrefix} [ProjectArchivist] Screening completed.`);
    return res.content;
  }

  private async callAIInsightAgent(aiProvider: AIProvider, input: string, fullPrompt: AIMessage[], logPrefix: string): Promise<string> {
    this.logger.info(`${logPrefix} [AIInsightAgent] Generating AI insights...`);
    const aiInsightPrompt = `${knowledge}\n\n任务：针对 "${input}" 提供核心逻辑判断。\n要求：给出 1-2 条犀利的结论，单句长度控制在 40 字以内。`;
    const res = await aiProvider.generateContent(fullPrompt, [], aiInsightPrompt);
    this.logger.info(`${logPrefix} [AIInsightAgent] Insights generated.`);
    return res.content;
  }

  private async callBusinessConsultant(aiProvider: AIProvider, input: string, fullPrompt: AIMessage[], logPrefix: string): Promise<string> {
    this.logger.info(`${logPrefix} [BusinessConsultant] Analyzing business potential...`);
    const bizPrompt = `${cooperation}\n\n任务：分析合作潜力。\n要求：仅输出 1 条关键对接思路，不要寒暄。`;
    const res = await aiProvider.generateContent(fullPrompt, [], bizPrompt);
    this.logger.info(`${logPrefix} [BusinessConsultant] Analysis completed.`);
    return res.content;
  }

  private async *generateFinalResponse(aiProvider: AIProvider, typeCode: string, fullPrompt: AIMessage[], facts: string): AsyncGenerator<{ type: 'status' | 'content' | 'strategy' | 'done', data: any }> {
    const identityPrompt = `
${persona}
${style}
${antiHallucination}
${typeCode === 'F' ? cooperation : ''}

任务：以 何夕2077 的身份，istj的人格回复。
核心准则：
1. 极简主义：能用一句话说清楚的绝不用两句。
2. 结论先行：第一句直接抛出判断或核心答案。
3. 拒绝 AI 味：删除“首先、其次、总之”、“希望能帮到你”等所有废话。
4. 句式习惯：短促、有力，多用陈述句和反问句，少用修饰词。

收集到的事实（仅供参考，请根据事实重构逻辑并以你的语感回复，不要复述）：
${facts}
`;

    const builtinTools = [{ google_search: {} }, { url_context: {} }];

    if (aiProvider.generateStream) {
      const stream = aiProvider.generateStream(fullPrompt, builtinTools, identityPrompt);
      for await (const chunk of stream) yield { type: 'content' as const, data: chunk };
    } else {
      const finalRes = await aiProvider.generateContent(fullPrompt, builtinTools, identityPrompt);
      yield { type: 'content' as const, data: finalRes.content.replace(/\[Strategy: 类型.\]/g, '').trim() };
    }
  }
}
