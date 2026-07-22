import { describe, expect, it } from 'vitest';
import {
  buildAssetItemsFromMediaDrop,
  isAssetLibraryMediaDragSource,
  isCanvasNodeMediaDragSource,
  resolveMediaDropZoneAtPoint,
  shouldCreateCanvasNodesFromMediaDrop,
  type FlowgenMediaUrlDropDetail,
} from '../../../utils/middleButtonMediaDrag';

describe('resolveMediaDropZoneAtPoint', () => {
  it('classifies asset vs canvas drag sources', () => {
    expect(isAssetLibraryMediaDragSource('asset:abc')).toBe(true);
    expect(isAssetLibraryMediaDragSource('asset:multi')).toBe(true);
    expect(isCanvasNodeMediaDragSource('node_1')).toBe(true);
    expect(isCanvasNodeMediaDragSource('canvas:multi')).toBe(true);
    expect(isCanvasNodeMediaDragSource('asset:abc')).toBe(false);
  });

  it('asset library middle-drop on canvas-pane should create nodes; canvas source should not', () => {
    expect(
      shouldCreateCanvasNodesFromMediaDrop({
        dropZone: 'canvas-pane',
        sourceNodeId: 'asset:abc',
        clientX: 100,
        clientY: 200,
      })
    ).toBe(true);
    expect(
      shouldCreateCanvasNodesFromMediaDrop({
        dropZone: 'canvas-pane',
        sourceNodeId: 'asset:multi',
        clientX: 10,
        clientY: 20,
      })
    ).toBe(true);
    expect(
      shouldCreateCanvasNodesFromMediaDrop({
        dropZone: 'canvas-pane',
        sourceNodeId: 'node_1',
        clientX: 100,
        clientY: 200,
      })
    ).toBe(false);
    expect(
      shouldCreateCanvasNodesFromMediaDrop({
        dropZone: 'reference',
        sourceNodeId: 'asset:abc',
        clientX: 100,
        clientY: 200,
      })
    ).toBe(false);
    expect(
      shouldCreateCanvasNodesFromMediaDrop({
        dropZone: 'canvas-pane',
        sourceNodeId: 'asset:abc',
      })
    ).toBe(false);
  });

  it('buildAssetItemsFromMediaDrop prefers multi-select assets payload', () => {
    const multi: FlowgenMediaUrlDropDetail = {
      url: 'https://a/1.png',
      kind: 'image',
      sourceNodeId: 'asset:multi',
      targetNodeId: '',
      dropZone: 'canvas-pane',
      clientX: 1,
      clientY: 2,
      assets: [
        { assetId: 'a1', assetName: 'one', url: 'https://a/1.png', mime: 'image/png' },
        { assetId: 'a2', assetName: 'two', url: 'https://a/2.png', mime: 'image/png' },
      ],
    };
    expect(buildAssetItemsFromMediaDrop(multi)).toEqual(multi.assets);
    const single = buildAssetItemsFromMediaDrop({
      url: 'https://v/x.mp4',
      kind: 'video',
      sourceNodeId: 'asset:v1',
      targetNodeId: '',
      dropZone: 'canvas-pane',
      assetId: 'v1',
      assetName: 'clip',
    });
    expect(single).toEqual([
      { assetId: 'v1', assetName: 'clip', url: 'https://v/x.mp4', mime: 'video/mp4' },
    ]);
  });

  it('prefers reference zone over underlying node-main in hit stack', () => {
    document.body.innerHTML = `
      <div data-flowgen-media-drop="1" data-flowgen-drop-zone="node-main" data-flowgen-node-id="n1" style="width:200px;height:200px">
        <div id="under">under</div>
      </div>
      <div data-flowgen-media-drop="1" data-flowgen-drop-zone="reference" data-flowgen-node-id="n1" style="position:absolute;left:0;top:0;width:100px;height:100px">
        <span id="top">ref</span>
      </div>
    `;
    const top = document.getElementById('top')!;
    const rect = { left: 10, top: 10, width: 20, height: 20, right: 30, bottom: 30, x: 10, y: 10, toJSON: () => ({}) };
    top.getBoundingClientRect = () => rect as DOMRect;
    const under = document.getElementById('under')!;
    under.getBoundingClientRect = () => rect as DOMRect;

    const orig = document.elementsFromPoint;
    document.elementsFromPoint = () => [top, under];
    try {
      const hit = resolveMediaDropZoneAtPoint(20, 20);
      expect(hit?.dropZone).toBe('reference');
      expect(hit?.zone.getAttribute('data-flowgen-node-id')).toBe('n1');
    } finally {
      document.elementsFromPoint = orig;
      document.body.innerHTML = '';
    }
  });

  it('prefers topmost last-frame when first/last zones overlap at point', () => {
    document.body.innerHTML = `
      <div data-flowgen-media-drop="1" data-flowgen-drop-zone="first-frame" data-flowgen-node-id="n1" style="position:absolute;left:0;top:0;width:80px;height:80px"></div>
      <div data-flowgen-media-drop="1" data-flowgen-drop-zone="last-frame" data-flowgen-node-id="n1" style="position:absolute;left:0;top:0;width:80px;height:80px">
        <span id="last">last</span>
      </div>
    `;
    const last = document.getElementById('last')!;
    const rect = { left: 10, top: 10, width: 20, height: 20, right: 30, bottom: 30, x: 10, y: 10, toJSON: () => ({}) };
    last.getBoundingClientRect = () => rect as DOMRect;
    const first = document.querySelector('[data-flowgen-drop-zone="first-frame"]')!;
    first.getBoundingClientRect = () => rect as DOMRect;

    const orig = document.elementsFromPoint;
    document.elementsFromPoint = () => [last, first];
    try {
      const hit = resolveMediaDropZoneAtPoint(20, 20);
      expect(hit?.dropZone).toBe('last-frame');
    } finally {
      document.elementsFromPoint = orig;
      document.body.innerHTML = '';
    }
  });
});
