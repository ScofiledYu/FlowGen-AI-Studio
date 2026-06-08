import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { NodeProps, NodeResizeControl, useReactFlow } from 'reactflow';
import { GripHorizontal } from 'lucide-react';
import type { NodeData } from '../../types';

const DEF_FILL = 'rgba(99, 102, 241, 0.08)';
const DEF_BORDER = 'rgba(99, 102, 241, 0.45)';

const cornerHandleClass =
  '!h-3 !w-3 !min-h-[12px] !min-w-[12px] !rounded-sm !border-2 !border-brand-400 !bg-gray-900 nodrag nopan';

function BackdropNode(props: NodeProps<NodeData>) {
  const { id, data, selected } = props;
  const { setNodes } = useReactFlow();
  const label = (data.backdropLabel || data.label || 'Backdrop').trim() || 'Backdrop';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(label);
  }, [label, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitLabel = useCallback(() => {
    const next = draft.trim() || 'Backdrop';
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, backdropLabel: next, label: next } } : n
      )
    );
    setEditing(false);
  }, [draft, id, setNodes]);

  return (
    <div
      className="backdrop-node relative h-full w-full min-h-[120px] min-w-[160px] rounded-lg"
      style={{
        backgroundColor: data.backdropFill || DEF_FILL,
        border: `2px solid ${data.backdropBorder || DEF_BORDER}`,
        boxSizing: 'border-box',
      }}
    >
      {selected && (
        <>
          <NodeResizeControl
            position="top-left"
            minWidth={160}
            minHeight={120}
            className={cornerHandleClass}
          />
          <NodeResizeControl
            position="top-right"
            minWidth={160}
            minHeight={120}
            className={cornerHandleClass}
          />
          <NodeResizeControl
            position="bottom-left"
            minWidth={160}
            minHeight={120}
            className={cornerHandleClass}
          />
          <NodeResizeControl
            position="bottom-right"
            minWidth={160}
            minHeight={120}
            className={cornerHandleClass}
          />
        </>
      )}
      <div
        className="absolute left-0 right-0 top-0 flex h-11 cursor-grab items-center justify-center rounded-t-md border-b border-brand-500/25 bg-gradient-to-b from-gray-950/95 to-gray-900/90 px-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:cursor-grabbing [font-family:system-ui,-apple-system,'Segoe_UI','PingFang_SC','Hiragino_Sans_GB','Microsoft_YaHei',sans-serif]"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <GripHorizontal
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400/55"
          aria-hidden
        />
        {editing ? (
          <input
            ref={inputRef}
            className="nodrag nopan mx-auto w-full max-w-[min(92%,20rem)] rounded-md border border-brand-500/40 bg-gray-950/90 px-2 py-1 text-center text-base font-medium leading-normal tracking-normal text-white antialiased shadow-[0_0_0_1px_rgba(99,102,241,0.35)] outline-none ring-2 ring-brand-500/30"
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
          />
        ) : (
          <span className="truncate text-base font-semibold leading-normal tracking-normal text-gray-100 antialiased drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(BackdropNode);
