/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['upload.wikimedia.org'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    // 将以 /api/ 开头的请求转发到同容器内的 FastAPI（端口 8000）
    // 单容器部署时无需跨域与凭证复杂配置
    return process.env.NEXT_PUBLIC_BACKEND_URL
      ? []
      : [
          {
            source: '/api/:path*',
            destination: 'http://127.0.0.1:8000/api/:path*',
          },
        ];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
  // Zeabur 部署配置
  // 环境变量
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
    // 单容器部署默认不设置 NEXT_PUBLIC_BACKEND_URL，走 Next 重写
  },
  // 优化配置
  swcMinify: true,
  compress: true,
}

module.exports = nextConfig
