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
  private rawDir: string;
  private metadataFile: string;
  private aiProvider: AIProvider;
  private logger?: LogService;
  private language: string;
  private dataSourcePreference: 'part' | 'wiki' | 'both';

  constructor(dataDir: string, aiProvider: AIProvider, logger?: LogService) {
    this.baseDir = path.join(dataDir, 'knowledge_store');
    this.rawDir = path.join(dataDir, 'raw');
    this.metadataFile = path.join(this.baseDir, 'index.json');
    this.aiProvider = aiProvider;
    this.logger = logger;
    this.language = process.env.KB_WIKI_LANGUAGE || '简体中文 (Simplified Chinese)';
    this.dataSourcePreference = (process.env.KB_DATA_SOURCE_PREFERENCE as any) || 'wiki';
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
    await fs.mkdir(this.rawDir, { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'summaries'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'entities'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'concepts'), { recursive: true });
    
    try {
      await fs.access(this.metadataFile);
    } catch {
      await fs.writeFile(this.metadataFile, JSON.stringify([], null, 2));
    }

    // 初始化 index.md 和 log.md 如果不存在
    const indexFile = path.join(this.baseDir, 'index.md');
    try {
      await fs.access(indexFile);
    } catch {
      await fs.writeFile(indexFile, '# LLM Wiki Index\n\nCentral directory for the knowledge base.\n\n## Entities\n\n## Concepts\n\n## Summaries\n');
    }

    const logFile = path.join(this.baseDir, 'log.md');
    try {
      await fs.access(logFile);
    } catch {
      await fs.writeFile(logFile, '# LLM Wiki Log\n\nChronological record of knowledge base updates.\n');
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

  async getWikiStructure() {
    const folders = ['entities', 'concepts', 'summaries'];
    const result: Record<string, { name: string, mtime: number }[]> = {};
    for (const folder of folders) {
      try {
        const folderPath = path.join(this.baseDir, folder);
        const files = await fs.readdir(folderPath);
        const fileInfos = await Promise.all(
          files.filter(f => f.endsWith('.md')).map(async f => {
            const stats = await fs.stat(path.join(folderPath, f));
            return { name: f, mtime: stats.mtimeMs };
          })
        );
        result[folder] = fileInfos;
      } catch {
        result[folder] = [];
      }
    }
    return result;
  }

  async getWikiFileContent(relativePath: string) {
    // 基础安全检查：防止目录遍历
    if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      throw new Error('Invalid path');
    }
    const absolutePath = path.join(this.baseDir, relativePath);
    return await fs.readFile(absolutePath, 'utf-8');
  }

  async updateWikiFileContent(relativePath: string, content: string) {
    if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      throw new Error('Invalid path');
    }
    const absolutePath = path.join(this.baseDir, relativePath);
    await fs.writeFile(absolutePath, content);
  }

  async addItem(title: string, content: string, options?: { skipAI?: boolean }) {
    const docId = Math.random().toString(36).substring(2, 11);
    const docDir = path.join(this.baseDir, docId);
    const skipAI = options?.skipAI === true;
    
    try {
      await fs.mkdir(docDir, { recursive: true });

      this.log(`Starting processing for document: ${title}${skipAI ? ' (Skip AI Processing)' : ''}`);

      let parts: any[] = [];
      if (skipAI) {
        // --- 跳过 AI 语义拆分，但仍生成摘要和标签 ---
        this.log('Skipping partition, generating summary & tags for full text...');
        const summaryPrompt = `针对文档《${title}》，请完成以下任务：
1. 生成 50 字以内的简洁摘要（核心洞察）。
2. 提取 3-5 个对搜索有帮助的核心关键词标签（涵盖技术点、概念、实体等）。

【语言要求】：请全程使用【${this.language}】输出 summary 内容。
必须严格返回 JSON 格式：{"summary": "...", "tags": ["...", "..."]}

内容：\n${content}`;

        const aiRes = await AIHelper.getJsonResponse<{ summary: string, tags: string[] }>(
          this.aiProvider,
          summaryPrompt,
          "文档摘要专家。",
          { summary: "原始文档全量内容", tags: ["全文"] }
        );

        parts = [{ 
          topic: "全文内容", 
          summary: aiRes.summary, 
          tags: aiRes.tags, 
          content 
        }];
      } else {
        // --- 阶段 1: 语义拆分 + 摘要提取 ---
        parts = await this.partitionContent(title, content);
        this.log(`AI identified ${parts.length} topics for ${title}.`);
      }

      // --- 阶段 2: 存储文件 + 建立索引 ---
      const processedParts = await this.savePartsAndGetIndex(docId, parts);

      const index = await this.getIndex();
      index.push({ id: docId, title, date: new Date().toISOString(), skipAI, parts: processedParts });
      await this.saveIndex(index);

      // --- 阶段 3: Wiki 自动合成 ---
      await this.runWikiSynthesis(title, content, parts);

      this.log(`Document processing completed: ${docId} (${title})`);
      return { docId, title, partCount: parts.length };
    } catch (err: any) {
      this.log(`Failed to add item ${title}: ${err.message}`, 'error');
      throw err;
    }
  }

  /**
   * 将文档内容合成到 Wiki (Entities/Concepts)
   */
  private async runWikiSynthesis(title: string, rawContent: string, parts: any[]) {
    this.log(`Starting Wiki synthesis for "${title}"...`);

    // 1. 生成并存储摘要
    const summaryFileName = `${new Date().toISOString().split('T')[0]}-${title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '-')}.md`;
    const summaryPath = path.join(this.baseDir, 'summaries', summaryFileName);
    const summaryContent = `# Summary: ${title}\n\n## Key Takeaways\n\n${parts.map(p => `### ${p.topic}\n${p.summary}`).join('\n\n')}\n\n## References\n- Raw source preserved in knowledge_store index.`;
    await fs.writeFile(summaryPath, summaryContent);

    // 2. 识别并提取实体/概念
    const extractPrompt = `针对以下关于《${title}》的分析内容，请识别并提取其中的核心【实体 (Entities)】和【概念 (Concepts)】。
实体应包括：具体的模型、公司、产品、工具（如 Claude 3.7, OpenAI, Cursor）。
概念应包括：技术范式、协议、理论名词（如 MCP, System 2 Reasoning, Vibe Coding）。

对于每一个提取出来的项，请提供该文档中关于它的“最新见解”或“核心定义”。

【语言要求】：请全程使用【${this.language}】进行输出。
必须返回 JSON 格式：
{
  "entities": [{ "name": "...", "info": "..." }],
  "concepts": [{ "name": "...", "info": "..." }]
}

内容：\n${parts.map(p => `${p.topic}: ${p.summary}\n${p.content}`).join('\n\n')}`;

    const wikiEntries = await AIHelper.getJsonResponse<{ 
      entities: { name: string, info: string }[], 
      concepts: { name: string, info: string }[] 
    }>(
      this.aiProvider,
      extractPrompt,
      "知识萃取专家。",
      { entities: [], concepts: [] }
    );

    // 3. 并行更新各页面
    await Promise.all([
      ...wikiEntries.entities.map(e => this.synthesizePage('entities', e.name, e.info)),
      ...wikiEntries.concepts.map(c => this.synthesizePage('concepts', c.name, c.info))
    ]);

    // 4. 更新日志和索引
    await this.updateWikiIndex();
    await this.writeWikiLog(`Ingest | ${title}\n- Generated summary: summaries/${summaryFileName}\n- Updated ${wikiEntries.entities.length} entities and ${wikiEntries.concepts.length} concepts.`);
  }

  /**
   * 合成并更新单个 Wiki 页面
   */
  private async synthesizePage(type: 'entities' | 'concepts', name: string, newInfo: string) {
    const safeName = name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '-');
    const filePath = path.join(this.baseDir, type, `${safeName}.md`);
    let existingContent = "";

    try {
      existingContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      existingContent = `# ${name}\n\n## Summary\n\n(Generated from initial source)\n\n## Knowledge Graph\n\n`;
    }

    const mergePrompt = `你是一位知识库管理员。你的任务是将关于【${name}】的新信息整合进现有的 Wiki 页面中。
要求：
1. **去重并合并**：不要简单地把新信息贴在后面。如果新信息补充了旧信息，请在对应章节进行扩展；如果发生了冲突，请以新信息为准，或注明“最新更新显示...”。
2. **保持结构化**：使用 Markdown 标题和列表。
3. **知识复利**：确保最终输出是一个完整、连贯的百科条目。
4. **语言要求**：必须全程使用【${this.language}】进行输出，即使原始信息是其他语言。

现有内容：\n${existingContent}\n\n新摄取的信息：\n${newInfo}\n\n请直接返回整合后的全量 Markdown 内容。`;

    const mergedContent = await this.aiProvider.generateContent(mergePrompt, [], "资深的 Wiki 管理员。");
    await fs.writeFile(filePath, mergedContent.content);
  }

  /**
   * 自动重新生成 index.md
   */
  private async updateWikiIndex() {
    const folders = ['entities', 'concepts', 'summaries'];
    let indexContent = `# LLM Wiki Index\n\nCentral directory for the knowledge base.\n\n`;

    for (const folder of folders) {
      indexContent += `## ${folder.charAt(0).toUpperCase() + folder.slice(1)}\n\n`;
      try {
        const files = await fs.readdir(path.join(this.baseDir, folder));
        for (const file of files) {
          if (file.endsWith('.md')) {
            const content = await fs.readFile(path.join(this.baseDir, folder, file), 'utf-8');
            // 提取第一行作为摘要，或者查找 ## Summary 后的内容
            let summary = "";
            const summaryMatch = content.match(/## Summary\n\n([^\n]+)/);
            if (summaryMatch) {
              summary = summaryMatch[1].trim();
            } else {
              const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
              summary = lines[0] ? lines[0].slice(0, 100).trim() : "No summary available.";
            }
            indexContent += `- [[${folder}/${file}]]: ${summary}\n`;
          }
        }
      } catch {}
      indexContent += `\n`;
    }
    
    await fs.writeFile(path.join(this.baseDir, 'index.md'), indexContent);
  }

  /**
   * 写入日志
   */
  private async writeWikiLog(message: string) {
    const logPath = path.join(this.baseDir, 'log.md');
    const timestamp = new Date().toISOString().split('T')[0];
    const logEntry = `\n## [${timestamp}] ${message}\n`;
    await fs.appendFile(logPath, logEntry);
  }

  private async partitionContent(title: string, content: string): Promise<any[]> {
    this.log('AI Partitioning content into topics...');
    const partitionPrompt = `你是一位资深的知识管理与文档分析专家。
任务：对以下输入文档进行深度解析，提取全部核心价值信息，并重组为结构化的知识板块，以便直接存入个人知识库。

【核心原则】
1. **信息无损（关键要求）**：提取必须穷尽文档中的核心观点、重要数据、案例和结论。剔除冗余废话，但绝不能遗漏实质性内容。
2. **MECE拆分（相互独立，完全穷尽）**：按底层逻辑将文档拆分为 3-5 个核心板块。板块之间避免内容交叉，确保整体覆盖全篇。
3. **高信噪比表达**：在 "content" 中，请使用 Markdown 语法（如多级列表 -、加粗 **）对信息进行层级化排版，切忌输出无重点的长篇大段。
4. **语言一致性**：请全程使用【${this.language}】进行解析和输出。

【输出格式】
必须严格返回一个 JSON 数组，严禁包含任何 Markdown 格式块（如 \`\`\`json 等）或额外的解释性文本。
JSON 对象的结构如下：
[
  {
    "topic": "板块主题名（需精炼，如'行业发展趋势'）",
    "summary": "一句话概括该板块的核心洞察",
    "tags": ["标签1", "标签2", "标签3"],
    "content": "该板块的详细内容。必须使用 Markdown 列表格式进行结构化排版，保留所有关键细节和数据。"
  }
]

请开始处理以下文档《${title}》：
${content}`;

    return await AIHelper.getJsonResponse<any[]>(
      this.aiProvider,
      partitionPrompt,
      "资深的知识管理与文档分析专家。",
      [{ topic: "全文内容", summary: "内容拆分失败，返回全文", tags: ["未分类"], content }]
    );
  }

  private async savePartsAndGetIndex(docId: string, parts: any[]) {
    const processedParts: any[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      const fileName = `part_${i}.md`;
      const relativePath = path.join(docId, fileName);
      const absolutePath = path.join(this.baseDir, relativePath);

      const mdContent = `# ${part.topic}\n\n${part.content}`;
      await fs.writeFile(absolutePath, mdContent);

      processedParts.push({
        id: `part_${i}`,
        topic: part.topic,
        summary: (part.summary || "").trim(),
        keywords: part.tags || [],
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

  async mergeDocuments(docIds: string[], newTitle: string) {
    this.log(`Merging documents: ${docIds.join(', ')} into "${newTitle}"`);
    const index = await this.getIndex();
    const docsToMerge = index.filter(d => docIds.includes(d.id));
    if (docsToMerge.length < 2) throw new Error('Need at least 2 documents to merge');

    const newDocId = Math.random().toString(36).substring(2, 11);
    const newDocDir = path.join(this.baseDir, newDocId);
    await fs.mkdir(newDocDir, { recursive: true });

    const allNewParts: any[] = [];
    let partCounter = 0;

    for (const doc of docsToMerge) {
      for (const part of doc.parts) {
        const oldPath = path.join(this.baseDir, part.filePath);
        const newFileName = `part_${partCounter}.md`;
        const newRelativePath = path.join(newDocId, newFileName);
        const newAbsolutePath = path.join(this.baseDir, newRelativePath);

        // Copy file
        try {
          await fs.copyFile(oldPath, newAbsolutePath);
          allNewParts.push({
            ...part,
            id: `part_${partCounter}`,
            filePath: newRelativePath
          });
          partCounter++;
        } catch (err: any) {
          this.log(`Failed to copy part ${part.id} during merge: ${err.message}`, 'error');
        }
      }
    }

    const newEntry: KnowledgeIndexEntry = {
      id: newDocId,
      title: newTitle,
      date: new Date().toISOString(),
      parts: allNewParts
    };
    
    const newIndex = index.filter(d => !docIds.includes(d.id));
    newIndex.push(newEntry);
    await this.saveIndex(newIndex);

    // Cleanup old directories
    for (const docId of docIds) {
      const oldDir = path.join(this.baseDir, docId);
      try {
        const files = await fs.readdir(oldDir);
        for (const f of files) await fs.unlink(path.join(oldDir, f));
        await fs.rmdir(oldDir);
      } catch (e) {}
    }

    return { docId: newDocId };
  }

  async updateDocumentTitle(docId: string, newTitle: string) {
    this.log(`Updating title for document ${docId} to "${newTitle}"`);
    const index = await this.getIndex();
    const doc = index.find(d => d.id === docId);
    if (!doc) throw new Error('Document not found');
    
    doc.title = newTitle;
    await this.saveIndex(index);
    return { success: true };
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

  async updatePartKeywords(docId: string, partId: string, newKeywords: string[]) {
    this.log(`Updating keywords for ${docId}/${partId}`);
    const index = await this.getIndex();
    const doc = index.find(d => d.id === docId);
    if (!doc) throw new Error('Document not found');
    
    const part = doc.parts.find(p => p.id === partId);
    if (!part) throw new Error('Part not found');
    
    part.keywords = newKeywords;
    await this.saveIndex(index);
    return { success: true };
  }

  async updatePartContent(docId: string, partId: string, newContent: string) {
    this.log(`Updating content for ${docId}/${partId}`);
    const index = await this.getIndex();
    const doc = index.find(d => d.id === docId);
    if (!doc) throw new Error('Document not found');
    
    const part = doc.parts.find(p => p.id === partId);
    if (!part) throw new Error('Part not found');
    
    const absolutePath = path.join(this.baseDir, part.filePath);
    await fs.writeFile(absolutePath, newContent);
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
      
      // --- 1. 加载原有 ID 分片索引 ---
      if (this.dataSourcePreference === 'part' || this.dataSourcePreference === 'both') {
        index.forEach(doc => {
          doc.parts.forEach(p => {
            allTopicIndex.push({ 
              type: 'part',
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
      }

      // --- 2. 加载 Wiki 页面索引 (Entities/Concepts/Summaries) ---
      if (this.dataSourcePreference === 'wiki' || this.dataSourcePreference === 'both') {
        const wikiFolders = ['entities', 'concepts', 'summaries'];
        for (const folder of wikiFolders) {
          try {
            const files = await fs.readdir(path.join(this.baseDir, folder));
            for (const file of files) {
              if (file.endsWith('.md')) {
                const wikiContent = await fs.readFile(path.join(this.baseDir, folder, file), 'utf-8');
                const summaryMatch = wikiContent.match(/## Summary\n\n([^\n]+)/);
                const summary = summaryMatch ? summaryMatch[1].trim() : `Synthesized knowledge page for ${file.replace('.md', '')}`;
                
                allTopicIndex.push({
                  type: 'wiki',
                  folder,
                  fileName: file,
                  docTitle: `Wiki: ${folder.charAt(0).toUpperCase() + folder.slice(1)}`,
                  topic: file.replace('.md', ''),
                  summary,
                  keywords: [file.replace('.md', ''), folder],
                  filePath: path.join(folder, file)
                });
              }
            }
          } catch {}
        }
      }

      this.log(`Parallel searching across ${allTopicIndex.length} potential topics...`);

      // 2. 并行筛选候选节点 (通过关键词匹配)
      const candidateSets = await Promise.all(allSearchKeywords.map(async (kw) => {
        const kwLower = kw.toLowerCase();
        return allTopicIndex.filter(p => 
          p.topic.toLowerCase().includes(kwLower) || 
          p.summary.toLowerCase().includes(kwLower) ||
          p.docTitle.toLowerCase().includes(kwLower) ||
          p.keywords.some((k: string) => k.toLowerCase().includes(kwLower))
        ).map(m => m.type === 'wiki' ? `wiki|${m.folder}|${m.fileName}` : `${m.docId}|${m.partId}`);
      }));

      // 合并候选并去重
      const candidateIds = [...new Set(candidateSets.flat())];
      
      if (candidateIds.length === 0) {
        this.log(`No relevant topics found through keywords. Keywords were: [${allSearchKeywords.join(', ')}]. Index size: ${allTopicIndex.length}`);
        this.log('Falling back to hybrid index selection (Prioritizing document parts).');
        
        // 确保原始文档分片 (parts) 优先被包含在兜底搜索池中
        const docParts = allTopicIndex.filter(p => p.type === 'part').slice(-30);
        const wikiParts = allTopicIndex.filter(p => p.type === 'wiki').slice(-30); // 仅取最近 30 个 Wiki 页面
        
        const fallbackPool = [...docParts, ...wikiParts];
        candidateIds.push(...fallbackPool.map(p => p.type === 'wiki' ? `wiki|${p.folder}|${p.fileName}` : `${p.docId}|${p.partId}`));
      }


      this.log(`Found ${candidateIds.length} candidate parts across all keywords.`);

      // 3. 从候选节点中精准选择
      const candidates = candidateIds.map(id => {
        if (id.startsWith('wiki|')) {
          const [_, folder, fileName] = id.split('|');
          return allTopicIndex.find(p => p.type === 'wiki' && p.folder === folder && p.fileName === fileName);
        } else {
          const [docId, partId] = id.split('|');
          return allTopicIndex.find(p => p.docId === docId && p.partId === partId);
        }
      }).filter(Boolean);

      const selectionPrompt = `你是一个精准的资料检索助手。请根据用户查询，从以下候选知识板块中选出最相关的 3-10 个 ID。
只需输出 JSON 数组，如: ["docId|partId", "wiki|folder|fileName"]

用户查询: "${query}"

    候选索引：
${candidates.map((p, i) => {
  const id = p.type === 'wiki' ? `wiki|${p.folder}|${p.fileName}` : `${p.docId}|${p.partId}`;
  return `${i + 1}. [ID: ${id}] 文档: ${p.docTitle}\n   主题: ${p.topic}\n   关键词: ${p.keywords.join(', ')}\n   摘要: ${p.summary}`;
}).join('\n')}`;

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
        if (key.startsWith('wiki|')) {
          const [_, folder, fileName] = key.split('|');
          const entry = allTopicIndex.find(p => p.type === 'wiki' && p.folder === folder && p.fileName === fileName);
          if (entry) {
            try {
              const content = await fs.readFile(path.join(this.baseDir, entry.filePath), 'utf-8');
              finalContext += `[Wiki: ${folder}/${fileName}]\n${content}\n\n---\n\n`;
            } catch (e: any) {
              this.log(`Failed to read wiki content ${key}: ${e.message}`, 'error');
            }
          }
        } else {
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
      }

      return finalContext;

    } catch (error: any) {
      this.log(`Query failed: ${error.message}`, 'error');
      return "";
    }
  }
}
