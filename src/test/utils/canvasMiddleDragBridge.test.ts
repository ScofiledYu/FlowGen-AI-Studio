import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Node as RFNode } from 'reactflow';
import { NodeType } from '../../../types';
import { installCanvasMiddleDragBridge } from '../../../utils/canvasMiddleDragBridge';
import { FLOWGEN_MEDIA_URL_DROP } from '../../../utils/middleButtonMediaDrag';

describe('canvasMiddleDragBridge', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="react-flow">
        <div class="react-flow__node" data-id="src1">
          <div data-flowgen-node-id="src1" data-flowgen-drop-zone="node-main">
            <div id="preview">preview</div>
          </div>
        </div>
      </div>
      <div
        id="dropzone"
        data-flowgen-media-drop="1"
        data-flowgen-drop-zone="seedance-reference"
        data-flowgen-node-id="anchor1"
      ></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    installCanvasMiddleDragBridge(() => [])();
  });

  it('starts middle drag from node preview on middle mousedown', () => {
    const nodes: RFNode[] = [
      {
        id: 'src1',
        type: NodeType.PROCESSOR,
        position: { x: 0, y: 0 },
        selected: false,
        data: { imagePreview: 'https://cdn.example/src.png' },
      } as RFNode,
    ];
    const cleanup = installCanvasMiddleDragBridge(() => nodes);
    const preview = document.getElementById('preview')!;
    const rect = { left: 40, top: 40, width: 80, height: 60, right: 120, bottom: 100, x: 40, y: 40, toJSON: () => ({}) };
    preview.getBoundingClientRect = () => rect as DOMRect;

    preview.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 70,
        button: 1,
        buttons: 4,
      })
    );

    expect(document.body.classList.contains('flowgen-middle-media-drag')).toBe(true);
    cleanup();
  });

  it('dispatches seedance drop after drag move and release', () => {
    const nodes: RFNode[] = [
      {
        id: 'src1',
        type: NodeType.PROCESSOR,
        position: { x: 0, y: 0 },
        selected: false,
        data: { imagePreview: 'https://cdn.example/src.png' },
      } as RFNode,
    ];
    const cleanup = installCanvasMiddleDragBridge(() => nodes);
    const preview = document.getElementById('preview')!;
    const dropzone = document.getElementById('dropzone')!;
    const previewRect = { left: 40, top: 40, width: 80, height: 60, right: 120, bottom: 100, x: 40, y: 40, toJSON: () => ({}) };
    const dropRect = { left: 300, top: 300, width: 120, height: 120, right: 420, bottom: 420, x: 300, y: 300, toJSON: () => ({}) };
    preview.getBoundingClientRect = () => previewRect as DOMRect;
    dropzone.getBoundingClientRect = () => dropRect as DOMRect;

    const received: unknown[] = [];
    const onDrop = (ev: Event) => received.push((ev as CustomEvent).detail);
    window.addEventListener(FLOWGEN_MEDIA_URL_DROP, onDrop);

    const orig = document.elementsFromPoint;
    document.elementsFromPoint = () => [dropzone];

    preview.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 70,
        button: 1,
        buttons: 4,
      })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 360,
        clientY: 360,
        button: 1,
        buttons: 4,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
    window.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: 360,
        clientY: 360,
        button: 1,
        buttons: 0,
      })
    );

    try {
      expect(received).toHaveLength(1);
      expect((received[0] as { dropZone?: string }).dropZone).toBe('seedance-reference');
      expect((received[0] as { targetNodeId?: string }).targetNodeId).toBe('anchor1');
    } finally {
      document.elementsFromPoint = orig;
      window.removeEventListener(FLOWGEN_MEDIA_URL_DROP, onDrop);
      cleanup();
    }
  });

  it('does not start middle drag when Alt+middle (canvas pan gesture)', () => {
    const nodes: RFNode[] = [
      {
        id: 'src1',
        type: NodeType.PROCESSOR,
        position: { x: 0, y: 0 },
        selected: true,
        data: { imagePreview: 'https://cdn.example/src.png' },
      } as RFNode,
    ];
    const cleanup = installCanvasMiddleDragBridge(() => nodes);
    const preview = document.getElementById('preview')!;

    preview.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 70,
        button: 1,
        buttons: 4,
        altKey: true,
      })
    );

    expect(document.body.classList.contains('flowgen-middle-media-drag')).toBe(false);
    cleanup();
  });
});
