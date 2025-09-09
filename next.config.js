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
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
  async rewrites() {
    return [
      // 兼容部分平台对路径中点号的处理差异
      { source: '/api/gemini-2.5-pro', destination: '/api/gemini-2_5-pro' },
    ];
  },
  // Zeabur 部署配置
  // 环境变量
  env: {
    // 单容器部署默认不设置 NEXT_PUBLIC_BACKEND_URL，走 Next 重写
  },
  // 优化配置
  swcMinify: true,
  compress: true,
}

module.exports = nextConfig
