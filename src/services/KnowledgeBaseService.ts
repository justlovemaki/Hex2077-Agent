import fs from 'fs/promises';
import path from 'path';
import { AIProvider, LogService } from '../core/base.js';
import { AIHelper } from '../utils/AIHelper.js';

export interface KnowledgeIndexEntry {
  id: string;
  title: string;
  date: string;
  skipAI?: boolean;
    parts: {
      id: string;
      topic: string;
      summary: string;
      keywords?: string[];
      filePath: string;
    }[];

}

export class SimpleKnowledgeBaseService {
  private baseDir: string;
  private metadataFile: string;
  private aiProvider: AIProvider;
  private logger?: LogService;

  constructor(dataDir: string, aiProvider: AIProvider, logger?: LogService) {
    this.baseDir = path.join(dataDir, 'knowledge_store');
    this.metadataFile = path.join(this.baseDir, 'index.json');
    this.aiProvider = aiProvider;
    this.logger = logger;
  }

  private log(msg: string, level: 'info' | 'error' | 'warn' = 'info') {
    if (this.logger) {
      this.logger[level](msg);
    } else {
      console[level](`[KBService] ${msg}`);
    }
  }

  async init() {
    await fs.mkdir(this.baseDir, { recursive: true });
    try {
      await fs.access(this.metadataFile);
    } catch {
      await fs.writeFile(this.metadataFile, JSON.stringify([], null, 2));
    }
  }

  private async getIndex(): Promise<KnowledgeIndexEntry[]> {
    try {
      const data = await fs.readFile(this.metadataFile, 'utf-8');
      return JSON.parse(data);
    } catch (err: any) {
      this.log(`Failed to read index: ${err.message}`, 'error');
      return [];
    }
  }

  private async saveIndex(index: KnowledgeIndexEntry[]) {
    try {
      await fs.writeFile(this.metadataFile, JSON.stringify(index, null, 2));
    } catch (err: any) {
      this.log(`Failed to save index: ${err.message}`, 'error');
      throw err;
    }
  }

  async listDocuments() {
    return await this.getIndex();
  }

  async addItem(title: string, content: string, options?: { skipAI?: boolean }) {
    const docId = Math.random().toString(36).substring(2, 11);
    const docDir = path.join(this.baseDir, docId);
    const skipAI = options?.skipAI === true;
    
    try {
      await fs.mkdir(docDir, { recursive: true });

      this.log(`Starting processing for document: ${title}${skipAI ? ' (Skip AI Processing)' : ''}`);

      let parts: { topic: string, content: string }[] = [];
      if (skipAI) {
        // --- 跳过 AI 语义拆分 ---
        parts = [{ topic: "全文内容", content }];
      } else {
        // --- 阶段 1: 语义拆分 ---
        parts = await this.partitionContent(title, content);
        this.log(`AI identified ${parts.length} topics for ${title}.`);
      }

      // --- 阶段 2: 存储文件 + 建立索引 ---
      const processedParts = await this.processParts(docId, parts);

      const index = await this.getIndex();
      index.push({ id: docId, title, date: new Date().toISOString(), skipAI, parts: processedParts });
      await this.saveIndex(index);

      this.log(`Document processing completed: ${docId} (${title})`);
      return { docId, title, partCount: parts.length };
    } catch (err: any) {
      this.log(`Failed to add item ${title}: ${err.message}`, 'error');
      throw err;
    }
  }

  private async partitionContent(title: string, content: string): Promise<{ topic: string, content: string }[]> {
    this.log('AI Partitioning content into topics...');
    const partitionPrompt = `你是一个专业的文档分析专家。
任务：将以下文档内容按“逻辑板块”进行拆分。
要求：
1. **合并同类项**：将语义相近或属于同一逻辑范畴的内容合并，不要拆得太细。
2. **深度优先**：确保每个板块都有足够的实质性内容，避免碎片化。
3. **板块数量控制**：通常一个文档拆分为 3-5 个核心板块。
4. 返回严格 JSON 数组: [{"topic": "板块主题名", "content": "详细内容"}]

待处理文档《${title}》：
${content}`;

    return await AIHelper.getJsonResponse<{ topic: string, content: string }[]>(
      this.aiProvider,
      partitionPrompt,
      "内容结构化专家。",
      [{ topic: "未分类内容", content }]
    );
  }

  private async processParts(docId: string, parts: { topic: string, content: string }[]) {
    const processedParts: any[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      this.log(`Generating AI summary & keywords for topic: ${part.topic}`);
      const summaryPrompt = `针对关于“${part.topic}”的内容，请完成以下任务：
1. 生成 50 字以内的简洁摘要。
2. 提取所有可能的、对搜索有帮助的核心关键词和短语（涵盖技术点、人物、公司、概念、日期等）。

返回严格 JSON 格式：{"summary": "...", "keywords": ["...", "..."]}

内容：\n${part.content}`;

      const aiRes = await AIHelper.getJsonResponse<{ summary: string, keywords: string[] }>(
        this.aiProvider,
        summaryPrompt,
        "文档索引专家。",
        { summary: part.content.slice(0, 50), keywords: [part.topic] }
      );
      
      const fileName = `part_${i}.md`;
      const relativePath = path.join(docId, fileName);
      const absolutePath = path.join(this.baseDir, relativePath);

      const mdContent = `# ${part.topic}\n\n${part.content}`;
      await fs.writeFile(absolutePath, mdContent);

      processedParts.push({
        id: `part_${i}`,
        topic: part.topic,
        summary: aiRes.summary.trim(),
        keywords: aiRes.keywords,
        filePath: relativePath
      });
    }
    return processedParts;
  }

