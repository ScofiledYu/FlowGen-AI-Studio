import React, { useEffect, useState, useRef } from 'react';
import { 
  listProjects, 
  isAdminRole,
  canManageAssignedProject,
  getStoredUser, 
  patchProject,
  uploadProjectCover,
  clearProjectCover,
  clearSession,
  projectCoverDisplayUrl,
} from '../../services/flowgenApi';
import {
  mergeProjectSkillIntoExtendedJson,
  parseProjectSkill,
  PROJECT_SKILL_OUTPUT_TABLE_HINT_EXAMPLE,
} from '../../utils/projectSkill';
import {
  DIRECTOR_STORYBOARD_ADVANCED_MD,
  DIRECTOR_STORYBOARD_CORE_MD,
} from '../../utils/storyboardPresets';
import { 
  Plus, 
  MoreVertical, 
  Image as ImageIcon, 
  FolderOpen,
  Search,
  X,
  LogOut,
  Sparkles,
} from 'lucide-react';

interface ProjectItem {
  id: string;
  name: string;
  status: string;
  coverImage?: string | null;
  extendedJson?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export function ProjectListPage({
  onOpen,
  onAdminUsers,
  onLogout,
}: {
  onOpen: (projectId: string) => void;
  onAdminUsers: () => void;
  onLogout?: () => void;
}) {
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<ProjectItem[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [coverLoadFailedIds, setCoverLoadFailedIds] = useState<Set<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [skillEnabled, setSkillEnabled] = useState(false);
  const [skillTitle, setSkillTitle] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [skillOutputFormatHint, setSkillOutputFormatHint] = useState('');
  const [skillSaving, setSkillSaving] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const user = getStoredUser();
  const isAdmin = isAdminRole(user?.role);
  /** 平台管理员或项目管理员：对所分配项目显示 ⋮ 菜单（打开/封面/Skill） */
  const canManageProjectMenu = canManageAssignedProject(user?.role);

  // 加载项目列表
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await listProjects();
        if (!cancelled) {
          setItems(r.projects);
          setFilteredItems(r.projects);
          setCoverLoadFailedIds(new Set());
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 搜索过滤
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredItems(items);
      return;
    }
    const q = searchQuery.toLowerCase();
    setFilteredItems(items.filter(p => p.name.toLowerCase().includes(q)));
  }, [searchQuery, items]);

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 修改封面 - 使用本地文件上传
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setCoverPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleUpdateCover = async () => {
    if (!selectedProject) return;
    try {
      if (coverFile) {
        await uploadProjectCover(selectedProject.id, coverFile);
      } else if (!coverPreview) {
        await clearProjectCover(selectedProject.id);
      }
      
      setCoverModalOpen(false);
      setCoverPreview(null);
      setCoverFile(null);
      setSelectedProject(null);
      
      // 刷新列表
      const r = await listProjects();
      setItems(r.projects);
      setFilteredItems(r.projects);
      setMenuOpen(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : '修改封面失败');
    }
  };

  const openCoverModal = (project: ProjectItem) => {
    setSelectedProject(project);
    setCoverPreview(project.coverImage || null);
    setCoverFile(null);
    setCoverModalOpen(true);
    setMenuOpen(null);
  };

  const openSkillModal = (project: ProjectItem) => {
    const skill = parseProjectSkill(project.extendedJson);
    setSelectedProject(project);
    setSkillEnabled(skill?.enabled ?? false);
    setSkillTitle(skill?.title ?? '');
    setSkillContent(skill?.content ?? '');
    setSkillOutputFormatHint(skill?.outputFormatHint ?? '');
    setSkillModalOpen(true);
    setMenuOpen(null);
  };

