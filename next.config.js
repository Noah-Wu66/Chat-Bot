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
    // 单服务：仅处理 favicon 重写
    return [
      {
        source: '/favicon.ico',
        destination: '/icon.svg',
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
