import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Chat Bot - 智能对话助手',
  description: '基于 Aihubmix OpenAI API 的智能对话应用，支持 GPT-4o 和 GPT-5 模型',
  keywords: ['AI', 'ChatBot', '人工智能', '对话', 'GPT-4o', 'GPT-5'],
  authors: [{ name: 'AI Chat Bot' }],
  viewport: 'width=device-width, initial-scale=1',
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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className={inter.className}>
        <div className="h-screen overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}
