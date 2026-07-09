import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeProps, NodeResizeControl, useReactFlow, useStore } from 'reactflow';
import { GripHorizontal } from 'lucide-react';
import type { NodeData } from '../../types';
import {
  backdropFlowSizeChanged,
  getBackdropFlowSizeFromNode,
  nextBackdropLabelEditBlockUntil,
  resolveBackdropLabelPresentation,
  shouldBlockBackdropLabelEdit,
} from '../../utils/backdropLabel';
import {
  CANVAS_VIEWPORT_MOVING_EVENT,
  getCanvasViewportMoving,
} from '../../utils/canvasRefreshPause';

const DEF_FILL = 'rgba(99, 102, 241, 0.08)';
const DEF_BORDER = 'rgba(99, 102, 241, 0.45)';
/** 背景框始终压在普通节点下方，避免选中时盖住子节点导致无法框选/点击 */
export const BACKDROP_FLOW_Z_INDEX = -1;

const cornerHandleClass =
  '!h-3 !w-3 !min-h-[12px] !min-w-[12px] !rounded-sm !border-2 !border-brand-400 !bg-gray-900 nodrag nopan';

function estimateTextFlowWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch) ? fontSize : fontSize * 0.55;
  }
  return w;
}

function BackdropNode(props: NodeProps<NodeData>) {
  const { id, data, selected } = props;
  const { setNodes } = useReactFlow();
  const zoom = useStore((s) => s.transform[2] || 1);
  const flowSize = useStore(
    useCallback((s) => getBackdropFlowSizeFromNode(s.nodeInternals.get(id)), [id])
  );
  const label = (data.backdropLabel || data.label || 'Backdrop').trim() || 'Backdrop';
  const isCustomName = label !== 'Backdrop';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [viewportMoving, setViewportMoving] = useState(() => getCanvasViewportMoving());
  const [resizing, setResizing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renamePendingHandledRef = useRef(false);
  const blockEditUntilRef = useRef(0);
  const prevFlowSizeRef = useRef(flowSize);
  const flowSizeInitializedRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(label);
  }, [label, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const blockEditInteraction = useCallback((kind: 'afterWheelOrViewport' | 'afterResize') => {
    blockEditUntilRef.current = nextBackdropLabelEditBlockUntil(Date.now(), kind);
    setEditing(false);
  }, []);

  const blockEditRef = useRef(blockEditInteraction);
  blockEditRef.current = blockEditInteraction;

  const handleResizeStart = useCallback(() => {
    setResizing(true);
    blockEditRef.current('afterResize');
  }, []);

  const handleResizeEnd = useCallback(() => {
    setResizing(false);
    blockEditRef.current('afterResize');
  }, []);

  useEffect(() => {
    const markBlocked = () => {
      blockEditRef.current('afterWheelOrViewport');
    };
    window.addEventListener('wheel', markBlocked, { passive: true, capture: true });
    return () => window.removeEventListener('wheel', markBlocked, { capture: true });
  }, []);

  useEffect(() => {
    const onViewportMoving = (e: Event) => {
      const active = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
      setViewportMoving(active);
      blockEditRef.current('afterWheelOrViewport');
    };
    window.addEventListener(CANVAS_VIEWPORT_MOVING_EVENT, onViewportMoving);
    return () => window.removeEventListener(CANVAS_VIEWPORT_MOVING_EVENT, onViewportMoving);
  }, []);

  useEffect(() => {
    if (!flowSizeInitializedRef.current) {
      flowSizeInitializedRef.current = true;
      prevFlowSizeRef.current = flowSize;
      return;
    }
    if (backdropFlowSizeChanged(prevFlowSizeRef.current, flowSize)) {
      blockEditRef.current('afterResize');
    }
    prevFlowSizeRef.current = flowSize;
  }, [flowSize.w, flowSize.h]);

  useEffect(() => {
    if (!data.backdropRenamePending || renamePendingHandledRef.current) return;
    renamePendingHandledRef.current = true;
    setEditing(true);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, backdropRenamePending: undefined } }
          : n
      )
    );
  }, [data.backdropRenamePending, id, setNodes]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const curZ = typeof n.style?.zIndex === 'number' ? n.style.zIndex : undefined;
        if (curZ === BACKDROP_FLOW_Z_INDEX) return n;
        return { ...n, style: { ...n.style, zIndex: BACKDROP_FLOW_Z_INDEX } };
      })
    );
  }, [id, setNodes]);

  const commitLabel = useCallback(() => {
    const next = draft.trim() || 'Backdrop';
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, backdropLabel: next, label: next } } : n
      )
    );
    setEditing(false);
  }, [draft, id, setNodes]);

  const tryEnterEdit = useCallback(() => {
    if (
      shouldBlockBackdropLabelEdit({
        now: Date.now(),
        blockUntil: blockEditUntilRef.current,
        viewportMoving: viewportMoving || getCanvasViewportMoving(),
      })
    ) {
      return;
    }
    if (resizing) return;
    setEditing(true);
  }, [viewportMoving, resizing]);

  const flowW = flowSize.w;
  const displayText = isCustomName ? label : '双击命名背景框';
  const labelUi = resolveBackdropLabelPresentation(isCustomName, zoom);
  const labelTransform = `translate(-50%, calc(-100% - ${labelUi.gapFlowPx}px)) scale(${labelUi.invZoom})`;
  const labelInteractive = !viewportMoving && !editing && !resizing;

  const labelStyle = {
    fontSize: labelUi.fontPx,
    lineHeight: 1,
    color: isCustomName ? '#fcd34d' : '#67e8f9',
    textShadow: isCustomName
      ? '0 0 28px rgba(251,191,36,0.65), 0 2px 16px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)'
      : '0 0 20px rgba(103,232,249,0.45), 0 2px 12px rgba(0,0,0,0.85)',
  } as const;

  const resizeControlProps = {
    minWidth: 160,
    minHeight: 120,
    className: cornerHandleClass,
    onResizeStart: handleResizeStart,
    onResizeEnd: handleResizeEnd,
  } as const;

  return (
    <div
      className="backdrop-node pointer-events-none relative h-full w-full min-h-[120px] min-w-[160px] overflow-visible rounded-lg"
      style={{
        backgroundColor: data.backdropFill || DEF_FILL,
        border: `2px solid ${data.backdropBorder || DEF_BORDER}`,
        boxSizing: 'border-box',
      }}
    >
      {selected && (
        <>
          <NodeResizeControl position="top-left" {...resizeControlProps} />
          <NodeResizeControl position="top-right" {...resizeControlProps} />
          <NodeResizeControl position="bottom-left" {...resizeControlProps} />
          <NodeResizeControl position="bottom-right" {...resizeControlProps} />
        </>
      )}

      <div className="pointer-events-auto absolute left-0 right-0 top-0 z-10 flex h-8 cursor-grab items-center justify-center rounded-t-md border-b border-brand-500/20 bg-gray-950/40 active:cursor-grabbing">
        <GripHorizontal className="h-4 w-4 text-brand-400/45" aria-hidden />
      </div>

      <div
        className={`absolute left-1/2 top-0 z-30 nodrag nopan ${labelInteractive ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{ transform: labelTransform, transformOrigin: 'center bottom' }}
        aria-hidden={editing}
      >
        <div className="whitespace-nowrap rounded-lg bg-gray-950/90 px-3 py-1.5 shadow-lg ring-1 ring-amber-400/25">
          {editing ? (
            <input
              ref={inputRef}
              className="min-w-[8rem] rounded-md border border-amber-400/80 bg-gray-950 px-3 py-1.5 text-center font-extrabold leading-none tracking-wide whitespace-nowrap outline-none ring-1 ring-amber-500/30"
              style={{
                fontSize: labelUi.fontPx,
                lineHeight: 1,
                color: '#fde68a',
                caretColor: '#fde68a',
                WebkitTextFillColor: '#fde68a',
                width: `${Math.max(8, estimateTextFlowWidth(draft || '名称', labelUi.fontPx) + 24)}px`,
                maxWidth: `${flowW * labelUi.invZoom}px`,
              }}
              placeholder="输入背景框名称"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLabel();
                if (e.key === 'Escape') {
                  setDraft(label);
                  setEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              role="button"
              tabIndex={-1}
              title={isCustomName ? label : '双击重命名背景框'}
              className="inline-block select-none whitespace-nowrap text-center font-extrabold leading-none tracking-wide"
              style={labelStyle}
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                tryEnterEdit();
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {displayText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default BackdropNode;
