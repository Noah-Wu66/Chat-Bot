"use client";

import { useEffect, useState } from "react";
import { X, User as UserIcon, Mail, KeyRound, LogOut } from "lucide-react";
import { useChatStore } from "@/store/chatStore";
import { getCurrentUser, logoutAction } from "@/app/actions/auth";

export default function UserPanel() {
  const { userPanelOpen, setUserPanelOpen } = useChatStore();
  const [user, setUser] = useState<{ username: string; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userPanelOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getCurrentUser();
        if (!data) throw new Error("未登录或获取用户失败");
        if (!cancelled) setUser({ username: (data as any).username, email: (data as any).email });
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
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-lg">
        <div className="flex max-h-[85vh] flex-col">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="flex items-center gap-2">
              <UserIcon className="h-5 w-5" />
              <h2 className="text-lg font-semibold">用户管理</h2>
            </div>
            <button
              onClick={() => setUserPanelOpen(false)}
              className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 内容 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">加载中...</div>
            ) : error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : (
              <>
                <div className="settings-panel">
                  <h3 className="font-medium mb-3">账户信息</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <UserIcon className="h-4 w-4" />
                      <span>{user?.username || "-"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <span>{user?.email || "-"}</span>
                    </div>
                  </div>
                </div>

                <div className="settings-panel">
                  <h3 className="font-medium mb-3">安全</h3>
                  <div className="space-y-2">
                    <button
                      disabled
                      className="w-full rounded-md border px-3 py-2 text-sm text-muted-foreground disabled:opacity-60"
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
                  <h3 className="font-medium mb-3">会话</h3>
                  <p className="text-xs text-muted-foreground">您可以在左侧对话列表中管理会话记录。</p>
                </div>
              </>
            )}
          </div>

          {/* 底部操作 */}
          <div className="border-t border-border p-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const data = await logoutAction();
                  window.location.href = ((data as any)?.redirect) || "/login";
                } catch (e) {
                  window.location.href = "/login";
                }
              }}
            >
              <button
                type="submit"
                className="w-full sidebar-item justify-center text-red-600 hover:text-red-700"
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

