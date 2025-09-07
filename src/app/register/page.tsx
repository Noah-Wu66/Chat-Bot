'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      if (password !== confirmPassword) {
        throw new Error("两次输入的密码不一致");
      }
      
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, confirmPassword }),
        credentials: 'include',
      });
      const res = await response.json();
      if (!response.ok || !res?.ok) {
        throw new Error(res?.error || "注册失败");
      }
      router.push(res?.redirect || '/login');
    } catch (e: any) {
      setError(e?.message || "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border p-6 bg-background">
        <h1 className="text-xl font-semibold mb-4">注册</h1>
        
        {error && (
          <div className="mb-4 text-sm text-destructive">{error}</div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              minLength={3}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">邮箱</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">密码</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              minLength={8}
            />
            <p className="text-xs text-muted-foreground mt-1">至少8位，包含大小写字母与数字</p>
          </div>
          <div>
            <label className="block text-sm mb-1">确认密码</label>
            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type="password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              minLength={8}
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-sm text-blue-600 hover:underline"
            >已有账号？去登录</button>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? '注册中...' : '注册'}
          </button>
        </form>
      </div>
    </div>
  );
}

