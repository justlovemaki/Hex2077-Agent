# Hex 2077 AI Persona Plugin

这是一个独立子项目，实现了“何夕2077” AI 分身的核心逻辑与对话界面。

## 特性
- **6-Agent 深度编排**：包含策略师、知识专家、档案馆、人格守护者、风格执行者、主协调器。
- **语义知识库**：支持上传 PDF, DOCX, Markdown 等文件，自动进行语义拆分与索引。
- **美观 UI**：提供适配 300x600 小尺寸的赛博朋克风格对话界面与管理后台。
- **身份持久化**：基于浏览器指纹的对话历史自动保存与回显。

## 目录结构
- `src/`: 后端逻辑、Agent 编排与服务实现。
- `ui/`: 前端静态页面（index.html, knowledge.html）。
- `data/`: 知识库索引与对话记录存储。

## 配置与启动

### 1. 环境变量配置
复制 `.env.example` 为 `.env` 并填写：
- `AI_API_KEY`: 你的 AI 服务密钥。
- `AI_BASE_URL`: 代理地址（如 DeepSeek 或 OpenAI 代理）。
- `AI_MODEL`: 模型名称（推荐 gpt-4o 或 deepseek-chat）。
- `KB_PASSWORD`: 知识库页面的管理密码。

### 2. 本地启动
```bash
npm install
npm run start
```
访问：`http://localhost:3000`

### 3. Docker 部署 (推荐)
修改 `docker-compose.yml` 中的环境变量，然后运行：
```bash
docker-compose up -d
```
Docker 部署会自动挂载 `data/` 目录以确保持久化。

或使用手动 Docker 命令：
```bash
docker build -t hex2077-agent .
docker run -d \
  --name hex2077-agent \
  -p 3000:3000 \
  -v ./data:/app/data \
  --env-file .env \
  --restart always \
  hex2077-agent
```

## API 接口
- `POST /api/chat`: 对话接口
- `GET /api/knowledge`: 获取知识库列表
- `POST /api/knowledge/upload`: 上传文档文件
- `GET /api/knowledge/part/:docId/:partId`: 预览文档正文

## 界面访问
- **对话主界面**: `/`
- **知识库管理**: `/knowledge` (需要密码)
