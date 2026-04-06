import { PersonaService } from '../services/PersonaService.js';
import { OpenAIProvider } from '../providers/OpenAIProvider.js';
import 'dotenv/config';
import * as readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const baseURL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const model = process.env.AI_MODEL || 'gpt-4o';

if (!apiKey) {
  console.error('Error: AI_API_KEY or OPENAI_API_KEY is not set in .env');
  process.exit(1);
}

const aiProvider = new OpenAIProvider(apiKey, baseURL, model);
const personaService = new PersonaService(aiProvider, './data');

rl.question('请输入新的人格描述 (例如: "一个活泼、幽默的二次元少女"): ', async (description) => {
  if (!description) {
    console.log('描述不能为空。');
    rl.close();
    return;
  }

  console.log('正在重构人格设定，请稍候...');
  try {
    const result = await personaService.reconstruct(description);
    console.log('\n--- 重构成功 ---');
    console.log(`\n已成功更新 ${Object.keys(result).length} 个提示词模块: [${Object.keys(result).join(', ')}]`);
    console.log('\n[新的人格 (Persona)]:\n', result.persona);
    console.log('\n[新的风格 (Style)]:\n', result.style);
    console.log('\n[最终回复准则 (Shaper)]:\n', result.shaper);
    console.log('\n所有提示词已同步更新至 data/ 目录下的对应 .txt 文件。');
  } catch (err: any) {
    console.error('重构失败:', err.message);
  } finally {
    rl.close();
  }
});
