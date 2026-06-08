import {
  BezierEdge,
  SimpleBezierEdge,
  SmoothStepEdge,
  StepEdge,
  StraightEdge,
} from 'reactflow';
import { NodeType } from '../types';
import CustomNode from './nodes/CustomNode';
import ChainFolderNode from './nodes/ChainFolderNode';
import BackdropNode from './nodes/BackdropNode';

/**
 * 与 React Flow 默认 edgeTypes 一致，但为模块级单例，避免每次渲染新对象触发 dev #002 警告。
 */
export const flowEditorEdgeTypes = Object.freeze({
  default: BezierEdge,
  straight: StraightEdge,
  step: StepEdge,
  smoothstep: SmoothStepEdge,
  simplebezier: SimpleBezierEdge,
});

/**
 * 自定义节点类型映射；放在独立文件保证引用稳定（配合 edgeTypes 一并传入 ReactFlow）。
 */
export const flowEditorNodeTypes = Object.freeze({
  [NodeType.INPUT]: CustomNode,
  [NodeType.PROCESSOR]: CustomNode,
  [NodeType.OUTPUT]: CustomNode,
  [NodeType.MOV]: CustomNode,
  [NodeType.CHAIN_FOLDER]: ChainFolderNode,
  [NodeType.BACKDROP]: BackdropNode,
});

export const flowEditorProOptions = Object.freeze({ hideAttribution: true as const });
