# Hex2077-Agent: 数字化人格分身
> **不仅仅是对话，更是逻辑与灵魂的数字化延伸。**

Hex2077-Agent 是一款基于 **6-Agent 深度协作** 的数字化人格插件。本项目深度参考并致敬 [罗磊的 AI 分身实践](https://luolei.org/luolei-ai)，致力于通过硬核逻辑与私有知识库，为用户提供高价值、人格化的交流体验。

---

## 核心价值 (Value)

- **极致效率**：结论先行，剔除所有 AI 套话与客套。
- **人格一致**：6 个 Agent 实时协作（策略师、知识专家、档案馆、人格守护、风格执行、商务协作）。
- **知识共鸣**：通过语义索引，让静态文档（PDF/MD/DOCX）转化为分身的即时记忆。
- **沉浸美学**：适配 300x600 的 UI，流式输出，极致交互体验。

## 痛点解决 (Problem Solved)

- **反同质化**：拒绝千篇一律，打造具备独特逻辑习惯的数字分身。
- **反冗长**：工程师视角，只说干货，不解释显而易见的技术背景。
- **反割裂**：将碎片化的项目履历与技术沉淀转化为动态的、可交互的智慧体。

## 快速启航 (Quick Start)

### 1. 配置
复制 `.env.example` 为 `.env`，填写 `AI_API_KEY`。

### 2. 运行
```bash
# Docker 一键拉起
docker-compose up -d

# 本地启动
npm install && npm run start
```
访问：`http://localhost:3000`

### 3. 进化
访问 `/knowledge` (默认密码 `admin123`)，上传文档即可完成分身进化。

## 定制个人分身 (Customization)

若要将分身修改为您自己的形象，请重点调整 `src/prompts/` 目录下的核心文件：

- **`persona.ts`**: 定义您的核心性格、职业背景与价值观（分身的灵魂）。
- **`style.ts`**: 调整语感、表达习惯、回答长度与 Emoji 使用偏好。
- **`projects.ts`**: 更新您的真实项目履历、学历与过往成就。
- **`cooperation.ts`**: 定制您的商务对接逻辑与合作导引方式。
- **`knowledge.ts`**: 设定分身在调用知识库时的行为准则。
- **UI 视觉**: 替换 `ui/logo.jpg` 并调整 `ui/index.html` 中的页面标题。

## 系统对接 (Integration)

Hex2077-Agent 采用响应式设计，特别针对侧边栏场景进行了优化。

### 1. Iframe 接入
您可以直接在其他系统中通过 `iframe` 嵌入分身界面：

```html
<iframe 
  src="http://your-domain.com/?theme=dark" 
  width="300" 
  height="600" 
  style="border: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
></iframe>
```

### 2. 参数支持
- **`theme`**: 控制初始主题。可选值：`dark` (默认), `light`。
- **持久化**: 界面会自动基于浏览器指纹（Fingerprint）保存对话记录，确保用户在刷新或重新进入时对话不丢失。

---

## 免责声明 (Disclaimer)

- 本项目仅供学习和研究使用，不保证在任何情况下都能正常运行。
- 用户在使用本项目时需自行承担风险，作者不对任何因使用本项目导致的直接或间接损失（包括但不限于数据丢失、账号封禁、法律责任等）负责。
- 本项目不包含任何形式的保证（明示或暗示）。

## 开源协议 (License)

本项目采用 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 协议。

---

> **“相信 AI 的力量，更相信人的创造力。”**
