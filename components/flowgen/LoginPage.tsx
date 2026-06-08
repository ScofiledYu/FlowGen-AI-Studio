import React, { useState } from 'react';
import { login } from '../../services/flowgenApi';
import { Zap, Lock, User, Eye, EyeOff, Sparkles } from 'lucide-react';

export function LoginPage({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0a0a] relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Gradient Orbs */}
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-brand-500/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[150px]" />
        
        {/* Grid Pattern */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo Section */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-6 rounded-2xl 
            bg-gradient-to-br from-brand-500 via-brand-600 to-purple-600 
            shadow-2xl shadow-brand-500/25">
            <Zap className="w-10 h-10 text-white fill-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
            FlowGen AI
          </h1>
          <p className="text-gray-500 text-sm flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-400" />
            智能创作平台
          </p>
        </div>

        {/* Login Form */}
        <form
          onSubmit={submit}
          className="w-full rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl 
            p-8 shadow-2xl shadow-black/50"
        >
          {/* Error Message */}
          {err && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {err}
            </div>
          )}

          {/* Username Field */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
              用户名
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                <User className="w-5 h-5" />
              </div>
              <input
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && submit(e)}
                autoComplete="username"
                autoFocus
                className="w-full pl-12 pr-4 py-4 rounded-xl bg-white/5 border border-white/10 
                  text-white placeholder:text-gray-600
                  focus:outline-none focus:border-brand-500/50 focus:bg-white/[0.07]
                  transition-all"
              />
            </div>
          </div>

          {/* Password Field */}
          <div className="mb-8">
            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
              密码
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                <Lock className="w-5 h-5" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && submit(e)}
                autoComplete="current-password"
                className="w-full pl-12 pr-12 py-4 rounded-xl bg-white/5 border border-white/10 
                  text-white placeholder:text-gray-600
                  focus:outline-none focus:border-brand-500/50 focus:bg-white/[0.07]
                  transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 
              hover:from-brand-500 hover:to-brand-400
              text-white font-semibold text-base
              shadow-lg shadow-brand-500/25 hover:shadow-xl hover:shadow-brand-500/30
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none
              transition-all duration-200"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                登录中…
              </span>
            ) : (
              '登 录'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-gray-600 text-xs mt-8">
          多用户模式 · 请联系管理员分配账号
        </p>
      </div>
    </div>
  );
}
