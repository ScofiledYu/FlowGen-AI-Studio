/** 聊天 localStorage / 服务端记录按「用户 + 项目」隔离 */

export type ChatStorageScope = {
  userId: string;
  projectId?: string | null;
};

function sanitizeSegment(raw: string): string {
  const s = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);
  return s || 'anonymous';
}

export function resolveChatStorageScope(
  userId?: string | null,
  projectId?: string | null
): ChatStorageScope {
  return {
    userId: sanitizeSegment(userId || 'local'),
    projectId: projectId ? sanitizeSegment(projectId) : null,
  };
}

/** 侧栏当前对话（canvas session） */
export function chatCanvasSessionStorageKey(scope: ChatStorageScope): string {
  const p = scope.projectId ? sanitizeSegment(scope.projectId) : '_local';
  return `flowgen:chat:canvas-session:${sanitizeSegment(scope.userId)}:${p}`;
}

/** 「聊天历史」会话列表 */
export function chatSessionsListStorageKey(scope: ChatStorageScope): string {
  const p = scope.projectId ? sanitizeSegment(scope.projectId) : '_local';
  return `flowgen:chat:sessions:${sanitizeSegment(scope.userId)}:${p}`;
}

/** Qwen 等本地备份映射 */
export function chatLocalHistoryStorageKey(scope: ChatStorageScope): string {
  const p = scope.projectId ? sanitizeSegment(scope.projectId) : '_local';
  return `flowgen:chat:local-history:${sanitizeSegment(scope.userId)}:${p}`;
}

/** 画布工程本地快照（节点/连线/分镜） */
export function projectWorkspaceDataStorageKey(scope: ChatStorageScope): string {
  const p = scope.projectId ? sanitizeSegment(scope.projectId) : '_local';
  return `flowgen-project-data:${sanitizeSegment(scope.userId)}:${p}`;
}

export function projectWorkspaceBackupStorageKey(scope: ChatStorageScope): string {
  const p = scope.projectId ? sanitizeSegment(scope.projectId) : '_local';
  return `flowgen-project-data-backup:${sanitizeSegment(scope.userId)}:${p}`;
}

export function projectViewportStorageKey(scope: ChatStorageScope): string {
  const p = scope.projectId ? sanitizeSegment(scope.projectId) : '_local';
  return `flowgen-last-viewport:${sanitizeSegment(scope.userId)}:${p}`;
}

/** 升级前仅按项目隔离的 localStorage key（用于一次性读取） */
export function legacyProjectWorkspaceDataStorageKey(projectId: string): string {
  return `flowgen-project-data:${sanitizeSegment(projectId)}`;
}

export function legacyProjectViewportStorageKey(projectId: string): string {
  return `flowgen-last-viewport:${sanitizeSegment(projectId)}`;
}
