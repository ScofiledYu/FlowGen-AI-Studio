import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  listProjects,
  createProject,
  listMembers,
  listUsers,
  addMember,
  removeMember,
  patchMemberRole,
  createUserInProject,
  importProjects,
} from '../../services/flowgenApi';

export function AdminProjectsPage({ onBack }: { onBack: () => void }) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{ userId: string; username: string; role: string }>>([]);
  const [allUsers, setAllUsers] = useState<Array<{ id: string; username: string }>>([]);
  const [name, setName] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [quickUser, setQuickUser] = useState('');
  const [quickPass, setQuickPass] = useState('');
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
        const u = await listUsers();
        setAllUsers(u.users.map((x) => ({ id: x.id, username: x.username })));
      } catch (e) {
        setErr(e instanceof Error ? e.message : '加载失败');
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadMembers(selectedId).catch((e) => setErr(String(e.message || e)));
  }, [selectedId]);

  const onCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await createProject(name.trim());
      setName('');
      await loadProjects();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '创建失败');
    }
  };

  const onImport = async (f: File) => {
    setErr('');
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const r = await importProjects(json);
      if (r.errors?.length) {
        setErr(`导入 ${r.imported}；失败 ${r.errors.length}（${r.errors[0].message}）`);
      }
      await loadProjects();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '导入失败');
    }
  };

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

        <form onSubmit={onCreateProject} className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500 block">新项目名</label>
            <input
              className="px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" className="px-3 py-1.5 rounded-lg bg-brand-600 text-sm">
            创建
          </button>
          <label className="text-sm text-gray-400 cursor-pointer ml-4">
            <span className="underline">Excel 导入项目</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onImport(f);
              }}
            />
          </label>
        </form>

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
            <h2 className="text-sm font-semibold text-gray-400 mb-2">成员</h2>
            {!selectedId ? (
              <p className="text-gray-500 text-sm">选择左侧项目</p>
            ) : (
              <>
                <div className="flex gap-2 mb-3">
                  <select
                    className="flex-1 px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-sm"
                    value={addUserId}
                    onChange={(e) => setAddUserId(e.target.value)}
                  >
                    <option value="">选择已有用户…</option>
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1.5 text-sm border border-gray-600 rounded-lg"
                    onClick={async () => {
                      if (!addUserId || !selectedId) return;
                      try {
                        await addMember(selectedId, addUserId, 'editor');
                        await loadMembers(selectedId);
                        setAddUserId('');
                      } catch (e2) {
                        alert(e2 instanceof Error ? e2.message : '失败');
                      }
                    }}
                  >
                    加入
                  </button>
                </div>
                <div className="rounded-lg border border-gray-800 p-3 mb-3 space-y-2">
                  <p className="text-xs text-gray-500">快捷：新建用户并加入本项目</p>
                  <input
                    placeholder="用户名"
                    className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs"
                    value={quickUser}
                    onChange={(e) => setQuickUser(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="初始密码"
                    className="w-full px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs"
                    value={quickPass}
                    onChange={(e) => setQuickPass(e.target.value)}
                  />
                  <button
                    type="button"
                    className="text-xs px-2 py-1 bg-brand-600 rounded"
                    onClick={async () => {
                      if (!selectedId) return;
                      try {
                        await createUserInProject(selectedId, {
                          username: quickUser.trim(),
                          password: quickPass,
                        });
                        setQuickUser('');
                        setQuickPass('');
                        await loadProjects();
                        const u = await listUsers();
                        setAllUsers(u.users.map((x) => ({ id: x.id, username: x.username })));
                        await loadMembers(selectedId);
                      } catch (e2) {
                        alert(e2 instanceof Error ? e2.message : '失败');
                      }
                    }}
                  >
                    创建并加入
                  </button>
                </div>
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li
                      key={m.userId}
                      className="flex items-center justify-between text-sm border border-gray-800 rounded px-2 py-1"
                    >
                      <span>{m.username}</span>
                      <div className="flex items-center gap-2">
                        <select
                          className="bg-gray-800 text-xs rounded px-1 py-0.5"
                          value={m.role}
                          onChange={async (e) => {
                            try {
                              await patchMemberRole(selectedId, m.userId, e.target.value);
                              await loadMembers(selectedId);
                            } catch (e2) {
                              alert(e2 instanceof Error ? e2.message : '失败');
                            }
                          }}
                        >
                          <option value="owner">owner</option>
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button
                          type="button"
                          className="text-red-400 text-xs"
                          onClick={async () => {
                            try {
                              await removeMember(selectedId, m.userId);
                              await loadMembers(selectedId);
                            } catch (e2) {
                              alert(e2 instanceof Error ? e2.message : '失败');
                            }
                          }}
                        >
                          移除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
