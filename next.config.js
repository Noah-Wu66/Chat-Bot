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
