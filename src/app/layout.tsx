import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Chat Bot - 智能对话助手',
  description: '现代化 AI 对话应用，支持 GPT-5',
  keywords: ['AI', 'ChatBot', '人工智能', '对话', 'GPT-5'],
  authors: [{ name: 'AI Chat Bot' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext x='50%25' y='60%25' dominant-baseline='middle' text-anchor='middle' font-size='80'%3E🤖%3C/text%3E%3C/svg%3E" />
      </head>
      <body className={`${inter.className} antialiased`}>
        <div className="min-h-[100dvh] h-[100dvh] sm:h-[100vh] overflow-hidden touch-manipulation">
          {children}
        </div>
      </body>
    </html>
  );
}
