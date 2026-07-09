/**
 * 与 20260618 参考版 MiniMap 外观/交互一致；
 * - viewBox 仅按可见节点 bounds 计算（不含 viewBB 并集），缩放后节点仍可见
 * - 纵向分镜工程自适应加高（200×150 ~ 200×360）
 * - 点击/点节点：主画布居中到该位置（保留当前 zoom）
 */
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import cc from 'classcat';
import { shallow } from 'zustand/shallow';
import { zoom, zoomIdentity } from 'd3-zoom';
import { select, pointer } from 'd3-selection';
import {
  useStore,
  getNodePositionWithOrigin,
  useStoreApi,
  Panel,
  getNodesBounds,
  type Node,
} from 'reactflow';
import {
  computeAdaptiveMiniMapSize,
  computeMiniMapViewBoxWithViewportCap,
  buildMiniMapMaskPath,
} from '../../utils/flowgenMiniMapLayout';

const ARIA_LABEL_KEY = 'react-flow__minimap-desc';

type MiniMapNodeProps = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: React.CSSProperties;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  className?: string;
  borderRadius?: number;
  shapeRendering?: 'crispEdges' | 'geometricPrecision' | 'auto';
  onClick?: (event: React.MouseEvent, id: string) => void;
  selected?: boolean;
};

const MiniMapNode = memo(function MiniMapNode({
  id,
  x,
  y,
  width,
  height,
  style,
  color,
  strokeColor,
  strokeWidth,
  className,
  borderRadius,
  shapeRendering,
  onClick,
  selected,
}: MiniMapNodeProps) {
  const { background, backgroundColor } = style || {};
  const fill = String(color || background || backgroundColor || '');
  return (
    <rect
      className={cc(['react-flow__minimap-node', { selected }, className])}
      x={x}
      y={y}
      rx={borderRadius}
      ry={borderRadius}
      width={width}
      height={height}
      fill={fill}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      shapeRendering={shapeRendering}
      onClick={onClick ? (event) => onClick(event, id) : undefined}
    />
  );
});

const getAttrFunction = <T,>(func: T | ((node: Node) => T)) =>
  func instanceof Function ? func : () => func;

type MiniMapNodesProps = {
  nodeStrokeColor?: string | ((node: Node) => string);
  nodeColor?: string | ((node: Node) => string);
  nodeClassName?: string | ((node: Node) => string);
  nodeBorderRadius?: number;
  nodeStrokeWidth?: number;
  nodeComponent?: React.ComponentType<MiniMapNodeProps>;
  onClick?: (event: React.MouseEvent, id: string) => void;
};

const MiniMapNodes = memo(function MiniMapNodes({
  nodeStrokeColor = 'transparent',
  nodeColor = '#e2e2e2',
  nodeClassName = '',
  nodeBorderRadius = 5,
  nodeStrokeWidth = 2,
  nodeComponent: NodeComponent = MiniMapNode,
  onClick,
}: MiniMapNodesProps) {
  const nodes = useStore(
    (s) => s.getNodes().filter((node) => !node.hidden && node.width && node.height),
    shallow,
  );
  const nodeOrigin = useStore((s) => s.nodeOrigin);
  const nodeColorFunc = getAttrFunction(nodeColor);
  const nodeStrokeColorFunc = getAttrFunction(nodeStrokeColor);
  const nodeClassNameFunc = getAttrFunction(nodeClassName);
  const shapeRendering =
    typeof window === 'undefined' || !!(window as Window & { chrome?: unknown }).chrome
      ? 'crispEdges'
      : 'geometricPrecision';

  return (
    <>
      {nodes.map((node) => {
        const { x, y } = getNodePositionWithOrigin(node, nodeOrigin).positionAbsolute;
        return (
          <NodeComponent
            key={node.id}
            x={x}
            y={y}
            width={node.width!}
            height={node.height!}
            style={node.style}
            selected={node.selected}
            className={nodeClassNameFunc(node)}
            color={nodeColorFunc(node)}
            borderRadius={nodeBorderRadius}
            strokeColor={nodeStrokeColorFunc(node)}
            strokeWidth={nodeStrokeWidth}
            shapeRendering={shapeRendering}
            onClick={onClick}
            id={node.id}
          />
        );
      })}
    </>
  );
});

