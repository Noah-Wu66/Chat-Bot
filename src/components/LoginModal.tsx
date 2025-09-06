"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useChatStore } from "@/store/chatStore";
import { loginAction, registerAction } from "@/app/actions/auth";

export default function LoginModal() {
  const { loginOpen, setLoginOpen } = useChatStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 模式：login / register
  const [mode, setMode] = useState<"login" | "register">("login");

  // 登录字段
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  // 注册字段
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!loginOpen) {
      setError(null);
      setIdentifier("");
      setPassword("");
      setUsername("");
      setEmail("");
      setConfirmPassword("");
      setMode("login");
    }
  }, [loginOpen]);

  if (!loginOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "login") {
        const res = await loginAction({ identifier, password, remember });
        if (!res?.ok) throw new Error((res as any)?.error || "登录失败");
        setLoginOpen(false);
        window.location.href = (res as any)?.redirect || "/";
      } else {
        if (password !== confirmPassword) {
          throw new Error("两次输入的密码不一致");
        }
        const res = await registerAction({ username, email, password, confirmPassword });
        if (!res?.ok) throw new Error((res as any)?.error || "注册失败");
        // 注册成功后跳转到登录页
        setMode("login");
        setIdentifier(email || username);
        setPassword("");
        setConfirmPassword("");
        window.location.href = (res as any)?.redirect || "/login";
      }
    } catch (e: any) {
      setError(e?.message || (mode === "login" ? "登录失败" : "注册失败"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-lg max-h-[90vh] overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-3 sm:p-4">
            <h2 className="text-base sm:text-lg font-semibold">登录 / 注册</h2>
            <button
              onClick={() => setLoginOpen(false)}
              className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground touch-manipulation"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-3 sm:px-4 pt-3 sm:pt-4">
            <div className="grid grid-cols-2 gap-2 mb-2" role="tablist">
              <button
                type="button"
                className={`rounded-md border px-3 py-2 text-sm touch-manipulation ${mode === "login" ? "bg-accent" : ""}`}
                onClick={() => setMode("login")}
                aria-selected={mode === "login"}
                role="tab"
              >登录</button>
              <button
                type="button"
                className={`rounded-md border px-3 py-2 text-sm touch-manipulation ${mode === "register" ? "bg-accent" : ""}`}
                onClick={() => setMode("register")}
                aria-selected={mode === "register"}
                role="tab"
              >注册</button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            <form onSubmit={handleSubmit} className="p-3 sm:p-4 space-y-3">
            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}

            {mode === "login" ? (
              <>
                <div>
                  <label className="block text-sm mb-1">用户名或邮箱</label>
                  <input
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">密码</label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  30 天内免登录
                </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 touch-manipulation"
            >
              {loading ? "登录中..." : "登录"}
            </button>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm mb-1">用户名</label>
                  <input
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    minLength={3}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">邮箱</label>
                  <input
                    type="email"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">密码</label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">确认密码</label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 touch-manipulation"
                >
                  {loading ? "注册中..." : "注册"}
                </button>
              </>
            )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

