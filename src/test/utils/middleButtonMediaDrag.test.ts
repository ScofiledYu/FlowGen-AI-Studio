import { describe, expect, it } from 'vitest';
import { resolveMediaDropZoneAtPoint } from '../../../utils/middleButtonMediaDrag';

describe('resolveMediaDropZoneAtPoint', () => {
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
});
