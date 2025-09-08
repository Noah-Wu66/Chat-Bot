"use client";

import { useEffect, useState } from "react";
import { X, User as UserIcon, Mail, KeyRound, LogOut, ShieldCheck, Settings } from "lucide-react";
import { useChatStore } from "@/store/chatStore";

export default function UserPanel() {
  const { userPanelOpen, setUserPanelOpen } = useChatStore();
  const [user, setUser] = useState<{ username: string; email: string; isSuperAdmin?: boolean } | null>(null);
  const [superExists, setSuperExists] = useState<boolean | null>(null);
  const [registering, setRegistering] = useState(false);
  const [superKey, setSuperKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userPanelOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error("未登录或获取用户失败");
        }
        const data = await response.json();
        if (!data.user) throw new Error("未登录或获取用户失败");
        if (!cancelled) setUser({ username: data.user.username, email: data.user.email, isSuperAdmin: Boolean(data.user.isSuperAdmin) });
        // 查询是否已有超级管理员
        try {
          const r = await fetch('/api/admin/exists', { credentials: 'include' });
          if (r.ok) {
            const j = await r.json();
            if (!cancelled) setSuperExists(Boolean(j.exists));
          } else {
            if (!cancelled) setSuperExists(true);
          }
        } catch {
          if (!cancelled) setSuperExists(true);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "获取用户失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userPanelOpen]);

  if (!userPanelOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-background shadow-lg">
        <div className="flex max-h-[90vh] sm:max-h-[85vh] flex-col">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-border p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <UserIcon className="h-5 w-5" />
              <h2 className="text-base sm:text-lg font-semibold">用户管理</h2>
            </div>
            <button
              onClick={() => setUserPanelOpen(false)}
              className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground touch-manipulation"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 内容 */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">加载中...</div>
            ) : error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : (
              <>
                <div className="settings-panel">
                  <h3 className="font-medium mb-3 text-sm sm:text-base">账户信息</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <UserIcon className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{user?.username || "-"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{user?.email || "-"}</span>
                    </div>
                  </div>
                </div>

                <div className="settings-panel">
                  <h3 className="font-medium mb-3 text-sm sm:text-base">安全</h3>
                  <div className="space-y-2">
                    {/* 注册超级管理员（系统尚无超级管理员且当前用户不是超管时可见） */}
                    {superExists === false && !user?.isSuperAdmin && (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">输入密钥后成为系统唯一的超级管理员。</div>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={superKey}
                            onChange={(e) => setSuperKey(e.target.value)}
                            placeholder="输入超级管理员密钥"
                            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                          <button
                            disabled={!superKey || registering}
                            onClick={async () => {
                              try {
                                setRegistering(true);
                                const resp = await fetch('/api/admin/register-super', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  credentials: 'include',
                                  body: JSON.stringify({ key: superKey }),
                                });
                                if (!resp.ok) {
                                  const err = await resp.json().catch(() => ({}));
                                  throw new Error(err?.error || '注册失败');
                                }
                                setSuperExists(true);
                                setUser(u => (u ? { ...u, isSuperAdmin: true } : u));
                                setSuperKey('');
                              } catch (e: any) {
                                setError(e?.message || '注册失败');
                              } finally {
                                setRegistering(false);
                              }
                            }}
                            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 touch-manipulation whitespace-nowrap"
                          >
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4" />
                              {registering ? '注册中…' : '注册为超级管理员'}
                            </div>
                          </button>
                        </div>
                      </div>
                    )}
                    <button
                      disabled
                      className="w-full rounded-md border px-3 py-2 text-sm text-muted-foreground disabled:opacity-60 touch-manipulation"
                      title="暂未开放"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <KeyRound className="h-4 w-4" />
                        修改密码（暂不可用）
                      </div>
                    </button>
                  </div>
                </div>

                <div className="settings-panel">
                  <h3 className="font-medium mb-3 text-sm sm:text-base">会话</h3>
                  <p className="text-xs text-muted-foreground">您可以在左侧对话列表中管理会话记录。</p>
                </div>

                {/* 超级管理员专属：系统管理入口 */}
                {user?.isSuperAdmin && (
                  <div className="settings-panel">
                    <h3 className="font-medium mb-3 text-sm sm:text-base">系统</h3>
                    <button
                      onClick={() => { window.location.href = '/admin'; }}
                      className="w-full rounded-md border px-3 py-2 text-sm hover:bg-accent touch-manipulation"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Settings className="h-4 w-4" />
                        系统管理
                      </div>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 底部操作 */}
          <div className="border-t border-border p-3 sm:p-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const response = await fetch('/api/auth/logout', {
                    method: 'POST',
                    credentials: 'include',
                  });
                  const data = await response.json();
                  window.location.href = data?.redirect || "/login";
                } catch (e) {
                  window.location.href = "/login";
                }
              }}
            >
              <button
                type="submit"
                className="w-full sidebar-item justify-center text-red-600 hover:text-red-700 touch-manipulation"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

