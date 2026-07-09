/** 中键拖素材调试：控制台 + window.__FG_MIDDLE_DRAG_LOG（可复制给 agent） */

export const MIDDLE_DRAG_DEBUG_TAG = '[flowgen:middle-drag]';

export type MiddleDragDebugEntry = {
  t: number;
  step: string;
  [key: string]: unknown;
};

declare global {
  interface Window {
    __FG_MIDDLE_DRAG_LOG?: MiddleDragDebugEntry[];
    __FG_MIDDLE_DRAG_LAST_HINT?: string;
    /** 设为 true 时向控制台输出中键拖拽调试日志（默认关闭，与生产一致） */
    __FG_MIDDLE_DRAG_DEBUG?: boolean;
  }
}

function isMiddleDragConsoleDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.__FG_MIDDLE_DRAG_DEBUG === true;
}

export function logMiddleDrag(step: string, detail?: Record<string, unknown>): void {
  const entry: MiddleDragDebugEntry = { t: Date.now(), step, ...(detail || {}) };
  if (typeof console !== 'undefined' && isMiddleDragConsoleDebugEnabled()) {
    if (detail && Object.keys(detail).length > 0) {
      console.log(MIDDLE_DRAG_DEBUG_TAG, step, detail);
    } else {
      console.log(MIDDLE_DRAG_DEBUG_TAG, step);
    }
  }
  if (typeof window !== 'undefined') {
    const log = window.__FG_MIDDLE_DRAG_LOG || (window.__FG_MIDDLE_DRAG_LOG = []);
    log.push(entry);
    if (log.length > 300) log.splice(0, log.length - 300);
  }
}

export function showMiddleDragHint(message: string): void {
  logMiddleDrag('hint', { message });
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.__FG_MIDDLE_DRAG_LAST_HINT = message;
  const existing = document.getElementById('flowgen-middle-drag-hint');
  existing?.remove();
  const el = document.createElement('div');
  el.id = 'flowgen-middle-drag-hint';
  el.textContent = message;
  el.className =
    'fixed bottom-6 left-1/2 z-[99999] -translate-x-1/2 max-w-[min(92vw,520px)] rounded-lg border border-amber-500/40 bg-gray-900/95 px-4 py-2 text-xs text-amber-100 shadow-xl pointer-events-none';
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 2600);
}

export function summarizeMiddleDragUrl(url: string | undefined | null): string {
  const s = String(url || '').trim();
  if (!s) return '';
  if (s.length <= 96) return s;
  return `${s.slice(0, 48)}…${s.slice(-40)}`;
}

let debugProbeInstalled = false;

/** 页面加载后写入 boot 日志，并监听节点上的中键（便于区分「没点到」vs「逻辑未触发」） */
export function installMiddleDragDebugProbe(): void {
  if (typeof window === 'undefined' || debugProbeInstalled) return;
  debugProbeInstalled = true;
  window.__FG_MIDDLE_DRAG_LOG = window.__FG_MIDDLE_DRAG_LOG || [];
  logMiddleDrag('debug:boot', { build: 'middle-drag-probe-20260702' });
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 1) return;
      const node = (e.target as Element | null)?.closest('.react-flow__node');
      if (!node) return;
      logMiddleDrag('probe:middle-mousedown-on-node', {
        nodeId: node.getAttribute('data-id'),
        tag: (e.target as Element | null)?.tagName || '',
        className: String((e.target as Element | null)?.className || '').slice(0, 80),
      });
    },
    true
  );
}
