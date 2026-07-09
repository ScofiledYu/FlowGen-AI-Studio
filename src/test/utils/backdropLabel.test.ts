import { describe, expect, it } from 'vitest';
import {
  backdropFlowSizeChanged,
  backdropLabelScreenHeightFromPresentation,
  BACKDROP_LABEL_EDIT_BLOCK_MS,
  getBackdropFlowSizeFromNode,
  nextBackdropLabelEditBlockUntil,
  resolveBackdropLabelPresentation,
  shouldBlockBackdropLabelEdit,
} from '../../../utils/backdropLabel';

describe('backdropLabel', () => {
  it('getBackdropFlowSizeFromNode prefers width>=48 then style', () => {
    expect(getBackdropFlowSizeFromNode({ width: 400, height: 300, style: { width: 100 } })).toEqual({
      w: 400,
      h: 300,
    });
    expect(getBackdropFlowSizeFromNode({ width: 12, style: { width: 520, height: 240 } })).toEqual({
      w: 520,
      h: 240,
    });
    expect(getBackdropFlowSizeFromNode(undefined)).toEqual({ w: 280, h: 200 });
  });

  it('counter-scale keeps screen height constant across zoom levels', () => {
    const zooms = [0.08, 0.2, 0.55, 1, 2.5];
    const heights = zooms.map((z) => {
      const p = resolveBackdropLabelPresentation(true, z);
      return backdropLabelScreenHeightFromPresentation(p, z);
    });
    for (const h of heights) {
      expect(h).toBeCloseTo(26, 5);
    }
  });

  it('named labels use same screen height at same zoom', () => {
    const zoom = 0.35;
    const a = resolveBackdropLabelPresentation(true, zoom);
    const b = resolveBackdropLabelPresentation(true, zoom);
    expect(backdropLabelScreenHeightFromPresentation(a, zoom)).toBe(
      backdropLabelScreenHeightFromPresentation(b, zoom)
    );
  });

  it('shouldBlockBackdropLabelEdit during viewport move or cooldown', () => {
    const now = 1_000_000;
    expect(
      shouldBlockBackdropLabelEdit({ now, blockUntil: now + 500, viewportMoving: false })
    ).toBe(true);
    expect(
      shouldBlockBackdropLabelEdit({ now, blockUntil: now - 1, viewportMoving: true })
    ).toBe(true);
    expect(
      shouldBlockBackdropLabelEdit({ now, blockUntil: now - 1, viewportMoving: false })
    ).toBe(false);
  });

  it('backdropFlowSizeChanged detects resize', () => {
    expect(backdropFlowSizeChanged({ w: 400, h: 300 }, { w: 420, h: 300 })).toBe(true);
    expect(backdropFlowSizeChanged({ w: 400, h: 300 }, { w: 400, h: 300 })).toBe(false);
  });

  it('nextBackdropLabelEditBlockUntil uses configured windows', () => {
    const now = 5_000;
    expect(nextBackdropLabelEditBlockUntil(now, 'afterResize')).toBe(
      now + BACKDROP_LABEL_EDIT_BLOCK_MS.afterResize
    );
    expect(nextBackdropLabelEditBlockUntil(now, 'afterWheelOrViewport')).toBe(
      now + BACKDROP_LABEL_EDIT_BLOCK_MS.afterWheelOrViewport
    );
  });
});
