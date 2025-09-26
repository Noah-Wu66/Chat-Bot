"use client";

import { useState } from 'react';
import { X } from 'lucide-react';

export default function ForceChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (newPassword !== confirm) throw new Error('两次输入的密码不一致');
      const resp = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPassword }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) throw new Error(data?.error || '修改密码失败');
      setOk(true);
    } catch (e: any) {
      setError(e?.message || '修改密码失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/40" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-lg overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-3 sm:p-4">
            <h2 className="text-base sm:text-lg font-semibold">首次登录，请设置新密码</h2>
            <button
              onClick={() => { if (ok) onClose(); }}
              className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground touch-manipulation"
              aria-label="关闭"
              disabled={!ok}
              title={!ok ? '设置完成后可关闭' : '关闭'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3 sm:p-4">
            {error && <div className="mb-2 text-sm text-destructive">{error}</div>}
            {ok ? (
              <div className="text-sm">密码已更新。您现在可以正常使用系统。</div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">新密码</label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">确认新密码</label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div className="text-xs text-muted-foreground">密码至少8位，且包含大小写字母和数字。</div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 touch-manipulation"
                  >{loading ? '提交中...' : '设置新密码'}</button>
                </div>
              </form>
            )}
          </div>
          {ok && (
            <div className="flex items-center justify-end gap-2 border-t p-3 sm:p-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 touch-manipulation"
              >完成</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

