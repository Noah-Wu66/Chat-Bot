import Link from 'next/link';
import { loginFormAction } from '@/app/actions/auth';

export default function LoginPage() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border p-6 bg-background">
        <h1 className="text-xl font-semibold mb-4">登录</h1>
        <form action={loginFormAction} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">用户名或邮箱</label>
            <input
              name="identifier"
              type="text"
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
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input name="remember" type="checkbox" />
              记住我（30天）
            </label>
            <Link href="/register" className="text-sm text-blue-600 hover:underline">没有账号？去注册</Link>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            登录
          </button>
        </form>
      </div>
    </div>
  );
}

