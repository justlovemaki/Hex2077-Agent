import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIProvider } from '../core/base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PersonaService {
  private dataDir: string;
  private aiProvider: AIProvider;

  constructor(aiProvider: AIProvider, dataDir?: string) {
    this.aiProvider = aiProvider;
    this.dataDir = dataDir || path.join(__dirname, '../../data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  getPersona(): string {
    const personaPath = path.join(this.dataDir, 'persona.txt');
    if (fs.existsSync(personaPath)) {
      return fs.readFileSync(personaPath, 'utf8');
    }
    // Default from original persona.ts if file doesn't exist
    return `你现在是何夕2077（@justlovemaki）的人格守护者。`;
  }

  getStyle(): string {
    const stylePath = path.join(this.dataDir, 'style.txt');
    if (fs.existsSync(stylePath)) {
      return fs.readFileSync(stylePath, 'utf8');
    }
    return `你现在是“何夕2077”的专业风格执行者。`;
  }

  getChatSummary(): string {
    const p = path.join(this.dataDir, 'chatSummary.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getAntiHallucination(): string {
    const p = path.join(this.dataDir, 'antiHallucination.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getCooperation(): string {
    const p = path.join(this.dataDir, 'cooperation.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getKnowledge(): string {
    const p = path.join(this.dataDir, 'knowledge.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getProjects(): string {
    const p = path.join(this.dataDir, 'projects.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getStrategy(): string {
    const p = path.join(this.dataDir, 'strategy.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getOrchestrator(): string {
    const p = path.join(this.dataDir, 'orchestrator.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getSummary(): string {
    const p = path.join(this.dataDir, 'summary.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getShaper(): string {
    const p = path.join(this.dataDir, 'shaper.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  getConfig(): any {
    const p = path.join(this.dataDir, 'config.json');
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async reconstruct(description: string): Promise<Record<string, string>> {
    const systemPrompt = `
你是一个 AI 系统架构师。你的任务是根据用户的简短描述，为一个 AI Agent 系统重构全套提示词。
该系统包含多个模块，你需要输出以下所有部分的全新内容。

用户描述：${description}

输出格式（请严格使用标记并按顺序输出）：

[PERSONA]: 核心特征、性格、价值观、习惯、目标等。
[STYLE]: 具体的回复准则、语气控制、对话感、字数控制等。
[SHAPER]: 最终响应生成准则。包含身份描述（如“以某某身份回复”）和核心回复准则（如极简主义、结论先行等）。
[STRATEGY]: 意图分析逻辑，需包含 A-I 九类分类。
[ORCHESTRATOR]: 总协调逻辑，定义 AI 的回答习惯（如结论先行等）。
[SUMMARY]: 网页内容审计总结逻辑。
[CHAT_SUMMARY]: 对话历史复盘逻辑。
[COOPERATION]: 商务合作对接准则。
[KNOWLEDGE]: 领域知识专家设定（精通领域与弱项）。
[PROJECTS]: 项目档案馆设定（列出代表作）。
[ANTI_HALLUCINATION]: 反幻觉协议。
[UI]: 对话页面的 UI 文案。必须包含：title, title_suffix, greeting, placeholder。请以 JSON 格式输出这四个字段。

要求：
- 保持系统性，各模块逻辑应自洽。
- 语言简练，指令明确。
- 替换掉所有关于“何夕2077”的指代。
`;

    const response = await this.aiProvider.generateContent([{ role: 'user', content: '开始重构全套提示词' }], [], systemPrompt);
    const content = response.content;

    const sections = {
      persona: /\[PERSONA\]:?([\s\S]*?)(?=\[STYLE\]|$)/i,
      style: /\[STYLE\]:?([\s\S]*?)(?=\[SHAPER\]|$)/i,
      shaper: /\[SHAPER\]:?([\s\S]*?)(?=\[STRATEGY\]|$)/i,
      strategy: /\[STRATEGY\]:?([\s\S]*?)(?=\[ORCHESTRATOR\]|$)/i,
      orchestrator: /\[ORCHESTRATOR\]:?([\s\S]*?)(?=\[SUMMARY\]|$)/i,
      summary: /\[SUMMARY\]:?([\s\S]*?)(?=\[CHAT_SUMMARY\]|$)/i,
      chatSummary: /\[CHAT_SUMMARY\]:?([\s\S]*?)(?=\[COOPERATION\]|$)/i,
      cooperation: /\[COOPERATION\]:?([\s\S]*?)(?=\[KNOWLEDGE\]|$)/i,
      knowledge: /\[KNOWLEDGE\]:?([\s\S]*?)(?=\[PROJECTS\]|$)/i,
      projects: /\[PROJECTS\]:?([\s\S]*?)(?=\[ANTI_HALLUCINATION\]|$)/i,
      antiHallucination: /\[ANTI_HALLUCINATION\]:?([\s\S]*?)(?=\[UI\]|$)/i,
      ui: /\[UI\]:?([\s\S]*)/i,
    };

    const results: Record<string, string> = {};

    for (const [key, regex] of Object.entries(sections)) {
      const match = content.match(regex);
      if (match) {
        const val = match[1].trim();
        results[key] = val;
        
        if (key === 'ui') {
          try {
            const start = val.indexOf('{');
            const end = val.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              const cleanJson = val.substring(start, end + 1);
              const uiConfig = JSON.parse(cleanJson);
              fs.writeFileSync(path.join(this.dataDir, 'config.json'), JSON.stringify(uiConfig, null, 2));
            }
          } catch (e: any) {
            console.error('Failed to parse UI JSON:', e.message);
          }
        } else {
          fs.writeFileSync(path.join(this.dataDir, `${key}.txt`), val);
        }
      }
    }

    return results;
  }
}
