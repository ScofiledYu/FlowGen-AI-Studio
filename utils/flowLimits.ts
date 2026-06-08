/**
 * 画布极端数据防护：防止超大工程 / 超长数组导致 JSON 序列化 OOM 或主线程长时间阻塞。
 * 数值偏保守，正常单项目很难触及。
 */
export const FLOW_MAX_PERSISTED_NODES = 500;
export const FLOW_MAX_PERSISTED_EDGES = 4000;
/** 单节点「生成物缩略图」条数上限（再多只保留最近一批） */
export const FLOW_MAX_THUMBNAILS_PER_NODE = 48;
/** 撤销栈深度（每步为整图深拷贝，过大易 OOM） */
export const FLOW_MAX_UNDO_HISTORY = 28;
