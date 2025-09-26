'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useChatStore } from '@/store/chatStore';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AlertCircle, WifiOff, Plus, MessageSquare, User } from 'lucide-react';

const LazyForceChangePassword = dynamic(() => import('@/components/ForceChangePasswordModal'), { ssr: false });

export default function HomePage() {
  const { error, setError } = useChatStore();
  const [isOnline, setIsOnline] = useState(true);
  const [forceResetOpen, setForceResetOpen] = useState(false);

  // 监听网络状态
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 登录后强制修改密码检测
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/auth/me', { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data?.user?.needsPasswordReset) {
          setForceResetOpen(true);
        }
      } catch {}
    })();
  }, []);

  // 错误提示组件
  const ErrorAlert = () => {
    if (!error) return null;

    return (
      <div className="fixed top-4 right-4 z-50 max-w-md rounded-lg border border-destructive bg-destructive/10 p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
          <div className="flex-1">
            <h4 className="font-medium text-destructive">出错了</h4>
            <pre className="text-sm text-destructive/80 mt-1 whitespace-pre-wrap break-words">{error}</pre>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-destructive hover:text-destructive/80"
          >
            ×
          </button>
        </div>
      </div>
    );
  };

  // 网络状态提示
  const NetworkStatus = () => {
    if (isOnline) return null;

    return (
      <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
        <WifiOff className="h-4 w-4" />
        网络连接已断开
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="flex h-full">
        {/* 侧边栏 */}
        <Sidebar />

        {/* 主内容区域 */}
        <div className="flex-1 flex flex-col min-w-0">
          <ChatInterface />
        </div>

        {/* 全局提示 */}
        <ErrorAlert />
        <NetworkStatus />
        {forceResetOpen && (
          // 强制修改密码弹窗
          <LazyForceChangePassword onClose={() => setForceResetOpen(false)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
