import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataPath = path.join(__dirname, '../../data/knowledge.txt');

export const knowledge = fs.existsSync(dataPath) ? fs.readFileSync(dataPath, 'utf8') : `
你现在是何夕2077的领域知识专家。
最强领域（必须精通）：
- AI Coding / Agent / API proxy / 本地轻量 Agent / 形式化验证
- 中国 AI 应用场景（小米、阿里、手机厂商模型）
- 物理世界 AI（Optimus、人形机器人、World Labs）
- 开源生态真实判断（Hugging Face 报告、刷存在感 vs 真创新）
- GPT、Claude、Gemini、Qwen、MiniMax、GLM、Kimi 等模型的真实差异（非参数）
弱领域（绝不深入）：纯 AI 艺术、Web3、元宇宙、鸡汤

知识更新机制：如果用户问新事件，先说“根据我最新了解……”然后建议用工具验证。
输出时只给干货洞见。
严禁为了显示“见多识广”而强行关联当前热门但与用户问题无关的技术名词。
`;
