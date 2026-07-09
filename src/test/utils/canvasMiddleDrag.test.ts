import { describe, expect, it } from 'vitest';
import type { Node as RFNode } from 'reactflow';
import { NodeType } from '../../../types';
import {
  buildCanvasMiddleDragStartPayload,
  isAltMiddlePanGesture,
  listCanvasMiddleDragNodes,
  resolveCanvasNodeMiddleDragUrl,
  resolveMiddleDragNodeHit,
} from '../../../utils/canvasMiddleDrag';
import { setFlowgenInspectorAnchorId } from '../../../utils/inspectorAnchorSession';

const node = (
  id: string,
  data: Record<string, unknown>,
  selected = false
): RFNode =>
  ({
    id,
    type: NodeType.INPUT,
    position: { x: 0, y: 0 },
    selected,
    data,
  }) as RFNode;

describe('canvasMiddleDrag', () => {
  it('uses imagePreview when present', () => {
    const url = resolveCanvasNodeMiddleDragUrl({
      imagePreview: 'https://cdn.example/a.png',
    });
    expect(url).toBe('https://cdn.example/a.png');
  });

  it('bundles all selected nodes with previews on multi middle drag', () => {
    const all = [
      node('a', { imagePreview: 'https://cdn.example/a.png' }, true),
      node('b', { imagePreview: 'https://cdn.example/b.png' }, true),
      node('c', { imagePreview: 'https://cdn.example/c.png' }, false),
    ];
    expect(listCanvasMiddleDragNodes(all)).toHaveLength(2);
    const payload = buildCanvasMiddleDragStartPayload({
      allNodes: all,
      sourceNodeId: 'b',
      sourceData: all[1].data as Record<string, unknown>,
    });
    expect(payload?.sourceNodeId).toBe('canvas:multi');
    expect(payload?.assets).toHaveLength(2);
    expect(payload?.assets?.map((a) => a.assetId)).toEqual(['a', 'b']);
  });

  it('single selected node uses node id as source', () => {
    const all = [node('b', { imagePreview: 'https://cdn.example/b.png' }, true)];
    const payload = buildCanvasMiddleDragStartPayload({
      allNodes: all,
      sourceNodeId: 'b',
      sourceData: all[0].data as Record<string, unknown>,
    });
    expect(payload?.sourceNodeId).toBe('b');
    expect(payload?.assets).toBeUndefined();
  });

  it('does not bundle inspector anchor when dragging unselected source node', () => {
    const all = [
      node('anchor', { imagePreview: 'https://cdn.example/main.png' }, true),
      node('src', { imagePreview: 'https://cdn.example/other.png' }, false),
    ];
    const payload = buildCanvasMiddleDragStartPayload({
      allNodes: all,
      sourceNodeId: 'src',
      sourceData: all[1].data as Record<string, unknown>,
    });
    expect(payload?.sourceNodeId).toBe('src');
    expect(payload?.url).toBe('https://cdn.example/other.png');
    expect(payload?.assets).toBeUndefined();
  });

  it('prefers imagePreview over selection hero URL for drag payload', () => {
    const url = resolveCanvasNodeMiddleDragUrl({
      imagePreview: 'https://cdn.example/direct.png',
      referenceImages: ['https://cdn.example/ref.png'],
    });
    expect(url).toBe('https://cdn.example/direct.png');
  });

  it('falls back to generatedThumbnails when imagePreview was stripped on persist', () => {
    const url = resolveCanvasNodeMiddleDragUrl(
      {
        generatedThumbnails: [{ id: 't1', type: 'image', url: 'https://cdn.example/thumb.png' }],
      },
      NodeType.PROCESSOR
    );
    expect(url).toBe('https://cdn.example/thumb.png');
  });

  it('excludes inspector anchor from shift multi bundle', () => {
    const all = [
      node('anchor', { imagePreview: 'https://cdn.example/main.png' }, true),
      node('b', { imagePreview: 'https://cdn.example/b.png' }, true),
      node('c', { imagePreview: 'https://cdn.example/c.png' }, true),
    ];
    const payload = buildCanvasMiddleDragStartPayload({
      allNodes: all,
      sourceNodeId: 'b',
      sourceData: all[1].data as Record<string, unknown>,
      inspectorAnchorId: 'anchor',
    });
    expect(payload?.sourceNodeId).toBe('canvas:multi');
    expect(payload?.assets?.map((a) => a.assetId)).toEqual(['b', 'c']);
  });

  it('falls back to single source when anchor filter clears multi payloads', () => {
    const all = [
      node('anchor', { imagePreview: 'https://cdn.example/main.png' }, true),
      node('b', { imagePreview: 'https://cdn.example/b.png' }, true),
    ];
    const payload = buildCanvasMiddleDragStartPayload({
      allNodes: all,
      sourceNodeId: 'b',
      sourceData: all[1].data as Record<string, unknown>,
      inspectorAnchorId: 'anchor',
    });
    expect(payload?.sourceNodeId).toBe('b');
    expect(payload?.url).toBe('https://cdn.example/b.png');
    expect(payload?.assets).toBeUndefined();
  });

  it('bundles shift selection even when source selected flag lags in store', () => {
    const all = [
      node('anchor', { imagePreview: 'https://cdn.example/main.png' }, true),
      node('b', { imagePreview: 'https://cdn.example/b.png' }, true),
      node('c', { imagePreview: 'https://cdn.example/c.png' }, true),
    ];
    const payload = buildCanvasMiddleDragStartPayload({
      allNodes: all,
      sourceNodeId: 'b',
      sourceData: all[1].data as Record<string, unknown>,
      inspectorAnchorId: 'anchor',
    });
    expect(payload?.sourceNodeId).toBe('canvas:multi');
    expect(payload?.assets?.map((a) => a.assetId)).toEqual(['b', 'c']);
  });

  it('bundles when dragging unselected source while two other nodes are selected', () => {
    const all = [
      node('b', { imagePreview: 'https://cdn.example/b.png' }, true),
      node('c', { imagePreview: 'https://cdn.example/c.png' }, true),
      node('src', { imagePreview: 'https://cdn.example/src.png' }, false),
    ];
    const payload = buildCanvasMiddleDragStartPayload({
      allNodes: all,
      sourceNodeId: 'src',
      sourceData: all[2].data as Record<string, unknown>,
    });
    expect(payload?.sourceNodeId).toBe('canvas:multi');
    expect(payload?.assets?.map((a) => a.assetId)).toEqual(['b', 'c', 'src']);
  });

  it('resolveMiddleDragNodeHit uses selection fallback on pane middle-click', () => {
    setFlowgenInspectorAnchorId('anchor');
    document.body.innerHTML = `
      <div class="react-flow">
        <div class="react-flow__pane" id="pane"></div>
        <div class="react-flow__node" data-id="anchor">
          <div data-flowgen-node-id="anchor"></div>
        </div>
        <div class="react-flow__node" data-id="src">
          <div data-flowgen-node-id="src"></div>
        </div>
      </div>
    `;
    const pane = document.getElementById('pane')!;
    const srcEl = document.querySelector('.react-flow__node[data-id="src"]')!;
    srcEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const all = [
      node('anchor', { imagePreview: 'https://cdn.example/main.png' }, true),
      node('src', { imagePreview: 'https://cdn.example/src.png' }, true),
    ];
    const hit = resolveMiddleDragNodeHit(all, 50, 50, pane);
    expect(hit?.nodeId).toBe('src');
    expect(hit?.via).toBe('selection-fallback');
    setFlowgenInspectorAnchorId(null);
    document.body.innerHTML = '';
  });

  it('isAltMiddlePanGesture detects Alt+middle', () => {
    expect(isAltMiddlePanGesture({ altKey: true, getModifierState: () => false })).toBe(true);
    expect(isAltMiddlePanGesture({ altKey: false, getModifierState: (k) => k === 'Alt' })).toBe(
      true
    );
    expect(isAltMiddlePanGesture({ altKey: false, getModifierState: () => false })).toBe(false);
  });
});
