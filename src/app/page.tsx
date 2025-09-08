'use client';

import { useEffect, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AlertCircle, WifiOff, Plus, MessageSquare, User } from 'lucide-react';

export default function HomePage() {
  const { error, setError } = useChatStore();
  const [isOnline, setIsOnline] = useState(true);

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
          
          {/* 移动端底部导航栏 */}
          <div className="sm:hidden border-t border-border bg-background pb-safe-area-inset-bottom">
            <div className="flex items-center justify-around py-2 px-2">
              {/* 新建对话 */}
              <button
                onClick={() => {
                  // 触发新建对话
                  const sidebar = document.querySelector<HTMLButtonElement>('.sidebar-new-chat');
                  sidebar?.click();
                }}
                className="flex flex-col items-center gap-1 p-2 text-muted-foreground hover:text-foreground touch-manipulation"
              >
                <Plus className="h-5 w-5" />
                <span className="text-[10px]">新建</span>
              </button>
              
              {/* 历史记录 */}
              <button
                onClick={() => {
                  const menuBtn = document.querySelector<HTMLButtonElement>('.fixed.top-2.left-2');
                  menuBtn?.click();
                }}
                className="flex flex-col items-center gap-1 p-2 text-muted-foreground hover:text-foreground touch-manipulation"
              >
                <MessageSquare className="h-5 w-5" />
                <span className="text-[10px]">历史</span>
              </button>
              
              {/* 用户中心 */}
              <button
                onClick={() => {
                  const { setUserPanelOpen } = useChatStore.getState();
                  setUserPanelOpen(true);
                }}
                className="flex flex-col items-center gap-1 p-2 text-muted-foreground hover:text-foreground touch-manipulation"
              >
                <User className="h-5 w-5" />
                <span className="text-[10px]">我的</span>
              </button>
            </div>
          </div>
        </div>

        {/* 全局提示 */}
        <ErrorAlert />
        <NetworkStatus />
      </div>
    </ErrorBoundary>
  );
}
