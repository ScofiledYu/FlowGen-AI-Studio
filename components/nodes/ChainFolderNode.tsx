import React, { memo, useCallback } from 'react';
import { NodeProps } from 'reactflow';
import { ChevronRight, Folder } from 'lucide-react';
import { NodeData } from '../../types';

const ChainFolderNode = memo(({ id, data }: NodeProps<NodeData>) => {
  const childIds = data.chainFolderChildIds || [];
  const count = childIds.length;

  const expandAndUngroup = useCallback(() => {
    const rootId = data.chainFolderRootId;
    window.dispatchEvent(
      new CustomEvent('flowgen:expand-chain-folder', {
        detail: rootId ? { folderId: id, rootId } : { folderId: id },
      })
    );
  }, [id, data.chainFolderRootId]);

  return (
    <div className="w-[200px] rounded-lg border border-violet-500/35 bg-gray-950/95 shadow-lg backdrop-blur-sm px-2 py-1.5 flex items-center gap-2 select-none">
      <Folder className="w-3.5 h-3.5 text-violet-400 shrink-0" />
      <button
        type="button"
        className="nodrag flex flex-1 min-w-0 items-center gap-1.5 text-left rounded px-0.5 py-0.5 hover:bg-gray-800/80 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          expandAndUngroup();
        }}
        title="展开：下游节点排在根节点右侧（顺序不变），移除打组标识；同一排右侧的节点会整体右移让出空间"
      >
        <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-[10px] font-semibold text-gray-200 truncate">
          下游 ({count}) · 点击展开
        </span>
      </button>
    </div>
  );
});

ChainFolderNode.displayName = 'ChainFolderNode';

export default ChainFolderNode;
