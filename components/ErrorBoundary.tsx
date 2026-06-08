import React, { Component, ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode; fallback?: ReactNode };

type State = { hasError: boolean; message: string };

/**
 * 防止单个子树抛错导致整页白屏；极端情况下给用户恢复手段。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message || String(err) };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* 控制台已静默；错误信息已通过 getDerivedStateFromError 展示在 fallback UI */
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.message || '';
      const isChunkLoad =
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Loading chunk \d+ failed/i.test(msg) ||
        /Importing a module script failed/i.test(msg);
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center min-h-[200px] gap-4 p-8 bg-gray-900 text-gray-200 border border-red-900/50 rounded-xl m-4">
            <p className="text-sm font-medium text-red-300">界面渲染出错（已拦截，避免整页崩溃）</p>
            <p className="text-xs text-gray-500 max-w-lg break-all text-center">{msg}</p>
            {isChunkLoad && (
              <p className="text-xs text-amber-400/90 max-w-md text-center leading-relaxed">
                多为前端版本不一致：请先在同一地址按 <strong>Ctrl+F5</strong> 强刷；若仍报错，在服务器重新执行 npm run
                build 后重启服务。
              </p>
            )}
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm"
                onClick={() => this.setState({ hasError: false, message: '' })}
              >
                重试渲染
              </button>
              {isChunkLoad && (
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border border-white/20 hover:bg-white/10 text-sm"
                  onClick={() => window.location.reload()}
                >
                  刷新页面
                </button>
              )}
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
