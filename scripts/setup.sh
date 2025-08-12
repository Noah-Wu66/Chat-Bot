#!/bin/bash

# AI Chat Bot 项目设置脚本

echo "🚀 开始设置 AI Chat Bot 项目..."

# 检查 Node.js 版本
echo "📋 检查 Node.js 版本..."
node_version=$(node -v 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Node.js 版本: $node_version"
    # 检查版本是否 >= 18
    major_version=$(echo $node_version | cut -d'.' -f1 | sed 's/v//')
    if [ "$major_version" -lt 18 ]; then
        echo "❌ 需要 Node.js 18 或更高版本"
        exit 1
    fi
else
    echo "❌ 未找到 Node.js，请先安装 Node.js 18+"
    exit 1
fi

# 检查 npm
echo "📋 检查 npm..."
npm_version=$(npm -v 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ npm 版本: $npm_version"
else
    echo "❌ 未找到 npm"
    exit 1
fi

# 安装依赖
echo "📦 安装项目依赖..."
npm install
if [ $? -eq 0 ]; then
    echo "✅ 依赖安装成功"
else
    echo "❌ 依赖安装失败"
    exit 1
fi

# 检查环境变量文件
echo "🔧 检查环境配置..."
if [ ! -f ".env.local" ]; then
    if [ -f ".env.local.example" ]; then
        echo "📝 创建环境变量文件..."
        cp .env.local.example .env.local
        echo "⚠️  请编辑 .env.local 文件并填入正确的配置信息"
    else
        echo "❌ 未找到环境变量示例文件"
        exit 1
    fi
else
    echo "✅ 环境变量文件已存在"
fi

# 检查 MongoDB 连接（可选）
echo "🗄️  检查数据库配置..."
if command -v mongosh &> /dev/null; then
    echo "✅ 找到 MongoDB Shell"
elif command -v mongo &> /dev/null; then
    echo "✅ 找到 MongoDB 客户端"
else
    echo "⚠️  未找到 MongoDB 客户端，请确保 MongoDB 已安装并运行"
fi

# 构建项目（可选）
echo "🔨 构建项目..."
npm run build
if [ $? -eq 0 ]; then
    echo "✅ 项目构建成功"
else
    echo "❌ 项目构建失败，请检查代码"
    exit 1
fi

echo ""
echo "🎉 项目设置完成！"
echo ""
echo "📝 下一步："
echo "1. 编辑 .env.local 文件，填入正确的 API 密钥和数据库连接"
echo "2. 确保 MongoDB 数据库正在运行"
echo "3. 运行 'npm run dev' 启动开发服务器"
echo ""
echo "🔗 有用的命令："
echo "  npm run dev     - 启动开发服务器"
echo "  npm run build   - 构建生产版本"
echo "  npm run start   - 启动生产服务器"
echo "  npm run lint    - 代码检查"
echo ""
echo "📚 更多信息请查看 README.md 文件"
