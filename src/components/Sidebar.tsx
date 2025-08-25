'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  MessageSquare,
  Search,
  Settings,
  Trash2,
  Edit3,
  Menu,
  X,
  MoreHorizontal,
  LogOut,
  Compass,
  Code2,
  Film,
  Bot
} from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { Conversation } from '@/lib/types';
import { formatRelativeTime, truncateText, cn } from '@/utils/helpers';
// 客户端组件中不直接使用 Server Actions，统一走内部 API 路由

export default function Sidebar() {
  const {
    conversations,
    setConversations,
    currentConversation,
    setCurrentConversation,
    sidebarOpen,
    setSidebarOpen,
    setSettingsOpen,
    currentModel,
  } = useChatStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<{ username: string; email: string } | null>(null);

  // 加载对话列表
  useEffect(() => {
    loadConversations();
    // 加载当前用户
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setUser({ username: data.user?.username, email: data.user?.email });
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      }
    })();
  }, []);

  const loadConversations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/conversations', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (error) {
      // 忽略错误
    } finally {
      setLoading(false);
    }
  };

  // 搜索对话
  const searchConversations = async (query: string) => {
    if (!query.trim()) {
      loadConversations();
      return;
    }
    try {
      const res = await fetch(`/api/conversations?search=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (error) {
      // 忽略错误
    }
  };

  // 创建新对话
  const createNewConversation = async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: '新对话', model: currentModel, settings: {} }),
      });
      if (res.ok) {
        const newConversation = await res.json();
        setConversations([newConversation, ...conversations]);
        setCurrentConversation(newConversation);
      }
    } catch (error) {
      // 忽略错误
    }
  };

  // 删除对话
  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('确定要删除这个对话吗？')) {
      return;
    }

    try {
      const res = await fetch(`/api/conversations?id=${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setConversations(conversations.filter(conv => conv.id !== id));
        if (currentConversation?.id === id) {
          setCurrentConversation(null);
        }
      }
    } catch (error) {
      // 忽略错误
    }
  };

  // 编辑对话标题
  const startEditing = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conversation.id);
    setEditTitle(conversation.title);
  };

  const saveTitle = async () => {
    if (!editingId || !editTitle.trim()) {
      setEditingId(null);
      return;
    }

    try {
      const res = await fetch('/api/conversations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: editingId, title: editTitle.trim() }),
      });
      if (res.ok) {
        setConversations(conversations.map(conv => 
          conv.id === editingId 
            ? { ...conv, title: editTitle.trim() }
            : conv
        ));
        if (currentConversation?.id === editingId) {
          setCurrentConversation({
            ...currentConversation,
            title: editTitle.trim(),
          });
        }
      }
    } catch (error) {
      // 忽略错误
    } finally {
      setEditingId(null);
      setEditTitle('');
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle('');
  };

  // 处理搜索
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    searchConversations(query);
  };

  // 按日期分组对话
  const groupedConversations = conversations.reduce((groups, conversation) => {
    const date = formatRelativeTime(new Date(conversation.updatedAt));
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(conversation);
    return groups;
  }, {} as Record<string, Conversation[]>);

  const sidebarContent = (
    <div className="flex h-full flex-col bg-muted/30">
      {/* 顶部：仅保留新建按钮，向 ChatGPT 靠拢 */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={createNewConversation}
            className="flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            新建对话
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground lg:hidden"
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="border-b border-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索对话..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </div>

      {/* 导航分组 + 对话列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* 顶部应用导航（不可点占位）*/}
        <div className="p-2">
          <div className="space-y-1">
            <div className="px-3 py-1 text-[11px] text-muted-foreground">探索调试</div>
            <button className="sidebar-item disabled:opacity-60" disabled>
              <Compass className="h-4 w-4" />
              <span>广场</span>
            </button>
            <button className="sidebar-item disabled:opacity-60" disabled>
              <Code2 className="h-4 w-4" />
              <span>Codex</span>
            </button>
            <button className="sidebar-item disabled:opacity-60" disabled>
              <Film className="h-4 w-4" />
              <span>Sora</span>
            </button>
            <button className="sidebar-item disabled:opacity-60" disabled>
              <Bot className="h-4 w-4" />
              <span>GPT</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-sm text-muted-foreground">加载中...</div>
          </div>
        ) : Object.keys(groupedConversations).length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {searchQuery ? '没有找到匹配的对话' : '还没有对话记录'}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-2">
            {Object.entries(groupedConversations).map(([date, convs]) => (
              <div key={date} className="mb-4">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {date}
                </div>
                <div className="space-y-1">
                  {convs.map((conversation) => (
                    <div
                      key={conversation.id}
                      onClick={() => {
                        setCurrentConversation(conversation);
                        if (window.innerWidth < 1024) {
                          setSidebarOpen(false);
                        }
                      }}
                      className={cn(
                        "group relative cursor-pointer rounded-lg p-2 transition-colors hover:bg-accent",
                        currentConversation?.id === conversation.id && "bg-accent"
                      )}
                    >
                      {editingId === conversation.id ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={saveTitle}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveTitle();
                            if (e.key === 'Escape') cancelEditing();
                          }}
                          className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                          autoFocus
                        />
                      ) : (
                        <>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-medium truncate">
                                {conversation.title}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                {conversation.messages.length} 条消息
                              </p>
                            </div>
                            
                            {/* 操作按钮 */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => startEditing(conversation, e)}
                                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                title="编辑标题"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => deleteConversation(conversation.id, e)}
                                className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                                title="删除对话"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部账户卡片 + 设置 */}
      <div className="border-t border-border p-4 space-y-3">
        {/* 账户卡片 */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-muted" />
            <div className="text-sm">
              <div className="font-medium">{user ? user.username : '未登录'}</div>
              <div className="text-xs text-muted-foreground">{user ? user.email : 'Plus'}</div>
            </div>
          </div>
          <button
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground disabled:opacity-60"
            disabled={!user}
            onClick={() => {
              if (user) {
                window.location.href = '/settings';
              }
            }}
          >管理</button>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="sidebar-item w-full"
        >
          <Settings className="h-4 w-4" />
          设置
        </button>
        <button
          onClick={async () => {
            try {
              const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
              const data = await res.json().catch(() => ({} as any));
              window.location.href = (data && data.redirect) || '/login';
            } catch (e) {
              window.location.href = '/login';
            }
          }}
          className="sidebar-item w-full text-red-600 hover:text-red-700"
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* 移动端菜单按钮 */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-40 rounded-md bg-background p-2 shadow-md border border-border lg:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* 桌面端侧边栏 */}
      <div className={cn(
        "hidden lg:flex lg:w-80 lg:flex-col lg:border-r lg:border-border",
        !sidebarOpen && "lg:hidden"
      )}>
        {sidebarContent}
      </div>

      {/* 移动端侧边栏 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="fixed left-0 top-0 h-full w-80 max-w-[80vw]">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