  const handleSaveSkill = async () => {
    if (!selectedProject) return;
    if (skillEnabled && !skillTitle.trim()) {
      alert('启用 Skill 时请填写标题（成员将看到「已启用 · 标题」）');
      return;
    }
    if (skillEnabled && !skillContent.trim()) {
      alert('启用 Skill 时请填写 Skill 正文');
      return;
    }
    setSkillSaving(true);
    try {
      const nextSkill = {
        enabled: skillEnabled,
        title: skillTitle.trim(),
        content: skillContent,
        outputFormatHint: skillOutputFormatHint.trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
      const extendedJson = mergeProjectSkillIntoExtendedJson(selectedProject.extendedJson, nextSkill);
      await patchProject(selectedProject.id, { extendedJson });
      window.dispatchEvent(
        new CustomEvent('flowgen:project-skill-updated', {
          detail: { projectId: selectedProject.id },
        })
      );
      setSkillModalOpen(false);
      setSelectedProject(null);
      const r = await listProjects();
      setItems(r.projects);
      setFilteredItems(
        searchQuery.trim()
          ? r.projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
          : r.projects
      );
      setMenuOpen(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存 Skill 失败');
    } finally {
      setSkillSaving(false);
    }
  };

  // 打开菜单
  const openMenu = (e: React.MouseEvent, project: ProjectItem) => {
    e.stopPropagation();
    setMenuOpen(menuOpen === project.id ? null : project.id);
    setSelectedProject(project);
  };

  // 格式化日期
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Logo & Title */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                <span className="text-sm font-bold">F</span>
              </div>
              <h1 className="text-xl font-bold">我的项目</h1>
            </div>

            {/* Search Bar */}
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="搜索项目..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-full text-sm 
                    focus:outline-none focus:border-brand-500/50 focus:bg-white/10 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Admin Actions */}
            <div className="flex items-center gap-3">
              {isAdmin && (
                <button
                  onClick={onAdminUsers}
                  className="group relative px-5 py-2.5 rounded-xl overflow-hidden
                    bg-gradient-to-br from-white/10 to-white/5 
                    border border-white/20 hover:border-brand-400/50
                    backdrop-blur-sm
                    transition-all duration-300
                    hover:shadow-lg hover:shadow-brand-500/20
                    hover:scale-[1.02]"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-brand-500/0 via-brand-500/10 to-brand-500/0 
                    translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                  <span className="relative text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                    用户管理
                  </span>
                </button>
              )}
              <div className="flex items-center gap-2 ml-4 pl-4 border-l border-white/10">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 
                  flex items-center justify-center text-sm font-medium">
                  {user?.username?.[0]?.toUpperCase() || 'U'}
                </div>
                <span className="text-sm text-gray-400 hidden sm:block max-w-[80px] truncate">
                  {user?.username}
                </span>
                <button
                  onClick={() => {
                    clearSession();
                    onLogout?.();
                  }}
                  className="flex items-center gap-1.5 ml-1 px-3 py-1.5 rounded-lg 
                    text-gray-400 hover:text-red-400 hover:bg-red-500/10 
                    border border-transparent hover:border-red-500/30
                    transition-all text-xs font-medium"
                  title="退出登录"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">退出</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {err && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            {err}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-[4/3] rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {filteredItems.length === 0 && searchQuery && (
              <p className="text-center text-gray-500 text-sm mb-6">没有找到匹配的项目</p>
            )}
            {items.length === 0 && !searchQuery && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                  <FolderOpen className="w-10 h-10" />
                </div>
                <p className="text-lg">暂无项目</p>
                <p className="text-sm mt-2">项目由 AITOP100 平台分配，请联系管理员在 AITOP 配置域账号与项目权限</p>
              </div>
            )}
            {filteredItems.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {filteredItems.map((project) => (
              <div
                key={project.id}
                onClick={() => onOpen(project.id)}
                className="group relative aspect-[4/3] rounded-2xl overflow-visible cursor-pointer
                  border border-white/10
                  hover:border-brand-500/50 hover:shadow-xl hover:shadow-brand-500/10
                  transition-all duration-300"
              >
                <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none
                  bg-gradient-to-br from-gray-900 to-gray-800">
                  {/* Cover Image */}
                  {project.coverImage && !coverLoadFailedIds.has(project.id) ? (
                    <img
                      src={projectCoverDisplayUrl(project.coverImage, project.updatedAt)}
                      alt={project.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={() =>
                        setCoverLoadFailedIds((prev) => {
                          const next = new Set(prev);
                          next.add(project.id);
                          return next;
                        })
                      }
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br 
                      from-gray-800 to-gray-900">
                      <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-gray-600" />
                      </div>
                    </div>
                  )}

                  {/* Overlay Gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent 
                    opacity-60 group-hover:opacity-80 transition-opacity" />

                  {/* Project Info */}
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="font-semibold text-lg truncate group-hover:text-brand-400 transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {formatDate(project.createdAt)}
                    </p>
                  </div>
                </div>

                {/* Actions Menu（平台管理员 / 项目管理员） */}
                {canManageProjectMenu && (
                  <div className="absolute top-3 right-3 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => openMenu(e, project)}
                      className="p-2 rounded-xl bg-black/50 hover:bg-black/70 backdrop-blur-sm
                        text-white/70 hover:text-white transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Dropdown Menu */}
                {menuOpen === project.id && (
                  <div
                    ref={menuRef}
                    className="absolute top-12 right-3 z-[60] w-52 bg-gray-900 border border-white/10 
                      rounded-xl shadow-xl shadow-black/50 overflow-hidden"
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(project.id);
                      }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-white/5 flex items-center gap-3"
                    >
                      <FolderOpen className="w-4 h-4 text-gray-400" />
                      打开
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openCoverModal(project);
                      }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-white/5 flex items-center gap-3"
                    >
                      <ImageIcon className="w-4 h-4 text-gray-400" />
                      修改封面
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openSkillModal(project);
                      }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-white/5 flex items-center gap-3"
                    >
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      项目 Skill
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
            )}
          </>
        )}
      </main>

      {/* Update Cover Modal */}
      {coverModalOpen && selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-4">修改项目封面</h2>
            
            {/* Preview Area */}
            <div 
              className={`aspect-video rounded-xl bg-white/5 mb-4 overflow-hidden relative
                ${isDragging ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-gray-900' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {coverPreview ? (
                <img
                  src={
                    coverPreview.startsWith('data:') || coverPreview.startsWith('blob:')
                      ? coverPreview
                      : projectCoverDisplayUrl(coverPreview, selectedProject.updatedAt)
                  }
                  alt="预览"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-500">
                  <ImageIcon className="w-12 h-12 mb-2" />
                  <span className="text-sm">暂无封面</span>
                </div>
              )}
              
              {/* Hover overlay for change hint */}
              <div 
                className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="text-white text-sm font-medium">点击更换图片</span>
              </div>
            </div>

            {/* Upload Area */}
            <div 
              className={`border-2 border-dashed rounded-xl p-6 mb-4 text-center transition-colors
                ${isDragging 
                  ? 'border-brand-500 bg-brand-500/10' 
                  : 'border-white/20 hover:border-white/40 hover:bg-white/5'
                }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-sm text-gray-400">
                  拖放图片到这里，或{' '}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-brand-400 hover:text-brand-300 underline"
                  >
                    点击选择
                  </button>
                </p>
                <p className="text-xs text-gray-600">
                  支持 JPG、PNG、GIF 格式
                </p>
              </div>
            </div>

            {coverFile && (
              <p className="text-xs text-brand-400 mb-4 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                已选择: {coverFile.name}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setCoverModalOpen(false);
                  setCoverPreview(null);
                  setCoverFile(null);
                  setSelectedProject(null);
                }}
                className="flex-1 px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-colors"
              >
                取消
              </button>
              {coverPreview && (
                <button
                  onClick={() => {
                    setCoverPreview(null);
                    setCoverFile(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  清除封面
                </button>
              )}
              <button
                onClick={handleUpdateCover}
                className="flex-1 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {skillModalOpen && selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-white/10 rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                  项目 Skill
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  项目「{selectedProject.name}」· 启用后侧边栏 Chat 将自动按 Skill 回答；成员仅看到「已启用 · 标题」。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSkillModalOpen(false);
                  setSelectedProject(null);
                }}
                className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="flex items-center gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={skillEnabled}
                onChange={(e) => setSkillEnabled(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-200">启用项目 Skill</span>
            </label>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">标题（成员可见）</label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                  value={skillTitle}
                  onChange={(e) => setSkillTitle(e.target.value)}
                  placeholder="例如：30年经验导演"
                  maxLength={80}
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="text-xs text-gray-500">Skill 正文（Markdown，仅 API 注入，聊天中不可见）</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSkillContent(DIRECTOR_STORYBOARD_CORE_MD);
                        if (!skillTitle.trim()) setSkillTitle('AI导演分镜 · 核心版');
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
                    >
                      导入核心版模板
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSkillContent(DIRECTOR_STORYBOARD_ADVANCED_MD);
                        if (!skillTitle.trim()) setSkillTitle('AI导演分镜 · 进阶版');
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
                    >
                      导入进阶版模板
                    </button>
                  </div>
                </div>
                <textarea
                  className="w-full min-h-[280px] px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white font-mono leading-relaxed resize-y"
                  value={skillContent}
                  onChange={(e) => setSkillContent(e.target.value)}
                  placeholder="# Skill&#10;你是…"
                />
                <p className="text-[11px] text-gray-600 mt-1">
                  保存时不截断；过长时发送 API 仍会优先保留 Skill、裁剪较早的历史。成员需刷新或重新进入项目后生效。
                </p>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="text-xs text-gray-500">
                    输出格式补充（可选，仅 API 注入；留空则不追加）
                  </label>
                  <button
                    type="button"
                    onClick={() => setSkillOutputFormatHint(PROJECT_SKILL_OUTPUT_TABLE_HINT_EXAMPLE)}
                    className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
                  >
                    填入分镜表格示例
                  </button>
                </div>
                <textarea
                  className="w-full min-h-[96px] px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white font-mono leading-relaxed resize-y"
                  value={skillOutputFormatHint}
                  onChange={(e) => setSkillOutputFormatHint(e.target.value)}
                  placeholder="例如：须用 Markdown 管道表格输出，每镜头一行…"
                />
                <p className="text-[11px] text-gray-600 mt-1">
                  不同项目可填不同格式要求；翻译、问答类 Skill 可留空。
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setSkillModalOpen(false);
                  setSelectedProject(null);
                }}
                className="flex-1 px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={skillSaving}
                onClick={() => void handleSaveSkill()}
                className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {skillSaving ? '保存中…' : '保存 Skill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
