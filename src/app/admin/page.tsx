'use client';

import { useEffect, useMemo, useState } from 'react';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  isSuperAdmin?: boolean;
  isBanned?: boolean;
  createdAt?: string;
}

interface UserModelStat { model: string; count: number }
interface StatsItem { userId: string; models: UserModelStat[] }

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<StatsItem[]>([]);
  const [operating, setOperating] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [uRes, sRes] = await Promise.all([
          fetch('/api/admin/users', { credentials: 'include' }),
          fetch('/api/admin/stats', { credentials: 'include' }),
        ]);
        if (!uRes.ok) {
          const err = await uRes.json().catch(() => ({}));
          throw new Error(err?.error || '无法获取用户列表');
        }
        if (!sRes.ok) {
          const err = await sRes.json().catch(() => ({}));
          throw new Error(err?.error || '无法获取统计数据');
        }
        const uData = await uRes.json();
        const sData = await sRes.json();
        setUsers(Array.isArray(uData?.users) ? uData.users : []);
        setStats(Array.isArray(sData?.stats) ? sData.stats : []);
      } catch (e: any) {
        setError(e?.message || '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const userIdToStats = useMemo(() => {
    const map = new Map<string, UserModelStat[]>();
    for (const item of stats) map.set(item.userId, item.models || []);
    return map;
  }, [stats]);

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">加载中...</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">系统管理</h1>
      <div className="rounded-lg border">
        <div className="p-3 border-b text-sm font-medium">注册用户</div>
        <div className="divide-y">
          {users.map((u) => {
            const models = userIdToStats.get(u.id) || [];
            return (
              <div key={u.id} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {u.username}
                    {u.isSuperAdmin ? <span className="ml-2 text-xs text-emerald-600">(超级管理员)</span> : null}
                    {u.isBanned ? <span className="ml-2 text-xs text-red-600">(已封禁)</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    模型使用：{models.length === 0 ? '—' : models.map(m => `${m.model}×${m.count}`).join('，')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!u.isSuperAdmin && (
                    u.isBanned ? (
                      <button
                        disabled={operating === u.id}
                        onClick={async () => {
                          try {
                            setOperating(u.id);
                            const resp = await fetch('/api/admin/users', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ userId: u.id, action: 'unban' }),
                            });
                            if (!resp.ok) throw new Error('解封失败');
                            setUsers(list => list.map(it => it.id === u.id ? { ...it, isBanned: false } : it));
                          } catch (e) {
                            // ignore error toast for brevity
                          } finally {
                            setOperating(null);
                          }
                        }}
                        className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent touch-manipulation"
                      >解封</button>
                    ) : (
                      <button
                        disabled={operating === u.id}
                        onClick={async () => {
                          try {
                            setOperating(u.id);
                            const resp = await fetch('/api/admin/users', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ userId: u.id, action: 'ban' }),
                            });
                            if (!resp.ok) throw new Error('封禁失败');
                            setUsers(list => list.map(it => it.id === u.id ? { ...it, isBanned: true } : it));
                          } catch (e) {
                            // ignore
                          } finally {
                            setOperating(null);
                          }
                        }}
                        className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent touch-manipulation"
                      >封禁</button>
                    )
                  )}
                  {!u.isSuperAdmin && (
                    <button
                      disabled={operating === u.id}
                      onClick={async () => {
                        if (!confirm('确认删除该用户及其所有对话？此操作不可恢复。')) return;
                        try {
                          setOperating(u.id);
                          const resp = await fetch(`/api/admin/users?userId=${encodeURIComponent(u.id)}`, {
                            method: 'DELETE',
                            credentials: 'include',
                          });
                          if (!resp.ok) throw new Error('删除失败');
                          setUsers(list => list.filter(it => it.id !== u.id));
                        } catch (e) {
                          // ignore
                        } finally {
                          setOperating(null);
                        }
                      }}
                      className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 touch-manipulation"
                    >删除</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