const selector = (s: {
  getNodes: () => Node[];
  nodeOrigin: [number, number];
  transform: [number, number, number];
  width: number;
  height: number;
  rfId: string;
}) => {
  const nodes = s.getNodes().filter((node) => !node.hidden && node.width && node.height);
  const viewBB = {
    x: -s.transform[0] / s.transform[2],
    y: -s.transform[1] / s.transform[2],
    width: s.width / s.transform[2],
    height: s.height / s.transform[2],
  };
  const boundingRect =
    nodes.length > 0 ? getNodesBounds(nodes, s.nodeOrigin) : viewBB;
  // 返回 viewBB / boundingRect 的原始值，确保 shallow 比较能检测到缩放/平移变化
  // （否则嵌套对象引用每次都不同，ReactFlow 内部可能跳过更新）
  return {
    viewBB,
    boundingRect,
    rfId: s.rfId,
    // 原始值触发 shallow 精确比较
    tx: s.transform[0],
    ty: s.transform[1],
    tz: s.transform[2],
    vw: s.width,
    vh: s.height,
  };
};

export type FlowgenMiniMapProps = {
  style?: React.CSSProperties;
  className?: string;
  nodeStrokeColor?: string | ((node: Node) => string);
  nodeColor?: string | ((node: Node) => string);
  nodeClassName?: string | ((node: Node) => string);
  nodeBorderRadius?: number;
  nodeStrokeWidth?: number;
  nodeComponent?: React.ComponentType<MiniMapNodeProps>;
  maskColor?: string;
  maskStrokeColor?: string;
  maskStrokeWidth?: number;
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  onClick?: (event: React.MouseEvent, position: { x: number; y: number }) => void;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  pannable?: boolean;
  zoomable?: boolean;
  ariaLabel?: string;
  inversePan?: boolean;
  zoomStep?: number;
  offsetScale?: number;
};

