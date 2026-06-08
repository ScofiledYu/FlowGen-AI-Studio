import React, { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Search,
  Plus,
  X,
  Upload,
  Download,
  ChevronLeft,
  User,
  Shield,
  Key,
  Trash2,
  Edit2,
  MoreHorizontal,
  Check,
  UserPlus,
  FileSpreadsheet,
  ChevronDown,
  Building2,
  Filter,
  FolderOpen,
} from 'lucide-react';
import {
  listUsers,
  createUser,
  patchUser,
  deleteUser,
  importUsers,
  getStoredUser,
  listProjects,
  listMembers,
  addMember,
  removeMember,
  normalizeGlobalRoleInput,
  globalRoleLabel,
  FLOWGEN_ROLES,
} from '../../services/flowgenApi';

interface UserRow {
  id: string;
  username: string;
  displayName?: string;
  role: string;
  center?: string;
  status: string;
  extendedJson?: Record<string, unknown>;
  mustChangePassword?: boolean;
  createdAt?: string;
  /** 与成员表一致，来自 GET /users */
  projects?: Array<{ id: string; name: string }>;
}

/** 弹窗「关联项目」列表展示：兼容 name 为空或写在 extendedJson 的数据 */
function displayProjectLabel(p: {
  id: string;
  name?: string;
  extendedJson?: Record<string, unknown>;
}) {
  if (typeof p.name === 'string' && p.name.trim()) return p.name.trim();
  const ext = p.extendedJson && typeof p.extendedJson === 'object' ? p.extendedJson : {};
  for (const k of ['title', 'projectName', 'displayName']) {
    const v = ext[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return `未命名 (${p.id.slice(0, 8)})`;
}

const CENTER_OPTIONS = [
  '制片中心',
  '角色艺术中心',
  '环境艺术中心',
  '动画表演中心',
  '视觉艺术中心',
  '技术中心',
  '分镜表演设计中心',
  '后期中心',
  '美术设计中心',
  '剧本编创中心',
  '管理中心',
  '策划创意中心',
  'AI平台中心',
  'AI短视频中心',
];

export function AdminUsersPage({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [filteredRows, setFilteredRows] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  
  // 筛选状态
  const [filterRole, setFilterRole] = useState<string>('');
  const [filterCenter, setFilterCenter] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  
  // Create/Edit modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [center, setCenter] = useState('');
  const [status, setStatus] = useState('active');

  const [allProjects, setAllProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [projectSearch, setProjectSearch] = useState('');
  const [projectsPanelLoading, setProjectsPanelLoading] = useState(false);
  const initialProjectIdsRef = useRef<Set<string>>(new Set());

  const me = getStoredUser();

  useEffect(() => {
    if (!isModalOpen) return;
    let cancelled = false;
    setProjectsPanelLoading(true);
    void (async () => {
      try {
        const r = await listProjects();
        if (cancelled) return;
        setAllProjects(
          r.projects.map((p) => ({
            id: p.id,
            name: displayProjectLabel(p),
          }))
        );
        if (editingUser) {
          const initial = new Set<string>();
          await Promise.all(
            r.projects.map(async (p) => {
              try {
                const m = await listMembers(p.id);
                if (m.members.some((mem) => mem.userId === editingUser.id)) initial.add(p.id);
              } catch {
                /* 单个项目成员列表失败时跳过 */
              }
            })
          );
          if (cancelled) return;
          setSelectedProjectIds(initial);
          initialProjectIdsRef.current = new Set(initial);
        } else {
          setSelectedProjectIds(new Set());
          initialProjectIdsRef.current = new Set();
        }
      } catch {
        if (!cancelled) setAllProjects([]);
      } finally {
        if (!cancelled) setProjectsPanelLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isModalOpen, editingUser?.id]);

  const load = async () => {
    setErr('');
    setLoading(true);
    try {
      const r = await listUsers();
      let list =
        r && typeof r === 'object' && Array.isArray((r as { users?: unknown }).users)
          ? ([...(r as { users: UserRow[] }).users] as UserRow[])
          : null;
      if (!list) {
        setRows([]);
        setErr('服务器返回数据异常，请检查 API 连接。');
        return;
      }

      /** 表格「关联项目」列：用各项目成员接口汇总，避免仅依赖 GET /users 的 projects 字段（旧服务或未重启时为空） */
      try {
        const projRes = await listProjects();
        const byUser = new Map<string, Array<{ id: string; name: string }>>();
        await Promise.all(
          projRes.projects.map(async (proj) => {
            try {
              const m = await listMembers(proj.id);
              const name = displayProjectLabel(proj);
              for (const mem of m.members) {
                const uid = mem.userId;
                const arr = byUser.get(uid) ?? [];
                if (!arr.some((x) => x.id === proj.id)) {
                  arr.push({ id: proj.id, name });
                  byUser.set(uid, arr);
                }
              }
            } catch {
              /* 单个项目成员列表失败时跳过 */
            }
          })
        );
        for (const arr of byUser.values()) {
          arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        }
        list = list.map((u) => ({
          ...u,
          projects: byUser.get(u.id) ?? (Array.isArray(u.projects) ? u.projects : []),
        }));
      } catch {
        /* 项目列表失败时保留接口返回的 projects（若有） */
        list = list.map((u) => ({
          ...u,
          projects: Array.isArray(u.projects) ? u.projects : [],
        }));
      }

      setRows(list);
      applyFilters(list, q, filterRole, filterCenter, filterStatus);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Apply filters
  const applyFilters = (
    data: UserRow[],
    searchQuery: string,
    roleFilter: string,
    centerFilter: string,
    statusFilter: string
  ) => {
    let result = [...data];
    
    // Text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(u => 
        u.username.toLowerCase().includes(query) ||
        (u.displayName && u.displayName.toLowerCase().includes(query)) ||
        (u.projects && u.projects.some((p) => p.name.toLowerCase().includes(query)))
      );
    }
    
    // Role filter
    if (roleFilter) {
      result = result.filter(u => u.role === roleFilter);
    }
    
    // Center filter
    if (centerFilter) {
      result = result.filter(u => u.center === centerFilter);
    }
    
    // Status filter
    if (statusFilter) {
      result = result.filter(u => u.status === statusFilter);
    }
    
    setFilteredRows(result);
  };

  // Re-apply filters when they change
  useEffect(() => {
    applyFilters(rows, q, filterRole, filterCenter, filterStatus);
  }, [q, filterRole, filterCenter, filterStatus, rows]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const extendedJson: Record<string, unknown> = {};
      if (displayName.trim()) {
        extendedJson.displayName = displayName.trim();
      }
      if (center) {
        extendedJson.center = center;
      }
      
      const created = (await createUser({
        username: username.trim(),
        password,
        role,
        status,
        extendedJson: Object.keys(extendedJson).length > 0 ? extendedJson : undefined,
      })) as { id?: string };
      const newId = created?.id;
      if (!newId) throw new Error('创建成功但未返回用户 ID');
      for (const pid of selectedProjectIds) {
        await addMember(pid, newId, 'editor');
      }

      resetForm();
      setIsModalOpen(false);
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '创建失败');
    }
  };

  const onUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setErr('');
    try {
      await patchUser(editingUser.id, {
        role,
        center,
        status,
      });

      const uid = editingUser.id;
      const prev = initialProjectIdsRef.current;
      const next = selectedProjectIds;
      for (const pid of next) {
        if (!prev.has(pid)) await addMember(pid, uid, 'editor');
      }
      for (const pid of prev) {
        if (!next.has(pid)) await removeMember(pid, uid);
      }

      resetForm();
      setIsModalOpen(false);
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '更新失败');
    }
  };

  const resetForm = () => {
    setEditingUser(null);
    setUsername('');
    setDisplayName('');
    setPassword('');
    setRole('user');
    setCenter('');
    setStatus('active');
    setSelectedProjectIds(new Set());
    setProjectSearch('');
    initialProjectIdsRef.current = new Set();
  };

  const onImportFile = async (f: File) => {
    setErr('');
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      
      // 转换中文列名
      const mapped = json.map(row => ({
        username: row.username || row['用户名'] || row['账号'],
        password: row.password || row['初始密码'] || row['密码'],
        role: normalizeGlobalRoleInput(row.role || row['权限'] || row['角色'] || 'user'),
        status: row.status || row['状态'] || 'active',
        extendedJson: {
          displayName: row.displayName || row['中文名'] || row['姓名'] || row['昵称'] || '',
          center: row.center || row['中心'] || '',
        }
      }));
      
      const r = await importUsers(mapped);
      if (r.errors?.length) {
        setErr(`导入 ${r.imported} 条；失败 ${r.errors.length} 条（首条：${r.errors[0].message}）`);
      } else {
        setErr(`成功导入 ${r.imported} 位用户`);
      }
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '导入失败');
    }
  };

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (user: UserRow) => {
    setEditingUser(user);
    setUsername(user.username);
    setDisplayName(user.displayName || '');
    setRole(user.role);
    setCenter(user.center || '');
    setStatus(user.status || 'active');
    setIsModalOpen(true);
  };

  const clearFilters = () => {
    setFilterRole('');
    setFilterCenter('');
    setFilterStatus('');
    setQ('');
  };

  const hasActiveFilters = filterRole || filterCenter || filterStatus || q;

  const getRoleBadge = (role: string) => {
    if (role === 'super_admin') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full 
          bg-purple-500/20 text-purple-400 text-xs font-medium border border-purple-500/30">
          <Shield className="w-3 h-3" />
          超级管理员
        </span>
      );
    }
    if (role === 'admin') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full 
          bg-brand-500/20 text-brand-400 text-xs font-medium border border-brand-500/30">
          <Shield className="w-3 h-3" />
          管理员
        </span>
      );
    }
    if (role === FLOWGEN_ROLES.PROJECT_ADMIN) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full 
          bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/30">
          <FolderOpen className="w-3 h-3" />
          项目管理员
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full 
        bg-gray-500/20 text-gray-400 text-xs font-medium border border-gray-500/30">
        <User className="w-3 h-3" />
        普通用户
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    if (status === 'disabled') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          禁用
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        激活
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={onBack}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
                <span className="text-sm">返回</span>
              </button>
              <h1 className="text-xl font-bold">用户管理</h1>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Export Template */}
              <button
                onClick={() => {
                  const template = [
                    { '用户名': 'example', '初始密码': '123456', '权限': '普通用户', '状态': 'active', '中文名': '张三', '中心': '技术中心' }
                  ];
                  const ws = XLSX.utils.json_to_sheet(template);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, '模板');
                  XLSX.writeFile(wb, '用户导入模板.xlsx');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl
                  bg-white/5 border border-white/10 hover:bg-white/10
                  text-sm text-gray-300 hover:text-white transition-all"
              >
                <Download className="w-4 h-4" />
                下载模板
              </button>
              
              {/* Import */}
              <label className="flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer
                bg-white/5 border border-white/10 hover:bg-white/10
                text-sm text-gray-300 hover:text-white transition-all">
                <Upload className="w-4 h-4" />
                Excel导入
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void onImportFile(f);
                  }}
                />
              </label>
              
              {/* Create User */}
              <button
                onClick={openCreateModal}
                className="flex items-center gap-2 px-4 py-2 rounded-xl
                  bg-gradient-to-r from-brand-600 to-brand-500
                  hover:from-brand-500 hover:to-brand-400
                  text-sm font-medium text-white shadow-lg shadow-brand-500/20
                  transition-all hover:scale-[1.02]"
              >
                <UserPlus className="w-4 h-4" />
                新建用户
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Error Message */}
        {err && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 
            text-amber-400 text-sm flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {err}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
            <p className="text-2xl font-bold">{rows.length}</p>
            <p className="text-sm text-gray-500">总用户数</p>
          </div>
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
            <p className="text-2xl font-bold text-brand-400">
              {rows.filter(u => u.role === 'admin' || u.role === 'super_admin').length}
            </p>
            <p className="text-sm text-gray-500">管理员</p>
          </div>
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
            <p className="text-2xl font-bold text-green-400">
              {rows.filter(u => u.status === 'active').length}
            </p>
            <p className="text-sm text-gray-500">已激活</p>
          </div>
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
            <p className="text-2xl font-bold text-red-400">
              {rows.filter(u => u.status === 'disabled').length}
            </p>
            <p className="text-sm text-gray-500">已禁用</p>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex gap-3">
            {/* Search */}
            <div className="flex-1 relative max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                placeholder="搜索用户名或中文名..."
                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl
                  text-sm text-white placeholder:text-gray-500
                  focus:outline-none focus:border-brand-500/50 focus:bg-white/[0.07]
                  transition-all"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  onClick={() => setQ('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            
            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-all
                ${showFilters || hasActiveFilters
                  ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:text-white'
                }`}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm">筛选</span>
              {hasActiveFilters && (
                <span className="w-5 h-5 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center">
                  {[filterRole, filterCenter, filterStatus, q].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
          
          {/* Filter Panel */}
          {showFilters && (
            <div className="flex flex-wrap gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/10 [color-scheme:dark]">
              {/* Role Filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">权限:</span>
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-white/10 rounded-lg text-sm text-white
                    focus:outline-none focus:border-brand-500/50 min-w-[120px]
                    [color-scheme:dark]
                    [&>option]:bg-gray-900 [&>option]:text-white"
                >
                  <option value="">全部</option>
                  <option value="user">普通用户</option>
                  <option value="project_admin">项目管理员</option>
                  <option value="admin">管理员</option>
                  <option value="super_admin">超级管理员</option>
                </select>
              </div>
              
              {/* Center Filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">中心:</span>
                <select
                  value={filterCenter}
                  onChange={(e) => setFilterCenter(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-white/10 rounded-lg text-sm text-white
                    focus:outline-none focus:border-brand-500/50 min-w-[140px]
                    [color-scheme:dark]
                    [&>option]:bg-gray-900 [&>option]:text-white"
                >
                  <option value="">全部</option>
                  {CENTER_OPTIONS.map(center => (
                    <option key={center} value={center}>{center}</option>
                  ))}
                </select>
              </div>
              
              {/* Status Filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">状态:</span>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-white/10 rounded-lg text-sm text-white
                    focus:outline-none focus:border-brand-500/50 min-w-[100px]
                    [color-scheme:dark]
                    [&>option]:bg-gray-900 [&>option]:text-white"
                >
                  <option value="">全部</option>
                  <option value="active">激活</option>
                  <option value="disabled">禁用</option>
                </select>
              </div>
              
              {/* Clear Filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="ml-auto flex items-center gap-1 px-3 py-2 text-sm text-gray-400 hover:text-white
                    hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                  清除筛选
                </button>
              )}
            </div>
          )}
        </div>

        {/* Results Count */}
        <div className="mb-4 text-sm text-gray-500">
          共 {filteredRows.length} 位用户
          {hasActiveFilters && ' (已筛选)'}
        </div>

        {/* User Table */}
        <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/[0.02]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  用户信息
                </th>
                <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  权限
                </th>
                <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  中心
                </th>
                <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  关联项目
                </th>
                <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-white/10">
                    <td className="p-4"><div className="h-10 bg-white/5 rounded-lg animate-pulse" /></td>
                    <td className="p-4"><div className="h-6 w-20 bg-white/5 rounded-full animate-pulse" /></td>
                    <td className="p-4"><div className="h-6 w-24 bg-white/5 rounded animate-pulse" /></td>
                    <td className="p-4"><div className="h-6 w-32 bg-white/5 rounded animate-pulse" /></td>
                    <td className="p-4"><div className="h-6 w-16 bg-white/5 rounded animate-pulse" /></td>
                    <td className="p-4"><div className="h-8 w-24 bg-white/5 rounded-lg animate-pulse ml-auto" /></td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                      <User className="w-8 h-8 text-gray-600" />
                    </div>
                    <p className="text-gray-500">
                      {hasActiveFilters ? '没有符合筛选条件的用户' : '暂无用户数据'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRows.map((u) => (
                  <tr key={u.id} className="border-b border-white/10 hover:bg-white/[0.03] transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 
                          flex items-center justify-center text-sm font-medium">
                          {u.displayName?.[0] || u.username[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{u.username}</p>
                          {u.displayName && (
                            <p className="text-sm text-gray-500">{u.displayName}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">{getRoleBadge(u.role)}</td>
                    <td className="p-4">
                      {u.center ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-gray-300">
                          <Building2 className="w-3.5 h-3.5 text-gray-500" />
                          {u.center}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-600">-</span>
                      )}
                    </td>
                    <td className="p-4 max-w-[240px]">
                      {!u.projects?.length ? (
                        <span className="text-sm text-gray-600">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.projects.slice(0, 4).map((p) => (
                            <span
                              key={p.id}
                              title={p.name}
                              className="inline-flex max-w-[112px] truncate px-2 py-0.5 rounded-md bg-white/10 text-xs text-gray-300"
                            >
                              {p.name}
                            </span>
                          ))}
                          {u.projects.length > 4 && (
                            <span className="text-xs text-gray-500 self-center">+{u.projects.length - 4}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-4">{getStatusBadge(u.status)}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(u)}
                          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                          title="编辑"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async () => {
                            const np = window.prompt('重置密码为');
                            if (!np) return;
                            try {
                              await patchUser(u.id, { password: np, mustChangePassword: true });
                              await load();
                            } catch (e2) {
                              alert(e2 instanceof Error ? e2.message : '失败');
                            }
                          }}
                          className="p-2 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                          title="重置密码"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        {u.id !== me?.id && (
                          <button
                            onClick={async () => {
                              if (!confirm(`确定删除用户 ${u.username}？`)) return;
                              try {
                                await deleteUser(u.id);
                                await load();
                              } catch (e2) {
                                alert(e2 instanceof Error ? e2.message : '失败');
                              }
                            }}
                            className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-gray-900 border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-6">
              {editingUser ? '编辑用户' : '新建用户'}
            </h2>
            
            <form onSubmit={editingUser ? onUpdate : onCreate} className="space-y-4">
              {/* Username */}
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                  用户名
                </label>
                <input
                  type="text"
                  placeholder="输入用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={!!editingUser}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl 
                    text-white placeholder:text-gray-600
                    focus:outline-none focus:border-brand-500/50
                    disabled:opacity-50 disabled:cursor-not-allowed"
                  required={!editingUser}
                />
              </div>

              {/* Display Name - only for create */}
              {!editingUser && (
                <div>
                  <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                    中文名
                  </label>
                  <input
                    type="text"
                    placeholder="输入中文名（可选）"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl 
                      text-white placeholder:text-gray-600
                      focus:outline-none focus:border-brand-500/50"
                  />
                </div>
              )}

              {/* Center */}
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                  中心
                </label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <select
                    value={center}
                    onChange={(e) => setCenter(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-gray-900 border border-white/10 rounded-xl 
                      text-white focus:outline-none focus:border-brand-500/50 appearance-none
                      [color-scheme:dark]
                      [&>option]:bg-gray-900 [&>option]:text-white"
                  >
                    <option value="">选择中心（可选）</option>
                    {CENTER_OPTIONS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                  权限
                </label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      FLOWGEN_ROLES.USER,
                      FLOWGEN_ROLES.PROJECT_ADMIN,
                      FLOWGEN_ROLES.ADMIN,
                      ...(me?.role === 'super_admin' ? [FLOWGEN_ROLES.SUPER_ADMIN] : []),
                    ] as string[]
                  ).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex-1 min-w-[7rem] py-2.5 rounded-xl border text-sm font-medium transition-all
                        ${
                          role === r
                            ? r === FLOWGEN_ROLES.SUPER_ADMIN
                              ? 'border-purple-500 bg-purple-500/20 text-purple-400'
                              : r === FLOWGEN_ROLES.PROJECT_ADMIN
                                ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                                : 'border-brand-500 bg-brand-500/20 text-brand-400'
                            : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
                        }`}
                    >
                      {globalRoleLabel(r)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                  普通用户：在所分配项目内使用画布与聊天，资产库仅可查找与引用。
                  项目管理员：同上，且对所分配项目的资产库可增删改查（须在下方勾选关联项目）。
                </p>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                  状态
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStatus('active')}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all
                      ${status === 'active'
                        ? 'border-green-500 bg-green-500/20 text-green-400'
                        : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                  >
                    激活
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus('disabled')}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all
                      ${status === 'disabled'
                        ? 'border-red-500 bg-red-500/20 text-red-400'
                        : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                  >
                    禁用
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {status === 'disabled' 
                    ? '禁用后该账号将无法登录系统' 
                    : '激活状态可正常登录使用'}
                </p>
              </div>

              {/* 关联项目 */}
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                  <span className="inline-flex items-center gap-2">
                    <FolderOpen className="w-3.5 h-3.5" />
                    关联项目
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="按项目名称筛选…"
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="w-full px-4 py-2.5 mb-2 bg-white/5 border border-white/10 rounded-xl text-sm
                    text-white placeholder:text-gray-600 focus:outline-none focus:border-brand-500/50"
                />
                {selectedProjectIds.size > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {Array.from(selectedProjectIds).map((pid) => {
                      const p = allProjects.find((x) => x.id === pid);
                      if (!p) return null;
                      return (
                        <span
                          key={pid}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-500/15 text-brand-200 text-xs border border-brand-500/25 max-w-full"
                        >
                          <FolderOpen className="w-3 h-3 shrink-0 opacity-70" />
                          <span className="truncate max-w-[160px]">{p.name}</span>
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white shrink-0"
                            onClick={() => {
                              setSelectedProjectIds((prev) => {
                                const n = new Set(prev);
                                n.delete(pid);
                                return n;
                              });
                            }}
                            aria-label={`移除项目 ${p.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {projectsPanelLoading ? (
                  <p className="text-xs text-gray-500 py-2">加载项目列表…</p>
                ) : allProjects.length === 0 ? (
                  <p className="text-xs text-gray-500 py-2">暂无可选项目</p>
                ) : (
                  <div
                    className="max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02]
                      divide-y divide-white/5"
                  >
                    {allProjects
                      .filter((p) =>
                        projectSearch.trim()
                          ? p.name.toLowerCase().includes(projectSearch.trim().toLowerCase())
                          : true
                      )
                      .map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 cursor-pointer min-w-0"
                        >
                          <input
                            type="checkbox"
                            className="shrink-0 rounded border-white/20 bg-white/5 text-brand-500 focus:ring-brand-500/40"
                            checked={selectedProjectIds.has(p.id)}
                            onChange={() => {
                              setSelectedProjectIds((prev) => {
                                const n = new Set(prev);
                                if (n.has(p.id)) n.delete(p.id);
                                else n.add(p.id);
                                return n;
                              });
                            }}
                          />
                          <span className="text-sm text-gray-200 truncate min-w-0 flex-1">{p.name}</span>
                        </label>
                      ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-500">
                  勾选加入项目；点击已选标签的 × 或取消勾选即可移除。保存后与「我的项目 → 成员管理」一致。
                </p>
              </div>

              {/* Password (only for create) */}
              {!editingUser && (
                <div>
                  <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                    初始密码
                  </label>
                  <input
                    type="password"
                    placeholder="输入初始密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl 
                      text-white placeholder:text-gray-600
                      focus:outline-none focus:border-brand-500/50"
                    required={!editingUser}
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 
                    hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!editingUser && (!username.trim() || !password)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 
                    text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors"
                >
                  {editingUser ? '保存' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
