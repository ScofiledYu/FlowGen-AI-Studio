import React, { useEffect, useState } from 'react';
import { listProjects, listMembers } from '../../services/flowgenApi';

export function AdminProjectsPage({ onBack }: { onBack: () => void }) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{ userId: string; username: string; role: string }>>([]);
  const [err, setErr] = useState('');

  const loadProjects = async () => {
    const r = await listProjects();
    setProjects(r.projects);
    if (!selectedId && r.projects[0]) setSelectedId(r.projects[0].id);
  };

  const loadMembers = async (pid: string) => {
    const r = await listMembers(pid);
    setMembers(r.members);
  };

  useEffect(() => {
    void (async () => {
      try {
        await loadProjects();
      } catch (e) {
        setErr(e instanceof Error ? e.message : '加载失败');
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadMembers(selectedId).catch((e) => setErr(String(e.message || e)));
  }, [selectedId]);

  return (
    <div className="min-h-full bg-gray-950 text-white p-6 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onBack} className="text-sm text-gray-400 hover:text-white">
            ← 返回
          </button>
          <h1 className="text-2xl font-bold">项目管理</h1>
        </div>
        {err && <p className="text-sm text-amber-400">{err}</p>}
        <p className="text-sm text-gray-500">
          项目与成员由 AITOP100 同步（登录用户名 = 域账号）。名称、成员分配请在 AITOP 平台配置，FlowGen 内仅可查看。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-400 mb-2">项目</h2>
            <ul className="space-y-1 max-h-80 overflow-auto border border-gray-800 rounded-lg">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-800 ${
                      selectedId === p.id ? 'bg-gray-800 border-l-2 border-brand-500' : ''
                    }`}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-400 mb-2">成员（只读）</h2>
            {!selectedId ? (
              <p className="text-gray-500 text-sm">选择左侧项目</p>
            ) : members.length === 0 ? (
              <p className="text-gray-500 text-sm">暂无成员或未从 AITOP 同步</p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between text-sm border border-gray-800 rounded px-2 py-1"
                  >
                    <span>{m.username}</span>
                    <span className="text-xs text-gray-500">{m.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
