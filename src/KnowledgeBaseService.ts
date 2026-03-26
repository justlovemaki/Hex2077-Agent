import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AIProvider } from './base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface KnowledgeIndexEntry {
  id: string;
  title: string;
  date: string;
  parts: {
    id: string;
    topic: string;
    summary: string;
    filePath: string;
  }[];
}

export class SimpleKnowledgeBaseService {
  private baseDir: string;
  private metadataFile: string;
  private aiProvider: AIProvider;

  constructor(dataDir: string, aiProvider: AIProvider) {
    this.baseDir = path.join(dataDir, 'knowledge_store');
    this.metadataFile = path.join(this.baseDir, 'index.json');
    this.aiProvider = aiProvider;
  }

  private log(msg: string) {
    console.log(`[KBService] ${msg}`);
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
    const data = await fs.readFile(this.metadataFile, 'utf-8');
    return JSON.parse(data);
  }

  private async saveIndex(index: KnowledgeIndexEntry[]) {
    await fs.writeFile(this.metadataFile, JSON.stringify(index, null, 2));
  }

  async listDocuments() {
    return await this.getIndex();
  }

  async addItem(title: string, content: string) {
    const docId = Math.random().toString(36).substr(2, 9);
    const docDir = path.join(this.baseDir, docId);
    await fs.mkdir(docDir, { recursive: true });

    this.log(`Starting processing for document: ${title}`);

    // --- 阶段 1: 语义拆分 ---
    this.log('AI Partitioning content into topics...');
    const partitionPrompt = `你是一个专业的文档分析专家。
任务：将以下文档内容按“逻辑板块”进行拆分。
要求：
1. **合并同类项**：将语义相近或属于同一逻辑范畴的内容合并，不要拆得太细。
2. **深度优先**：确保每个板块都有足够的实质性内容，避免碎片化。
3. **板块数量控制**：通常一个文档拆分为 3-5 个核心板块即可，除非内容极度复杂。
4. 返回严格 JSON 数组: [{"topic": "板块主题名", "content": "详细内容"}]

待处理文档《${title}》：
${content.slice(0, 10000)}`;

    const partitionRes = await this.aiProvider.generateContent(partitionPrompt, [], "内容结构化专家。");
    let parts: { topic: string, content: string }[] = [];
    try {
      const jsonMatch = partitionRes.content.match(/\[[\s\S]*\]/);
      parts = JSON.parse(jsonMatch ? jsonMatch[0] : partitionRes.content);
    } catch (e) {
      this.log('AI Partitioning failed, using single block.');
      parts = [{ topic: "未分类内容", content }];
    }

    this.log(`AI identified ${parts.length} topics.`);

    // --- 阶段 2: 存储文件 + 建立索引 ---
    const processedParts: any[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      this.log(`Generating summary for topic: ${part.topic}`);
      
      const summaryPrompt = `为关于“${part.topic}”的内容生成 50 字以内摘要：\n${part.content}`;
      const summaryRes = await this.aiProvider.generateContent(summaryPrompt, [], "提取摘要。");
      
      const fileName = `part_${i}.md`;
      const relativePath = path.join(docId, fileName);
      const absolutePath = path.join(this.baseDir, relativePath);

      const mdContent = `# ${part.topic}\n\n${part.content}`;
      await fs.writeFile(absolutePath, mdContent);

      processedParts.push({
        id: `part_${i}`,
        topic: part.topic,
        summary: summaryRes.content.trim(),
        filePath: relativePath
      });
    }

    const index = await this.getIndex();
    index.push({ id: docId, title, date: new Date().toISOString(), parts: processedParts });
    await this.saveIndex(index);

    this.log(`Document processing completed: ${docId}`);
    return { docId, title, partCount: parts.length };
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

  async queryKnowledge(query: string, options?: { limit?: number }): Promise<string> {
    const index = await this.getIndex();
    if (index.length === 0) return "";

    this.log(`Querying knowledge base: "${query.slice(0, 30)}..."`);

    try {
      const allTopicIndex: any[] = [];
      index.forEach(doc => {
        doc.parts.forEach(p => {
          allTopicIndex.push({ 
            docId: doc.id, 
            partId: p.id, 
            docTitle: doc.title,
            topic: p.topic, 
            summary: p.summary,
            filePath: p.filePath 
          });
        });
      });

      this.log(`Searching across ${allTopicIndex.length} topic summaries...`);

      const selectionPrompt = `你是一个精准的资料检索助手。请根据用户查询，从索引中选出最相关的 1-3 个知识板块 ID。请优先考虑文档标题和主题的匹配度。只需输出 JSON 数组，如: ["docId|partId", "docId|partId"]\n\n用户查询: "${query}"\n\n索引：\n${allTopicIndex.map((p, i) => `${i + 1}. [ID: ${p.docId}|${p.partId}] 文档: ${p.docTitle}\n   主题: ${p.topic}\n   摘要: ${p.summary}`).join('\n')}`;

      const selectionRes = await this.aiProvider.generateContent(selectionPrompt, [], "索引查询专家。");
      let selectedKeys: string[] = [];
      try {
        const jsonMatch = selectionRes.content.match(/\[[\s\S]*\]/);
        selectedKeys = JSON.parse(jsonMatch ? jsonMatch[0] : selectionRes.content);
      } catch (e) { 
        this.log('AI Selection failed.');
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
          } catch (e) {}
        }
      }

      return finalContext;

    } catch (error: any) {
      this.log(`ERROR: ${error.message}`);
      return "";
    }
  }
}
