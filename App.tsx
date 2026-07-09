import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FilePlus2, FolderOpen, Save, Zap, LogOut, Pause, RefreshCw } from 'lucide-react';
import TestChatPage from './components/TestChatPage';
import type { FlowEditorProjectActions } from './components/FlowEditor';
import { LoginPage } from './components/flowgen/LoginPage';
import { ProjectListPage } from './components/flowgen/ProjectListPage';
import { AdminUsersPage } from './components/flowgen/AdminUsersPage';
import { AdminProjectsPage } from './components/flowgen/AdminProjectsPage';
import {
  changePassword,
  clearSession,
  fetchMe,
  getStoredToken,
  getStoredUser,
  getWorkspace,
  isAdminRole,
  listProjects,
  setSession,
} from './services/flowgenApi';

/** 画布与 React Flow 体量大，懒加载以降低首屏解析/内存峰值，避免弱设备直接崩掉 */
const FlowEditorWrapper = lazy(() => import('./components/FlowEditor'));

function FlowEditorLoadFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-800 text-gray-300">
      <div
        className="h-8 w-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin"
        aria-hidden
      />
      <p className="text-sm">正在加载编辑器…</p>
    </div>
  );
}

function CanvasRefreshHeaderControls({
  actions,
}: {
  actions: FlowEditorProjectActions | null;
}) {
  if (!actions) return null;
  const paused = actions.canvasRefreshPaused;
  const advanced = actions.canvasPerfAdvanced;
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex items-center rounded-md border overflow-hidden ${
          paused ? 'border-amber-500/40 bg-amber-950/50' : 'border-gray-700 bg-gray-800'
        }`}
      >
        <button
          type="button"
          onClick={actions.toggleCanvasRefresh}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
            paused ? 'text-amber-100 hover:bg-amber-500/20' : 'text-gray-200 hover:bg-gray-700/60'
          }`}
          title={
            paused
              ? '恢复预览刷新；主要减轻视频解码与缩略图负载'
              : '暂停视频解码与缩略图刷新；对拖动画布本身帮助有限，重度布局可开「高级」'
          }
        >
          {paused ? <RefreshCw size={14} className="text-amber-300" /> : <Pause size={14} />}
          {paused ? '恢复刷新' : '暂停刷新'}
        </button>
        {paused && (
          <>
            <div className="w-px h-5 bg-amber-500/30" />
            <button
              type="button"
              onClick={actions.toggleCanvasPerfAdvanced}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                advanced
                  ? 'text-amber-200 bg-amber-500/25'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
              }`}
              title={
                advanced
                  ? '关闭高级：恢复自动保存与撤销，仍保持预览暂停'
                  : '高级：额外暂停自动保存与撤销（布局更流畅；崩溃可能丢改动）'
              }
            >
              <Zap size={12} className={advanced ? 'text-amber-300' : ''} />
              高级
            </button>
          </>
        )}
      </div>
      {paused && advanced && (
        <span className="text-[10px] text-amber-400/90 whitespace-nowrap hidden xl:inline">
          自动保存已暂停
        </span>
      )}
    </div>
  );
}

type ParsedRoute =
  | { name: 'test-chat' }
  | { name: 'login' }
  | { name: 'projects' }
  | { name: 'root' }
  | { name: 'admin-users' }
  | { name: 'admin-projects' }
  | { name: 'workspace'; projectId: string }
  | { name: 'legacy' };

function parseHashRoute(hash: string): ParsedRoute {
  const h = (hash || '#/').replace(/^#/, '') || '/';
  const path = h.split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'test-chat') return { name: 'test-chat' };
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'projects') return { name: 'projects' };
  // 默认根路径：未登录时显示登录页，已登录时显示项目列表
  if (path === '/' || path === '') return { name: 'root' };
  if (parts[0] === 'admin' && parts[1] === 'users') return { name: 'admin-users' };
  if (parts[0] === 'admin' && parts[1] === 'projects') return { name: 'admin-projects' };
  if (parts[0] === 'workspace' && parts[1]) return { name: 'workspace', projectId: parts[1] };
  if (parts[0] === 'legacy') return { name: 'legacy' };
  return { name: 'projects' };
}

function WorkspaceShell({
  projectId,
  projectName,
  onProjectNameChange,
  onProjectActionsChange,
}: {
  projectId: string;
  projectName: string;
  onProjectNameChange: (s: string) => void;
  onProjectActionsChange: (a: FlowEditorProjectActions | null) => void;
}) {
  const [hydration, setHydration] = useState<{ version: number; payload: unknown } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let c = false;
    setHydration(null);
    setErr('');
    getWorkspace(projectId)
      .then((w) => {
        if (!c) setHydration({ version: w.version, payload: w.payload });
      })
      .catch((e) => {
        if (!c) setErr(e instanceof Error ? e.message : '加载工程失败');
      });
    return () => {
      c = true;
    };
  }, [projectId]);

  if (err) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm p-6">
        {err}{' '}
        <button type="button" className="ml-3 underline" onClick={() => (window.location.hash = '#/projects')}>
          返回项目列表
        </button>
      </div>
    );
  }
  if (!hydration) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        正在加载工程数据…
      </div>
    );
  }

  return (
    <Suspense fallback={<FlowEditorLoadFallback />}>
      <FlowEditorWrapper
        projectName={projectName}
        onProjectNameChange={onProjectNameChange}
        onProjectActionsChange={onProjectActionsChange}
        serverProjectId={projectId}
        workspaceHydration={hydration}
      />
    </Suspense>
  );
}

function App() {
  const [projectName, setProjectName] = useState('');
  const [projectActions, setProjectActions] = useState<FlowEditorProjectActions | null>(null);
  const [user, setUser] = useState(() => getStoredUser());
  const [mustChangePassword, setMustChangePassword] = useState(() => !!getStoredUser()?.mustChangePassword);
  const [cpOld, setCpOld] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpErr, setCpErr] = useState('');

  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash || '#/'
  );

  const route = useMemo(() => parseHashRoute(hash), [hash]);

  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      setUser(null);
      return;
    }
    let c = false;
    fetchMe()
      .then((u) => {
        if (c) return;
        setUser(u);
        setSession(t, u);
        setMustChangePassword(!!u.mustChangePassword);
      })
      .catch(() => {
        if (c) return;
        clearSession();
        setUser(null);
      });
    return () => {
      c = true;
    };
  }, [hash]);

  useEffect(() => {
    if (route.name === 'legacy' || route.name === 'test-chat') return;
    const t = getStoredToken();
    if (!t && route.name !== 'login') {
      // 未登录时，除login外的所有路由都跳转到登录页
      window.location.hash = '#/login';
      return;
    }
    if (t && (route.name === 'login' || route.name === 'root')) {
      // 已登录时，login和root都跳转到项目列表
      window.location.hash = '#/projects';
    }
  }, [route.name]);

  /** 进入工作区时在「工程名」展示：项目名-登录名（与列表项目名称一致；多用户下便于区分） */
  const workspaceProjectId = route.name === 'workspace' ? route.projectId : undefined;
  useEffect(() => {
    if (!workspaceProjectId) return;
    const pid = workspaceProjectId;
    const uname = user?.username ?? getStoredUser()?.username ?? '';
    let cancelled = false;
    void listProjects()
      .then((r) => {
        if (cancelled) return;
        const p = r.projects.find((x) => x.id === pid);
        if (!p) return;
        setProjectName(uname ? `${p.name}-${uname}` : p.name);
      })
      .catch(() => {
        /* 列表失败时保留 FlowEditor 或占位，不强制清空 */
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceProjectId, user?.username]);

  const onLogout = () => {
    clearSession();
    setUser(null);
    navigate('#/login');
  };

  const submitChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpErr('');
    try {
      await changePassword(mustChangePassword ? undefined : cpOld, cpNew);
      setMustChangePassword(false);
      const u = await fetchMe();
      const t = getStoredToken();
      if (t) setSession(t, u);
      setUser(u);
      setCpNew('');
      setCpOld('');
    } catch (err) {
      setCpErr(err instanceof Error ? err.message : '改密失败');
    }
  };

  if (route.name === 'test-chat') {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-white">
        <header className="h-14 border-b border-gray-800 bg-gray-900 flex items-center px-6 z-20 flex-none">
          <span className="font-bold text-gray-100">FlowGen · 测试对话</span>
        </header>
        <main className="flex-1 overflow-hidden">
          <ErrorBoundary>
            <TestChatPage />
          </ErrorBoundary>
        </main>
      </div>
    );
  }

  if (route.name === 'login' || route.name === 'root') {
    return (
      <LoginPage
        onDone={() => {
          setUser(getStoredUser());
          navigate('#/projects');
        }}
      />
    );
  }

  if (route.name === 'legacy') {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-white">
        <header className="h-14 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-6 z-20 shadow-sm flex-none">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-gradient-to-tr from-brand-600 to-purple-600 rounded-lg shadow-lg">
              <Zap className="text-white w-5 h-5 fill-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-gray-100">FlowGen AI</span>
            <span className="text-[10px] text-amber-400 border border-amber-500/40 rounded px-2 py-0.5">离线单机</span>
          </div>
          <div className="flex items-center gap-4">
            <CanvasRefreshHeaderControls actions={projectActions} />
            <button
              type="button"
              onClick={() => navigate('#/login')}
              className="text-xs text-brand-400 hover:underline"
            >
              多用户登录 →
            </button>
          </div>
        </header>
        <main className="flex-1 relative bg-gray-800 overflow-hidden">
          <ErrorBoundary>
            <Suspense fallback={<FlowEditorLoadFallback />}>
              <FlowEditorWrapper
                projectName={projectName}
                onProjectNameChange={setProjectName}
                onProjectActionsChange={setProjectActions}
              />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    );
  }

  if (!getStoredToken()) {
    return null;
  }

  if (route.name === 'admin-users') {
    const storedUser = getStoredUser();
    const effectiveRole = user?.role ?? storedUser?.role;
    if (!isAdminRole(effectiveRole)) {
      if (getStoredToken() && !user && !storedUser) {
        return (
          <div className="h-screen w-screen flex items-center justify-center bg-gray-950 text-gray-400 text-sm">
            正在验证权限…
          </div>
        );
      }
      navigate('#/projects');
      return null;
    }
    return (
      <div className="h-screen w-screen overflow-auto bg-gray-950">
        <AdminUsersPage onBack={() => navigate('#/projects')} />
      </div>
    );
  }

  if (route.name === 'admin-projects') {
    const storedUser = getStoredUser();
    const effectiveRole = user?.role ?? storedUser?.role;
    if (!isAdminRole(effectiveRole)) {
      if (getStoredToken() && !user && !storedUser) {
        return (
          <div className="h-screen w-screen flex items-center justify-center bg-gray-950 text-gray-400 text-sm">
            正在验证权限…
          </div>
        );
      }
      navigate('#/projects');
      return null;
    }
    return (
      <div className="h-screen w-screen overflow-auto bg-gray-950">
        <AdminProjectsPage onBack={() => navigate('#/projects')} />
      </div>
    );
  }

  if (route.name === 'projects') {
    return (
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-gray-950">
        <ProjectListPage
          onOpen={(id) => navigate(`#/workspace/${id}`)}
          onAdminUsers={() => navigate('#/admin/users')}
          onLogout={() => navigate('#/login')}
        />
      </div>
    );
  }

  if (route.name === 'workspace') {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-white">
        <header className="h-14 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-6 z-20 shadow-sm flex-none">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-gradient-to-tr from-brand-600 to-purple-600 rounded-lg shadow-lg">
              <Zap className="text-white w-5 h-5 fill-white" />
            </div>
            <button
              type="button"
              onClick={() => navigate('#/projects')}
              className="text-xs text-gray-400 hover:text-white mr-2"
            >
              ← 项目
            </button>
            <span className="font-bold text-xl tracking-tight text-gray-100">FlowGen AI</span>
            <span className="px-2 py-0.5 rounded-full bg-gray-800 text-[10px] font-medium text-gray-300 border border-gray-700">
              Studio
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span>工程名:</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-48 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm focus:outline-none focus:border-brand-500 placeholder:text-gray-500"
                placeholder="项目名-登录名"
                title="默认：列表中的项目名-当前登录用户名；可改为自定义保存名"
              />
              <button
                onClick={() => projectActions?.quickSave?.() ?? projectActions?.openSaveDialog()}
                className="p-1.5 rounded border border-gray-700 bg-gray-800 hover:bg-green-500/20 text-green-400 hover:text-white transition-colors disabled:opacity-50"
                title="保存工程到本地文件"
                disabled={!projectActions}
              >
                <Save size={14} />
              </button>
              <button
                onClick={() => projectActions?.newProject?.()}
                className="p-1.5 rounded border border-gray-700 bg-gray-800 hover:bg-amber-500/20 text-amber-400 hover:text-white transition-colors disabled:opacity-50"
                title="新建工程"
                disabled={!projectActions}
              >
                <FilePlus2 size={14} />
              </button>
              <button
                onClick={() => projectActions?.loadProject()}
                className="p-1.5 rounded border border-gray-700 bg-gray-800 hover:bg-blue-500/20 text-blue-400 hover:text-white transition-colors disabled:opacity-50"
                title="打开本地工程文件"
                disabled={!projectActions}
              >
                <FolderOpen size={14} />
              </button>
              <CanvasRefreshHeaderControls actions={projectActions} />
            </div>
            <span className="text-xs text-gray-500 max-w-[120px] truncate" title={user?.username}>
              {user?.username}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
              title="退出登录"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 relative bg-gray-800 overflow-hidden">
          <ErrorBoundary>
            <WorkspaceShell
              projectId={route.projectId}
              projectName={projectName}
              onProjectNameChange={setProjectName}
              onProjectActionsChange={setProjectActions}
            />
          </ErrorBoundary>
        </main>

        {mustChangePassword && (
          <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/80 p-4">
            <form
              onSubmit={submitChangePassword}
              className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 space-y-3"
            >
              <h2 className="text-lg font-bold text-white">首次登录请修改密码</h2>
              {cpErr && <p className="text-sm text-red-400">{cpErr}</p>}
              {!mustChangePassword ? (
                <>
                  <label className="text-xs text-gray-500">当前密码</label>
                  <input
                    type="password"
                    className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-600 text-sm"
                    value={cpOld}
                    onChange={(e) => setCpOld(e.target.value)}
                  />
                </>
              ) : null}
              <label className="text-xs text-gray-500">新密码</label>
              <input
                type="password"
                className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-600 text-sm"
                value={cpNew}
                onChange={(e) => setCpNew(e.target.value)}
                required
                minLength={4}
              />
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-brand-600 text-white text-sm font-medium"
              >
                确认修改
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return null;
}

export default App;
