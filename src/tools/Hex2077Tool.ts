import { BaseTool, ServiceContext, LogService, AIMessage, AIProvider } from '../core/base.js';
import { persona } from '../prompts/persona.js';
import { style } from '../prompts/style.js';
import { knowledge } from '../prompts/knowledge.js';
import { projects } from '../prompts/projects.js';
import { strategy } from '../prompts/strategy.js';
import { cooperation } from '../prompts/cooperation.js';
import { antiHallucination } from '../prompts/antiHallucination.js';
import { orchestrator } from '../prompts/orchestrator.js'; // 引入调度器 prompt
import { shaper } from '../prompts/shaper.js'; // 引入身份重塑 prompt
import { summary, chatSummary } from '../prompts/summary.js'; // 引入总结提示词
import { AIHelper } from '../utils/AIHelper.js';

export class Hex2077Tool extends BaseTool {
  readonly id = 'hex2077_persona';
  readonly name = '何夕2077 分身 (优化版)';
  readonly description = '调用 何夕2077 的 AI 分身，采用动态 Agent 调度架构。';
  readonly parameters = {
    type: 'object',
    properties: {
      input: { type: 'string', description: '对话输入内容' },
      history: { type: 'array', items: { type: 'object' }, description: '历史对话记录' },
      ru: { type: 'string', description: '需要总结的网页链接 (可选)' }
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

  async handler(args: { input: string; history?: AIMessage[]; fingerprint?: string; sessionId?: string; ru?: string }): Promise<{ strategy: string; content: string; steps: any[] }> {
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

  async *streamHandler(args: { input: string; history?: AIMessage[]; fingerprint?: string; sessionId?: string; ru?: string }): AsyncGenerator<{ type: 'status' | 'content' | 'strategy' | 'done', data: any }> {
    let { input, history = [], fingerprint = 'unknown', sessionId = 'unknown', ru } = args;
    input = AIHelper.cleanInput(input);
    const logPrefix = `[${fingerprint}][${sessionId}]`;
    this.logger.info(`${logPrefix} Starting streamHandler for input: "${input.slice(0, 50)}${input.length > 50 ? '...' : ''}"`);

    const aiProvider = this.context.aiProvider;
    if (!aiProvider) throw new Error('AI Provider not initialized');

    const fullPrompt: AIMessage[] = [...history, { role: 'user', content: input }];

    try {
      // --- 1. 意图调度决策 (Strategist) ---
      yield { type: 'status' as const, data: { agent: 'Response Strategist', message: '分析意图并制定调度计划...' } };
      const { typeCode, strategyTag, agentsToCall, keywords, urls: extractedUrls } = await this.strategize(aiProvider, fullPrompt, logPrefix);
      const urls = ru ? Array.from(new Set([ru, ...extractedUrls])) : extractedUrls;
      this.logger.info(`${logPrefix} Strategy decided: ${strategyTag}, Agents: [${agentsToCall.join(', ')}], Keywords: [${keywords.join(', ')}]${urls.length > 0 ? `, URLs: ${urls.join(', ')}` : ''}`);
      
      yield { type: 'strategy' as const, data: strategyTag };
      yield { type: 'status' as const, data: { agent: 'Response Strategist', message: `制定完成: 意图 [${typeCode}], 调度 Agent: [${agentsToCall.join(', ')}]` } };

      // --- 2. 动态并行调度 (Agent Dispatcher) ---
      yield { type: 'status' as const, data: { agent: 'Multi-Agent', message: '正在并行执行各路 Agent...' } };
      this.logger.info(`${logPrefix} Dispatching agents: ${agentsToCall.join(', ')}`);
      const facts = await this.dispatchAgents(aiProvider, agentsToCall, input, fullPrompt, keywords, logPrefix, urls, ru);
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

  private async strategize(aiProvider: AIProvider, fullPrompt: AIMessage[], logPrefix: string): Promise<{ typeCode: string, strategyTag: string, agentsToCall: string[], keywords: string[], urls: string[] }> {
    const builtinTools = [{ google_search: {} }, { url_context: {} }];
    // 结合 orchestrator 与 strategy 进行决策
    const currentOrchestrator = this.context.personaService?.getOrchestrator() || orchestrator;
    const currentStrategy = this.context.personaService?.getStrategy() || strategy;
    const strategyPrompt = `${currentOrchestrator}\n\n${currentStrategy}\n\n请严格基于上述逻辑输出。`;
    this.logger.info(`${logPrefix} Calling Strategizer AI...`);
    const strategyRes = await aiProvider.generateContent(fullPrompt, builtinTools, strategyPrompt);
    
    // 匹配 [Strategy: 类型X]
    const strategyMatch = strategyRes.content?.match(/\[Strategy: 类型\s*([A-I])\s*\]/);
    const typeCode = strategyMatch ? strategyMatch[1] : 'E';
    
    // 匹配 [Call: Agent1, Agent2...]
    const callMatch = strategyRes.content?.match(/\[Call:\s*([^\]]+)\s*\]/);
    const agentsToCall = callMatch ? callMatch[1].split(',').map(a => a.trim()) : ['PersonaChat'];

    // 匹配 [Keywords:词1, 词2...]
    const keywordMatch = strategyRes.content?.match(/\[Keywords:\s*([^\]]+)\s*\]/);
    const keywords = keywordMatch && keywordMatch[1] !== 'None' 
      ? keywordMatch[1].split(',').map(k => k.trim()) 
      : [];

    // 提取所有 URL (或显式的 ru 参数/链接)
    const userInput = fullPrompt[fullPrompt.length - 1]?.content || '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matchedUrls = userInput.match(urlRegex) || [];
    
    // 特殊处理 ru 参数，例如：ru=https://xxx.com
    const ruMatches = Array.from(userInput.matchAll(/ru=([^\s&]+)/g), m => m[1]);
    
    // 合并并去重
    const allUrls = Array.from(new Set([...matchedUrls, ...ruMatches]));
    
    return { 
      typeCode, 
      strategyTag: `[Strategy: 类型${typeCode}]`,
      agentsToCall,
      keywords,
      urls: allUrls
    };
  }

  private async dispatchAgents(aiProvider: AIProvider, agents: string[], input: string, fullPrompt: AIMessage[], keywords: string[], logPrefix: string, urls: string[], ru?: string): Promise<string> {
    const tasks: Promise<string>[] = [];

    // 动态映射并加入任务队列
    if (agents.includes('PageSummarizer') && urls.length > 0) {
      tasks.push(this.callPageSummarizer(aiProvider, urls, input, ru, logPrefix));
    }
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
    if (agents.includes('ChatSummarizer')) {
      tasks.push(this.callChatSummarizer(aiProvider, fullPrompt, logPrefix));
    }

    // 处理 PersonaChat 这种简单的直接通过最终 Identity Shaper 处理或提供上下文
    if (agents.includes('PersonaChat') && tasks.length === 0) {
      return 'Simple Interaction Mode.';
    }

    const results = await Promise.all(tasks);
    
    // 聚合各路事实数据
    let combinedFacts = '';
    let resultIdx = 0;
    if (agents.includes('PageSummarizer') && urls) combinedFacts += `【页面内容总结】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('KnowledgeExpert')) combinedFacts += `【用户知识库】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('ProjectArchivist')) combinedFacts += `【个人项目履历】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('AIInsightAgent')) combinedFacts += `【AI行业见解】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('BusinessConsultant')) combinedFacts += `【商务合作建议】\n${results[resultIdx++]}\n\n`;
    if (agents.includes('ChatSummarizer')) combinedFacts += `【对话复盘与总结】\n${results[resultIdx++]}\n\n`;

    return combinedFacts.trim() || 'No relevant facts found.';
  }

  // --- Sub-Agents 实操逻辑 ---

  private async callPageSummarizer(aiProvider: AIProvider, urls: string[], input: string, ru: string | undefined, logPrefix: string): Promise<string> {
    let finalUrls = [...urls];

    // 逻辑调整：当 [Current Page] 或 ru 参数与其他链接同时存在时，优先处理其他链接
    if (finalUrls.length > 1) {
      const currentPageMatch = input.match(/Current Page:\s*(https?:\/\/[^\s]+)/);
      const currentPageUrl = currentPageMatch ? currentPageMatch[1] : null;

      const currentContextUrls = new Set<string>();
      if (ru) currentContextUrls.add(ru);
      if (currentPageUrl) currentContextUrls.add(currentPageUrl);

      if (currentContextUrls.size > 0) {
        const otherUrls = finalUrls.filter(u => !currentContextUrls.has(u));
        // 只有当剩下还有其他链接时，才执行剔除逻辑
        if (otherUrls.length > 0) {
          finalUrls = otherUrls;
          this.logger.info(`${logPrefix} [PageSummarizer] Multiple links detected. Filtering out current page context links: ${Array.from(currentContextUrls).join(', ')}`);
        }
      }
    }

    const urlString = finalUrls.join(" ; ");
    const builtinTools = [{ google_search: {} }, { url_context: {} }];
    this.logger.info(`${logPrefix} [PageSummarizer] Summarizing URL: ${urlString}`);
    // 利用 aiProvider 的 url_context 能力，如果模型支持则会自动解析该链接
    const currentSummary = this.context.personaService?.getSummary() || summary;
    const res = await aiProvider.generateContent([{ role: 'user', content: `请总结所有链接内容：${urlString}` }], builtinTools, currentSummary);
    this.logger.info(`${logPrefix} [PageSummarizer] Summary completed.`);
    return res.content;
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
    const currentKnowledge = this.context.personaService?.getKnowledge() || knowledge;
    const kbPrompt = `${currentKnowledge}\n\n任务：从以下内容中提取与用户问题【直接相关】的干货点。\n要求：以无序列表输出，每点不超过 30 字，严禁润色或增加前言后语。\n内容：\n${kbRes}`;
    // 明确不使用 builtinTools
    const res = await aiProvider.generateContent(fullPrompt, [], kbPrompt);
    this.logger.info(`${logPrefix} [KnowledgeExpert] Dry goods extracted.`);
    return res.content;
  }

  private async callProjectArchivist(aiProvider: AIProvider, fullPrompt: AIMessage[], logPrefix: string): Promise<string> {
    this.logger.info(`${logPrefix} [ProjectArchivist] Screening project archives...`);
    const currentProjects = this.context.personaService?.getProjects() || projects;
    const projectPrompt = `${currentProjects}\n\n任务：筛选与当前问题相关的项目经历。\n要求：仅提供项目名和核心成果（单句描述），严禁背景介绍。`;
    // 明确不使用 builtinTools
    const res = await aiProvider.generateContent(fullPrompt, [], projectPrompt);
    this.logger.info(`${logPrefix} [ProjectArchivist] Screening completed.`);
    return res.content;
  }

  private async callAIInsightAgent(aiProvider: AIProvider, input: string, fullPrompt: AIMessage[], logPrefix: string): Promise<string> {
    this.logger.info(`${logPrefix} [AIInsightAgent] Generating AI insights...`);
    const currentKnowledge = this.context.personaService?.getKnowledge() || knowledge;
    const aiInsightPrompt = `${currentKnowledge}\n\n任务：针对 "${input}" 提供核心逻辑判断。\n要求：给出 1-2 条犀利的结论，单句长度控制在 40 字以内。`;
    const res = await aiProvider.generateContent(fullPrompt, [], aiInsightPrompt);
    this.logger.info(`${logPrefix} [AIInsightAgent] Insights generated.`);
    return res.content;
  }

  private async callBusinessConsultant(aiProvider: AIProvider, input: string, fullPrompt: AIMessage[], logPrefix: string): Promise<string> {
    this.logger.info(`${logPrefix} [BusinessConsultant] Analyzing business potential...`);
    const currentCooperation = this.context.personaService?.getCooperation() || cooperation;
    const bizPrompt = `${currentCooperation}\n\n任务：分析合作潜力。\n要求：仅输出 1 条关键对接思路，不要寒暄。`;
    const res = await aiProvider.generateContent(fullPrompt, [], bizPrompt);
    this.logger.info(`${logPrefix} [BusinessConsultant] Analysis completed.`);
    return res.content;
  }

  private async callChatSummarizer(aiProvider: AIProvider, fullPrompt: AIMessage[], logPrefix: string): Promise<string> {
    this.logger.info(`${logPrefix} [ChatSummarizer] Summarizing dialogue history...`);
    // 排除当前最后一条用户输入，仅总结之前的历史（或包含当前输入以梳理现状）
    // 这里选择包含完整 prompt 以便总结当前的“共识”
    const currentChatSummary = this.context.personaService?.getChatSummary() || chatSummary;
    const res = await aiProvider.generateContent(fullPrompt, [], currentChatSummary);
    this.logger.info(`${logPrefix} [ChatSummarizer] Dialogue summary completed.`);
    return res.content;
  }

  private async *generateFinalResponse(aiProvider: AIProvider, typeCode: string, fullPrompt: AIMessage[], facts: string): AsyncGenerator<{ type: 'status' | 'content' | 'strategy' | 'done', data: any }> {
    const currentPersona = this.context.personaService?.getPersona() || persona;
    const currentStyle = this.context.personaService?.getStyle() || style;
    const currentAntiHallucination = this.context.personaService?.getAntiHallucination() || antiHallucination;
    const currentCooperation = this.context.personaService?.getCooperation() || cooperation;
    const currentShaper = this.context.personaService?.getShaper() || shaper;

    const identityPrompt = `
${currentPersona}
${currentStyle}
${currentAntiHallucination}
${typeCode === 'F' ? currentCooperation : ''}

${currentShaper}

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
