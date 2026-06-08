import type { Node as RFNode } from 'reactflow';
import { NodeType, type NodeData } from '../types';

/** 画布工厂默认标题：不作为输出节点继承名 */
export const FACTORY_NODE_LABELS = new Set([
  'input picture node',
  'output mov node',
  'output picture node',
]);

export function upstreamDisplayNameForOutputNaming(upstream: Partial<NodeData>): string {
  const custom = upstream.customName?.trim();
  if (custom) return custom;
  const label = upstream.label?.trim() || '';
  if (label && !FACTORY_NODE_LABELS.has(label.toLowerCase())) return label;
  return '';
}

/** 生成 OUTPUT/MOV 节点：label / imageName 继承上游自定义名或非工厂 label */
export function resolveOutputNodeNamingFromUpstream(
  upstream: Partial<NodeData>,
  opts: { isVideo: boolean; index: number; count: number }
): Pick<NodeData, 'label' | 'imageName'> & { customName?: string } {
  const display = upstreamDisplayNameForOutputNaming(upstream);
  const suffix = opts.count > 1 ? `_${opts.index + 1}` : '';
  if (display) {
    const stem = `${display}${suffix}`;
    const safeFile = stem.replace(/[\\/:*?"<>|]/g, '_');
    const ext = opts.isVideo ? '.mov' : '.png';
    const hadCustom = !!upstream.customName?.trim();
    return {
      label: stem,
      ...(hadCustom ? { customName: stem } : {}),
      imageName: `${safeFile}${ext}`,
    };
  }
  if (opts.isVideo) {
    return {
      label: 'Output Mov Node',
      imageName: `Video_${Math.floor(Math.random() * 1000)}.mov`,
    };
  }
  return {
    label: 'Output Picture Node',
    imageName: `Generated_${Math.floor(Math.random() * 1000)}.png`,
  };
}

/** 历史工程：MOV/OUTPUT 误继承 Input Picture Node 时纠正显示名与文件名 */
export function fixMisnamedOutputNodesOnGraph(nodes: RFNode[]): RFNode[] {
  let changed = false;
  const next = nodes.map((n) => {
    if (n.type !== NodeType.MOV && n.type !== NodeType.OUTPUT) return n;
    const data = n.data || {};
    if (data.customName?.trim()) return n;
    const label = (data.label || '').trim();
    if (label.toLowerCase() !== 'input picture node') return n;

    const isVideo = n.type === NodeType.MOV;
    const newLabel = isVideo ? 'Output Mov Node' : 'Output Picture Node';
    const imageName = (data.imageName || '').trim();
    const fixImageName =
      !imageName ||
      /^input picture node/i.test(imageName.replace(/\.(mov|png)$/i, ''));
    changed = true;
    return {
      ...n,
      data: {
        ...data,
        label: newLabel,
        ...(fixImageName
          ? {
              imageName: isVideo
                ? `Video_${Math.floor(Math.random() * 1000)}.mov`
                : `Generated_${Math.floor(Math.random() * 1000)}.png`,
            }
          : {}),
      },
    };
  });
  return changed ? next : nodes;
}