function FlowgenMiniMapInner({
  style,
  className,
  nodeStrokeColor = 'transparent',
  nodeColor = '#e2e2e2',
  nodeClassName = '',
  nodeBorderRadius = 5,
  nodeStrokeWidth = 2,
  nodeComponent,
  maskColor = 'rgb(240, 240, 240, 0.6)',
  maskStrokeColor = 'none',
  maskStrokeWidth = 1,
  position = 'bottom-right',
  onClick,
  onNodeClick,
  pannable = false,
  zoomable = false,
  ariaLabel = 'FlowGen mini map',
  inversePan = false,
  zoomStep = 10,
  offsetScale = 5,
}: FlowgenMiniMapProps) {
  const store = useStoreApi();
  const svg = useRef<SVGSVGElement>(null);
  const { boundingRect, viewBB, rfId } = useStore(selector, shallow);
  const nodeOrigin = useStore((s) => s.nodeOrigin);

  const elementSize = useMemo(
    () => computeAdaptiveMiniMapSize(boundingRect),
    [boundingRect.height, boundingRect.width, boundingRect.x, boundingRect.y],
  );
  const elementWidth = Number(style?.width ?? elementSize.width);
  const elementHeight = Number(style?.height ?? elementSize.height);
  // viewBox 取节点 bounds 与当前视口的并集（上限 2x 节点 bounds），缩放/平移后视口指示框始终可见
  const { x, y, width, height, viewScale } = useMemo(
    () => computeMiniMapViewBoxWithViewportCap(
      boundingRect,
      viewBB,
      elementWidth,
      elementHeight,
      offsetScale,
    ),
    [boundingRect, viewBB, elementWidth, elementHeight, offsetScale],
  );
  const maskPathD = useMemo(
    () => buildMiniMapMaskPath({ x, y, width, height }, viewBB, offsetScale, viewScale),
    [x, y, width, height, viewBB, offsetScale, viewScale],
  );

  const labelledBy = `${ARIA_LABEL_KEY}-${rfId}`;
  const viewScaleRef = useRef(0);
  viewScaleRef.current = viewScale;

  const centerViewportAt = useCallback(
    (flowX: number, flowY: number) => {
      const { width: cw, height: ch, transform, d3Zoom, d3Selection } = store.getState();
      if (!d3Zoom || !d3Selection) return;
      const zoomLevel = transform[2];
      const nextX = cw / 2 - flowX * zoomLevel;
      const nextY = ch / 2 - flowY * zoomLevel;
      d3Zoom.transform(d3Selection, zoomIdentity.translate(nextX, nextY).scale(zoomLevel));
    },
    [store],
  );

  useEffect(() => {
    if (!svg.current) return;
    const selection = select(svg.current);
    const zoomHandler = (event: any) => {
      const { transform, d3Selection, d3Zoom } = store.getState();
      if (event.sourceEvent.type !== 'wheel' || !d3Selection || !d3Zoom) return;
      const pinchDelta =
        -event.sourceEvent.deltaY *
        (event.sourceEvent.deltaMode === 1 ? 0.05 : event.sourceEvent.deltaMode ? 1 : 0.002) *
        zoomStep;
      const nextZoom = transform[2] * Math.pow(2, pinchDelta);
      d3Zoom.scaleTo(d3Selection, nextZoom);
    };
    const panHandler = (event: any) => {
      const { transform, d3Selection, d3Zoom, translateExtent, width: cw, height: ch } =
        store.getState();
      if (event.sourceEvent.type !== 'mousemove' || !d3Selection || !d3Zoom) return;
      const moveScale = viewScaleRef.current * Math.max(1, transform[2]) * (inversePan ? -1 : 1);
      const nextPosition = {
        x: transform[0] - event.sourceEvent.movementX * moveScale,
        y: transform[1] - event.sourceEvent.movementY * moveScale,
      };
      const extent: [[number, number], [number, number]] = [
        [0, 0],
        [cw, ch],
      ];
      const nextTransform = zoomIdentity.translate(nextPosition.x, nextPosition.y).scale(transform[2]);
      const constrainedTransform = d3Zoom.constrain()(nextTransform, extent, translateExtent);
      d3Zoom.transform(d3Selection, constrainedTransform);
    };
    const zoomAndPanHandler = zoom()
      .on('zoom', pannable ? panHandler : null)
      .on('zoom.wheel', zoomable ? zoomHandler : null);
    selection.call(zoomAndPanHandler as any);
    return () => {
      selection.on('zoom', null);
    };
  }, [pannable, zoomable, inversePan, zoomStep, store]);

  const onSvgClick = (event: React.MouseEvent) => {
    const rfCoord = pointer(event.nativeEvent, svg.current);
    centerViewportAt(rfCoord[0], rfCoord[1]);
    onClick?.(event, { x: rfCoord[0], y: rfCoord[1] });
  };

  const onSvgNodeClick = (event: React.MouseEvent, nodeId: string) => {
    const node = store.getState().nodeInternals.get(nodeId);
    if (!node) return;
    const { x: nx, y: ny } = getNodePositionWithOrigin(node, nodeOrigin).positionAbsolute;
    const cx = nx + (node.width ?? 0) / 2;
    const cy = ny + (node.height ?? 0) / 2;
    centerViewportAt(cx, cy);
    onNodeClick?.(event, node);
  };

  const panelStyle: React.CSSProperties = {
    width: elementWidth,
    height: elementHeight,
    ...style,
  };

  return (
    <Panel
      position={position}
      style={panelStyle}
      className={cc(['react-flow__minimap', className])}
      data-testid="rf__minimap"
    >
      <svg
        width={elementWidth}
        height={elementHeight}
        viewBox={`${x} ${y} ${width} ${height}`}
        role="img"
        aria-labelledby={labelledBy}
        ref={svg}
        onClick={onSvgClick}
      >
        {ariaLabel ? <title id={labelledBy}>{ariaLabel}</title> : null}
        <MiniMapNodes
          onClick={onSvgNodeClick}
          nodeColor={nodeColor}
          nodeStrokeColor={nodeStrokeColor}
          nodeBorderRadius={nodeBorderRadius}
          nodeClassName={nodeClassName}
          nodeStrokeWidth={nodeStrokeWidth}
          nodeComponent={nodeComponent}
        />
        <path
          className="react-flow__minimap-mask"
          d={maskPathD}
          fill={maskColor}
          fillRule="evenodd"
          stroke={maskStrokeColor}
          strokeWidth={maskStrokeWidth}
          pointerEvents="none"
        />
      </svg>
    </Panel>
  );
}

export const FlowgenMiniMap = memo(FlowgenMiniMapInner);