  async deleteDocument(docId: string) {
    this.log(`Deleting document: ${docId}`);
    const docDir = path.join(this.baseDir, docId);
    try {
      const files = await fs.readdir(docDir);
      for (const f of files) await fs.unlink(path.join(docDir, f));
      await fs.rmdir(docDir);
    } catch (e) {}

    const index = await this.getIndex();
    await this.saveIndex(index.filter(d => d.id !== docId));
  }

  async updatePartTopic(docId: string, partId: string, newTopic: string) {
    this.log(`Updating topic for ${docId}/${partId} to "${newTopic}"`);
    const index = await this.getIndex();
    const doc = index.find(d => d.id === docId);
    if (!doc) throw new Error('Document not found');
    
    const part = doc.parts.find(p => p.id === partId);
    if (!part) throw new Error('Part not found');
    
    part.topic = newTopic;
    await this.saveIndex(index);
    return { success: true };
  }

  private async generateKeywords(query: string): Promise<{ match: string[], association: string[] }> {
    this.log('Generating search keywords...');
    const prompt = `针对用户查询，请生成两组搜索关键词：
1. **匹配关键词** (match): 3-5个，用于直接检索核心概念或事实。
2. **联想关键词** (association): 3-5个，用于检索可能相关的背景、上下游知识。

返回 JSON 格式：{"match": ["..."], "association": ["..."]}

用户查询: "${query}"`;

    const res = await AIHelper.getJsonResponse<{ match: string[], association: string[] }>(
      this.aiProvider,
      prompt,
      "搜索关键词专家。",
      { match: [query], association: [] }
    );

    this.log(`Keywords generated: match=[${res.match.join(', ')}], association=[${res.association.join(', ')}]`);
    return res;
  }

  async queryKnowledge(query: string, options?: { limit?: number, skipAiSearch?: boolean }): Promise<string> {
    const index = await this.getIndex();
    if (index.length === 0) return "";

    this.log(`Querying knowledge base: "${query.slice(0, 50)}..."`);

    try {
      // 1. 生成搜索关键词
      let allSearchKeywords = [query];
      if (!options?.skipAiSearch) {
        const keywordsRes = await this.generateKeywords(query);
        allSearchKeywords = [...new Set([query, ...keywordsRes.match, ...keywordsRes.association])];
      }

      const allTopicIndex: any[] = [];
      index.forEach(doc => {
        doc.parts.forEach(p => {
          allTopicIndex.push({ 
            docId: doc.id, 
            partId: p.id, 
            docTitle: doc.title,
            topic: p.topic, 
            summary: p.summary,
            keywords: p.keywords || [],
            filePath: p.filePath 
          });
        });
      });

      this.log(`Parallel searching with ${allSearchKeywords.length} keywords...`);

      // 2. 并行筛选候选节点 (通过关键词匹配)
      const candidateSets = await Promise.all(allSearchKeywords.map(async (kw) => {
        const kwLower = kw.toLowerCase();
        return allTopicIndex.filter(p => 
          p.topic.toLowerCase().includes(kwLower) || 
          p.summary.toLowerCase().includes(kwLower) ||
          p.docTitle.toLowerCase().includes(kwLower) ||
          p.keywords.some((k: string) => k.toLowerCase().includes(kwLower))
        ).map(m => `${m.docId}|${m.partId}`);
      }));

      // 合并候选并去重
      const candidateIds = [...new Set(candidateSets.flat())];
      
      if (candidateIds.length === 0) {
        this.log('No relevant topics found through keywords.');
        // 如果关键词没搜到，尝试兜底：直接让 AI 从全量索引里选（如果索引不太大的话）
        if (allTopicIndex.length > 50) return "";
        candidateIds.push(...allTopicIndex.map(p => `${p.docId}|${p.partId}`));
      }

      this.log(`Found ${candidateIds.length} candidate parts across all keywords.`);

      // 3. 从候选节点中精准选择
      const candidates = candidateIds.map(id => {
        const [docId, partId] = id.split('|');
        return allTopicIndex.find(p => p.docId === docId && p.partId === partId);
      }).filter(Boolean);

      // 限制候选数量，避免上下文过长
      const limitedCandidates = candidates.slice(0, 20);

      const selectionPrompt = `你是一个精准的资料检索助手。请根据用户查询，从以下候选知识板块中选出最相关的 1-3 个 ID。
只需输出 JSON 数组，如: ["docId|partId", "docId|partId"]

用户查询: "${query}"

    候选索引：
${limitedCandidates.map((p, i) => `${i + 1}. [ID: ${p.docId}|${p.partId}] 文档: ${p.docTitle}\n   主题: ${p.topic}\n   关键词: ${p.keywords.join(', ')}\n   摘要: ${p.summary}`).join('\n')}`;


      const selectedKeys = await AIHelper.getJsonResponse<string[]>(
        this.aiProvider,
        selectionPrompt,
        "索引精选专家。",
        []
      );

      if (selectedKeys.length === 0) {
        this.log('AI found no relevant topics from candidates.');
        return "";
      }

      this.log(`AI selected ${selectedKeys.length} topics: ${selectedKeys.join(', ')}`);

      let finalContext = "";
      for (const key of selectedKeys.slice(0, 3)) {
        const [docId, partId] = key.split('|');
        const entry = allTopicIndex.find(p => p.docId === docId && p.partId === partId);
        if (entry) {
          try {
            const content = await fs.readFile(path.join(this.baseDir, entry.filePath), 'utf-8');
            finalContext += `${content}\n\n---\n\n`;
          } catch (e: any) {
            this.log(`Failed to read part content ${key}: ${e.message}`, 'error');
          }
        }
      }

      return finalContext;

    } catch (error: any) {
      this.log(`Query failed: ${error.message}`, 'error');
      return "";
    }
  }
}
