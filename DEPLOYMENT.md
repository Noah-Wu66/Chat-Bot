# Zeabur 部署指南

### 方法一：使用 Git 仓库部署（推荐）

1. **推送代码到 Git 仓库**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **在 Zeabur 控制台**
   - 连接你的 Git 仓库
   - 选择 Node.js 运行时
   - 设置环境变量（见下方）
   - 点击部署

3. **环境变量配置**
   ```
   AIHUBMIX_API_KEY=sk-your-aihubmix-api-key-here
   AIHUBMIX_BASE_URL=https://aihubmix.com/v1
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/ai-chat-bot
  NEXTAUTH_SECRET=your-nextauth-secret-here # 可选，未设置时使用内置默认值
   NEXTAUTH_URL=https://your-app.zeabur.app
   NODE_ENV=production
   ```

### 方法二：使用 Docker 部署

1. **确保项目根目录有以下文件**
   - `Dockerfile`（已优化）
   - `.dockerignore`
   - `package.json`

2. **在 Zeabur 控制台**
   - 选择 Docker 部署
   - 上传项目文件或连接 Git 仓库
   - 设置环境变量
   - 点击部署

### 故障排除

#### 构建失败：npm ci 错误
**问题**: `npm ci` 需要 `package-lock.json` 文件

**解决方案**: 
- 使用修改后的 Dockerfile（已修复）
- 或者在本地生成 `package-lock.json`：
  ```bash
  npm install
  git add package-lock.json
  git commit -m "Add package-lock.json"
  git push
  ```

#### 内存不足错误
**解决方案**: 在 `next.config.js` 中添加：
```javascript
experimental: {
  workerThreads: false,
  cpus: 1
}
```

#### 环境变量未生效
**检查**:
- 确保在 Zeabur 控制台正确设置了所有环境变量
- 变量名称完全匹配（区分大小写）
- MongoDB URI 格式正确



## 数据库设置

### MongoDB Atlas（推荐）
1. 创建 MongoDB Atlas 账户
2. 创建新集群
3. 设置数据库用户
4. 获取连接字符串
5. 将连接字符串设置为 `MONGODB_URI`

### 本地 MongoDB
```bash
# 启动 MongoDB
mongod

# 连接字符串
MONGODB_URI=mongodb://localhost:27017/ai-chat-bot
```

## 性能优化

### 生产环境配置
```javascript
// next.config.js
const nextConfig = {
  compress: true,
  swcMinify: true,
  images: {
    formats: ['image/webp', 'image/avif'],
  },
  experimental: {
    optimizeCss: true,
  }
}
```

### 环境变量优化
```env
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
```

## 监控和日志

### 添加健康检查端点
```javascript
// pages/api/health.js
export default function handler(req, res) {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
}
```

### 错误监控
考虑集成：
- Sentry（错误追踪）
- LogRocket（用户会话记录）
- Vercel Analytics（性能监控）

## 安全配置

### 环境变量安全
- 永远不要在代码中硬编码 API 密钥
- 建议在生产环境设置强随机字符串作为 `NEXTAUTH_SECRET`
- 定期轮换 API 密钥

### CORS 配置
```javascript
// next.config.js
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://yourdomain.com' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE' },
        ],
      },
    ];
  },
}
```

## 常见问题

### Q: 部署后页面空白
A: 检查浏览器控制台错误，通常是环境变量配置问题

### Q: API 调用失败
A: 验证 `AIHUBMIX_API_KEY` 是否正确设置

### Q: 数据库连接失败
A: 检查 `MONGODB_URI` 格式和网络访问权限

### Q: 构建时间过长
A: 使用 `.dockerignore` 排除不必要的文件

## 支持

如果遇到部署问题：
1. 检查构建日志
2. 验证环境变量
3. 查看应用日志
4. 参考平台文档
