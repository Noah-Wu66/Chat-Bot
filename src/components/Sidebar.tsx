'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  MessageSquare,
  Search,
  Trash2,
  Edit3,
  Menu,
  X,
  LogOut
} from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { Conversation } from '@/lib/types';
import { formatRelativeTime, truncateText, cn } from '@/utils/helpers';

export default function Sidebar() {
  const {
    conversations,
    setConversations,
    currentConversation,
    setCurrentConversation,
    sidebarOpen,
    setSidebarOpen,
  } = useChatStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<{ username: string; email: string; isSuperAdmin?: boolean } | null>(null);
  const [superExists, setSuperExists] = useState<boolean | null>(null);
  // 删除确认弹窗状态
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingDeleteTitle, setConfirmingDeleteTitle] = useState<string>('');
  const [deleting, setDeleting] = useState(false);


  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/conversations', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : [];
        // 仅保留包含消息的会话（无消息的不展示）
        setConversations(list.filter((c: any) => Array.isArray(c?.messages) && c.messages.length > 0));
      } else {
        setConversations([]);
      }
    } catch (error) {
      // 忽略错误
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [setConversations, setLoading]);

  // 加载对话列表
  useEffect(() => {
    loadConversations();
    // 加载当前用户
    (async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            setUser({ username: data.user.username, email: data.user.email, isSuperAdmin: Boolean(data.user.isSuperAdmin) });
          } else {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      }
      // 查询是否已有超级管理员
      try {
        const r = await fetch('/api/admin/exists', { credentials: 'include' });
        if (r.ok) {
          const j = await r.json();
          setSuperExists(Boolean(j.exists));
        } else {
          setSuperExists(true);
        }
      } catch {
        setSuperExists(true);
      }
    })();
  }, [loadConversations]);

  // 搜索对话
  const searchConversations = async (query: string) => {
    if (!query.trim()) {
      loadConversations();
      return;
    }
    try {
      const response = await fetch(`/api/conversations?search=${encodeURIComponent(query)}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : [];
        setConversations(list.filter((c: any) => Array.isArray(c?.messages) && c.messages.length > 0));
      } else {
        setConversations([]);
      }
    } catch (error) {
      // 忽略错误
      setConversations([]);
    }
  };

  // 创建新对话
  const createNewConversation = () => {
    // 不创建后端空会话，仅进入空状态，待用户发送首条消息再创建
    setCurrentConversation(null);
    try {
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    } catch {}
  };

  // 打开删除确认弹窗
  const openDeleteConfirm = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingDeleteId(conversation.id);
    setConfirmingDeleteTitle(conversation.title || '未命名对话');
  };

  // 执行删除
  const confirmDelete = async () => {
    if (!confirmingDeleteId) return;
    try {
      setDeleting(true);
      const response = await fetch(`/api/conversations?id=${encodeURIComponent(confirmingDeleteId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        const res = await response.json();
        if (res?.ok) {
          setConversations(conversations.filter(conv => conv.id !== confirmingDeleteId));
          if (currentConversation?.id === confirmingDeleteId) {
            setCurrentConversation(null);
          }
        }
      }
    } catch (error) {
      // 忽略错误
    } finally {
      setDeleting(false);
      setConfirmingDeleteId(null);
      setConfirmingDeleteTitle('');
    }
  };

  // 关闭删除确认弹窗
  const cancelDelete = () => {
    if (deleting) return;
    setConfirmingDeleteId(null);
    setConfirmingDeleteTitle('');
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
      const response = await fetch('/api/conversations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, title: editTitle.trim() }),
        credentials: 'include',
      });
      if (response.ok) {
        const res = await response.json();
        if (res?.ok) {
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
    <div className="flex h-full flex-col bg-muted/30 pb-safe-area-inset-bottom">
      {/* 顶部：仅保留新建按钮，向 ChatGPT 靠拢 */}
      <div className="border-b border-border p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={createNewConversation}
            className="sidebar-new-chat flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 touch-manipulation"
          >
            <Plus className="h-4 w-4" />
            新建对话
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground lg:hidden touch-manipulation"
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="border-b border-border p-3 sm:p-4">
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


      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
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
              <div key={date} className="mb-3 sm:mb-4">
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
                        "group relative cursor-pointer rounded-lg p-2 transition-colors hover:bg-accent touch-manipulation",
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
                            <div className="flex-1 min-w-0 mr-2">
                              <h3 className="text-sm font-medium truncate">
                                {conversation.title}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                {conversation.messages.length} 条消息
                              </p>
                            </div>
                            
                            {/* 操作按钮 - 移动端总是显示 */}
                            <div className={cn(
                              "flex items-center gap-1 transition-opacity",
                              "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            )}>
                              <button
                                onClick={(e) => startEditing(conversation, e)}
                                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground touch-manipulation"
                                title="编辑标题"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => openDeleteConfirm(conversation, e)}
                                className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground touch-manipulation"
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


      {/* 底部账户卡片 */}
      <div className="border-t border-border p-3 sm:p-4 space-y-3">
        {/* 账户卡片 */}
        <div className="flex items-center justify-between rounded-lg border p-2 sm:p-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="h-6 w-6 rounded-full bg-muted flex-shrink-0" />
            <div className="text-sm min-w-0 flex-1">
              {user ? (
                <>
                  <div className="font-medium truncate">{user.username}</div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                </>
              ) : (
                <>
                  <button
                    className="font-medium text-primary hover:underline touch-manipulation"
                    onClick={() => useChatStore.getState().setLoginOpen(true)}
                  >登录/注册</button>
                </>
              )}
            </div>
          </div>
          <button
            className="rounded-full border px-2 sm:px-3 py-1 text-xs text-muted-foreground disabled:opacity-60 touch-manipulation flex-shrink-0"
            disabled={!user}
            onClick={() => {
              if (user) {
                // 打开用户管理侧边弹窗
                useChatStore.getState().setUserPanelOpen(true);
              }
            }}
          >管理</button>
        </div>

        {/* 超级管理员入口按钮：仅超管可见 */}
        {user?.isSuperAdmin && (
          <button
            onClick={() => { window.location.href = '/admin'; }}
            className="sidebar-item w-full touch-manipulation"
          >
            系统管理
          </button>
        )}
        
        <button
          onClick={async () => {
            try {
              const response = await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
              });
              const res = await response.json();
              window.location.href = res?.redirect || '/login';
            } catch (e) {
              window.location.href = '/login';
            }
          }}
          className="sidebar-item w-full text-red-600 hover:text-red-700 touch-manipulation"
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* 移动端菜单按钮 - 顶部靠左 */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="compact fixed top-2 left-2 z-40 rounded-md bg-background p-1.5 shadow-md border border-border lg:hidden touch-manipulation"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* 桌面端侧边栏（始终显示） */}
      <div className={cn(
        "hidden lg:flex lg:w-80 lg:flex-col lg:border-r lg:border-border"
      )}>
        {sidebarContent}
      </div>

      {/* 移动端侧边栏 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="fixed left-0 top-0 h-full w-80 max-w-[85vw] shadow-xl">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {confirmingDeleteId && (
        <div className="fixed inset-0 z-[60] bg-black/40">
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-lg overflow-hidden">
              <div className="flex items-center justify-between border-b border-border p-3 sm:p-4">
                <h2 className="text-base sm:text-lg font-semibold">删除对话</h2>
                <button
                  onClick={cancelDelete}
                  className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground touch-manipulation"
                  aria-label="关闭"
                  disabled={deleting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-3 sm:p-4 space-y-2">
                <p className="text-sm">确定要删除以下对话吗？此操作不可恢复。</p>
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {confirmingDeleteTitle}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t p-3 sm:p-4">
                <button
                  type="button"
                  onClick={cancelDelete}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent touch-manipulation disabled:opacity-60"
                  disabled={deleting}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 touch-manipulation disabled:opacity-60"
                  disabled={deleting}
                >
                  {deleting ? '正在删除...' : '删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
