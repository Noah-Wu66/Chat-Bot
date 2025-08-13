# AI Chat Bot - 智能对话应用

基于 Aihubmix OpenAI API 构建的现代化 AI 对话应用，支持 GPT-4o 和 GPT-5 模型。

## 功能特性

### 🤖 多模型支持
- **GPT-4o**: `gpt-4o` - 最新的多模态模型，支持文本和图像
- **GPT-5**: `gpt-5` - 最新的推理模型，支持深度思考

### 🎯 核心功能
- **Chat Completions API**: 标准对话模式（GPT-4o）
- **Responses API**: 高级多功能接口（GPT-5）
- **流式输出**: 实时显示回复内容
- **图像识别**: 支持图片上传和分析（GPT-4o 专属）
- **函数调用**: 内置工具函数（天气查询、数学计算、时间获取）
- **推理深度控制**: GPT-5 专属功能
- **输出篇幅控制**: 可调节回复详细程度（GPT-5 专属）

### 🎨 用户界面
- **现代化设计**: 基于 Tailwind CSS 的响应式界面
- **暗色模式**: 自动适配系统主题
- **对话管理**: 创建、编辑、删除、搜索对话
- **参数调节**: 完整的模型参数控制面板
- **拖拽上传**: 支持图片拖拽上传
- **代码高亮**: 内置语法高亮显示

### 💾 数据存储
- **MongoDB**: 持久化存储对话历史
- **会话管理**: 自动保存和恢复对话
- **搜索功能**: 快速查找历史对话

## 技术栈

- **前端**: Next.js 14, React 18, TypeScript
- **样式**: Tailwind CSS
- **状态管理**: Zustand
- **数据库**: MongoDB + Mongoose
- **API**: Aihubmix OpenAI API
- **UI 组件**: 自定义组件库
- **Markdown**: React Markdown + 语法高亮

## 快速开始

### 1. 环境要求
- Node.js 18+
- MongoDB 数据库
- Aihubmix API Key

### 2. 安装依赖
```bash
npm install
```

### 3. 环境配置
复制 `.env.local.example` 为 `.env.local` 并配置：

```env
# Aihubmix OpenAI API 配置
AIHUBMIX_API_KEY=sk-your-aihubmix-api-key-here
AIHUBMIX_BASE_URL=https://aihubmix.com/v1

# MongoDB 配置
MONGODB_URI=mongodb://localhost:27017/ai-chat-bot
# 或使用 MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/ai-chat-bot

# Next.js 配置
NEXTAUTH_SECRET=your-nextauth-secret-here
NEXTAUTH_URL=http://localhost:3000
```

### 4. 启动应用
```bash
# 开发模式
npm run dev

# 生产构建
npm run build
npm start
```

访问 `http://localhost:3000` 开始使用。

## API 使用说明

### Chat Completions API
适用于 GPT-4o 模型的标准对话：

```typescript
// 基本对话
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: { content: '你好' },
    model: 'gpt-4o',
    settings: {
      temperature: 0.8,
      maxTokens: 4096,
      stream: true
    }
  })
});

// 图像识别
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: {
      content: '这张图片里有什么？',
      images: ['data:image/jpeg;base64,...']
    },
    model: 'gpt-4o',
    settings: { stream: true }
  })
});
```

### Responses API
适用于 GPT-5 模型的高级功能：

```typescript
// GPT-5 推理模式
const response = await fetch('/api/responses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input: '解释量子计算的基本原理',
    model: 'gpt-5',
    settings: {
      reasoning: { effort: 'high' },
      text: { verbosity: 'medium' },
      stream: true
    }
  })
});
```

## 模型特性对比

| 模型 | API 类型 | 视觉 | 工具 | 推理 | 最大 Token |
|------|----------|------|------|------|------------|
| gpt-4o | Chat | ✅ | ✅ | ❌ | 4096 |
| gpt-5 | Responses | ❌ | ✅ | ✅ | 8192 |

## 内置工具函数

应用内置了以下工具函数：

1. **天气查询** (`get_current_weather`)
   - 获取指定地点的天气信息
   - 支持摄氏度和华氏度

2. **数学计算** (`calculate_math`)
   - 执行数学表达式计算
   - 安全的计算环境

3. **时间查询** (`get_current_time`)
   - 获取当前时间
   - 支持不同时区

## 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API 路由
│   │   ├── chat/          # Chat Completions API
│   │   ├── responses/     # Responses API
│   │   └── conversations/ # 对话管理 API
│   ├── layout.tsx         # 根布局
│   ├── page.tsx          # 主页面
│   └── globals.css       # 全局样式
├── components/            # React 组件
│   ├── ChatInterface.tsx # 主聊天界面
│   ├── MessageList.tsx   # 消息列表
│   ├── MessageInput.tsx  # 消息输入
│   ├── ModelSelector.tsx # 模型选择器
│   ├── SettingsPanel.tsx # 设置面板
│   └── Sidebar.tsx       # 侧边栏
├── lib/                  # 核心库
│   ├── types.ts          # 类型定义
│   ├── openai.ts         # OpenAI 客户端
│   └── mongodb.ts        # 数据库操作
├── store/                # 状态管理
│   └── chatStore.ts      # Zustand 状态
└── utils/                # 工具函数
    └── helpers.ts        # 辅助函数
```

## Zeabur 部署说明

### 快速部署
1. 推送代码到 Git 仓库
2. 在 Zeabur 控制台连接仓库
3. 设置环境变量（见上方配置）
4. 点击部署

### 部署配置
项目已针对 Zeabur 优化，包含：
- 简化的 Dockerfile
- 优化的构建配置
- 完整的环境变量支持

详细部署指南请查看 `DEPLOYMENT.md` 文件。

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT License

## 支持

如有问题或建议，请创建 Issue 或联系开发团队。
