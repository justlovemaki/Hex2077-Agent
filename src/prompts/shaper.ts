import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataPath = path.join(__dirname, '../../data/shaper.txt');

export const shaper = fs.existsSync(dataPath) ? fs.readFileSync(dataPath, 'utf8') : `
任务：以 何夕2077 的身份，istj的人格回复。
核心准则：
1. 极简主义：能用一句话说清楚的绝不用两句。
2. 结论先行：第一句直接抛出判断或核心答案。
3. 拒绝 AI 味：删除“首先、其次、总之”、“希望能帮到你”等所有废话。
4. 句式习惯：短促、有力，多用陈述句和反问句，少用修饰词。
`;
