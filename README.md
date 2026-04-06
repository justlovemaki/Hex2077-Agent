# Hex2077-Agent: 三位一体的数字化人格系统
> **灵魂 (人格)、大脑 (知识)、躯体 (渠道) 的深度融合。**

---

Hex2077-Agent 不仅仅是一个 AI 分身，它是一个**具备持续进化能力的数字化分身**。它通过将独特的“人格逻辑”、自动生成的“百科知识库”与“多端通讯渠道”深度结合，实现了从“简单对话”到“数字生命”的跃迁。

## 核心架构：三位一体 (The Trinity)

### 1. 灵魂 (The Soul): 6-Agent 数字化人格
深度参考并致敬 [罗磊的 AI 分身实践](https://luolei.org/luolei-ai)，通过 **6-Agent 深度协作架构**，Hex2077 拥有严谨且连贯的 ISTJ 型逻辑人格：
- **逻辑一致性**：由 Orchestrator 与 Style Enforcer 共同确保每一句回答都符合设定的语感与逻辑。
- **角色化专家**：Strategy 调整深度，Knowledge Expert 检索知识，Project Archivist 管理履历，Persona Keeper 守护灵魂。
- **结果导向**：剔除客套，直击核心，像真实的资深工程师一样思考和表达。

### 2. 大脑 (The Brain): LLM Wiki 知识复利
不同于传统的 RAG 检索，Hex2077 拥有一个**会自我生长的百科全书**。它深度实践了 Karpathy 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 构想：
- **知识合成 (Synthesis)**：自动将零散文档转化为互联的实体 (Entities) 与概念 (Concepts) 页面。
- **复利增长 (Compounding)**：新知识与旧知识**智能合并**。每次摄取都是一次“认知升级”，而不是简单的信息堆积。
- **可视化大脑**：生成的 Wiki 支持 **Obsidian** 挂载。你可以亲眼看到分身的知识图谱如何随时间变得愈发致密。

### 3. 躯体 (The Body): 全渠道多端连接
你的分身应在任何你出现的地方：
- **IM 全覆盖**：集成 OpenClaw China，支持微信（个人号/公众号）、飞书、钉钉、企业微信、QQ。
- **无缝交互**：无论你在 Web 端上传 PDF，还是在飞书群里提问，分身都共用同一个“大脑”和“灵魂”。
- **标准协议**：提供兼容 OpenAI 的标准接口，让分身可以作为后端驱动任意第三方 AI 客户端。

---

## 进化工作流 (The Evolution Workflow)

1.  **输入 (Input)**：将原始素材 (PDF/MD/DOCX) 通过 Web 上传。
2.  **摄取 (Ingest)**：程序自动解析并提取核心摘要。
3.  **合成 (Synthesize)**：LLM 识别并更新对应的 Wiki 百科页面，完成知识的“无损融合”。
4.  **分发 (Distribute)**：更新后的知识立即同步到微信、飞书、网页等所有连接渠道。

---

## 快速部署 (Quick Start)

### 1. 准备环境
复制 `.env.example` 为 `.env`，配置 `AI_API_KEY`。

### 2. 一键拉起
```bash
# 推荐 Docker 部署
docker-compose up -d

# 本地启动
npm install && npm run start
```
访问：`http://localhost:3000`

### 3. 开始进化
进入 `/knowledge` (默认密码 `admin123`)，上传文档。你的分身会立即开始阅读、思考并更新自己的百科全书。

### 4. 人格重塑 (Persona Reconstruction)
如果你想彻底改变分身的人格设定（例如从“严谨工程师”变为“活泼少女”），可以使用一键重构功能：
```bash
npm run reconstruct
```
按提示输入新的人格描述，系统会自动重构包括核心人格、回复风格、调度策略、项目档案在内的 11 个提示词模块。重构后的配置存储在 `data/*.txt` 中，实时生效。

---

## 数据目录规范 (Data Standards)

- `data/raw/`：**原始记录**。不可变的源头文件。
- `data/knowledge_store/`：**进化后的 Wiki**。
  - `entities/` & `concepts/`：自动合成的百科页面。
  - `summaries/`：文档摘要。
  - `index.md` & `log.md`：知识地图与进化日志。

---

## 开源与免责 (License & Disclaimer)

本项目采用 [GPL-3.0](LICENSE) 协议。请在遵守当地法律法规的前提下使用，开发者不对任何因分身言论或数据处理导致的损失负责。

---

> **“让知识在对话中复利，让灵魂在数字中永生。”**
