import Link from 'next/link';
import { registerFormAction } from '@/app/actions/auth';

export default function RegisterPage() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border p-6 bg-background">
        <h1 className="text-xl font-semibold mb-4">注册</h1>
        <form action={registerFormAction} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">用户名</label>
            <input
              name="username"
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              minLength={3}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">邮箱</label>
            <input
              name="email"
              type="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">密码</label>
            <input
              name="password"
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
              name="confirmPassword"
              type="password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              minLength={8}
            />
          </div>
          <div className="flex items-center justify-between">
            <Link href="/login" className="text-sm text-blue-600 hover:underline">已有账号？去登录</Link>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            注册
          </button>
        </form>
      </div>
    </div>
  );
}

