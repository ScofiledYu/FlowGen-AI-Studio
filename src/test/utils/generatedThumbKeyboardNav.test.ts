import { describe, expect, it } from 'vitest';
import {
  buildNodeDetailsPreviewFromGeneratedThumb,
  findGeneratedThumbIndex,
  resolveAdjacentGeneratedThumbIndex,
  resolveGeneratedThumbNavTarget,
} from '../../../utils/generatedThumbKeyboardNav';

const thumbs = [
  {
    id: 't0',
    url: 'https://a/v0.mp4',
    type: 'video' as const,
    nodeId: 'mov_0',
    name: 'Video_98.mov',
    generationParams: {
      prompt: '第一场',
      model: 'seedance2.0 (急速版)',
      taskId: '111',
      referenceImages: ['https://a/ref0.png'],
      numberOfImages: '1条',
    },
  },
  {
    id: 't1',
    url: 'https://a/v1.mp4',
    type: 'video' as const,
    nodeId: 'mov_1',
    name: 'Video_311.mov',
    generationParams: {
      prompt: '第二场',
      model: 'seedance2.0 (急速版)',
      taskId: '222',
      referenceImages: ['https://a/ref1.png'],
      numberOfImages: '1条',
    },
  },
];

describe('generatedThumbKeyboardNav', () => {
  it('finds index by nodeId (OUTPUT/MOV preview)', () => {
    expect(findGeneratedThumbIndex(thumbs, { id: 'mov_1' })).toBe(1);
  });

  it('finds index by activeThumbId first', () => {
    expect(findGeneratedThumbIndex(thumbs, { id: 'mov_0', activeThumbId: 't1' })).toBe(1);
  });

  it('finds index by thumb id (temp preview)', () => {
    expect(findGeneratedThumbIndex(thumbs, { id: 't0' })).toBe(0);
  });

  it('finds index by imagePreview url', () => {
    expect(findGeneratedThumbIndex(thumbs, { id: 'x', imagePreview: 'https://a/v0.mp4' })).toBe(0);
  });

  it('adjacent wraps by default', () => {
    expect(resolveAdjacentGeneratedThumbIndex(2, 0, 'prev')).toBe(1);
    expect(resolveAdjacentGeneratedThumbIndex(2, 1, 'next')).toBe(0);
    expect(resolveAdjacentGeneratedThumbIndex(2, 0, 'next')).toBe(1);
  });

  it('adjacent can disable wrap', () => {
    expect(resolveAdjacentGeneratedThumbIndex(2, 0, 'prev', false)).toBeNull();
    expect(resolveAdjacentGeneratedThumbIndex(2, 1, 'next', false)).toBeNull();
  });

  it('resolve target for left/right from current MOV', () => {
    const next = resolveGeneratedThumbNavTarget(thumbs, { id: 'mov_0' }, 'next');
    expect(next?.id).toBe('t1');
    const prev = resolveGeneratedThumbNavTarget(thumbs, { id: 'mov_1' }, 'prev');
    expect(prev?.id).toBe('t0');
  });

  it('single thumb cannot navigate', () => {
    expect(resolveGeneratedThumbNavTarget([thumbs[0]], { id: 'mov_0' }, 'next')).toBeNull();
  });

  it('buildNodeDetailsPreviewFromGeneratedThumb uses full gp snapshot for Details', () => {
    const built = buildNodeDetailsPreviewFromGeneratedThumb(thumbs[1]);
    expect(built.type).toBe('movNode');
    expect(built.data.imagePreview).toBe('https://a/v1.mp4');
    expect(built.data.prompt).toBe('第二场');
    expect(built.data.taskId).toBe('222');
    expect(built.data.referenceImages).toEqual(['https://a/ref1.png']);
    expect((built.data.generationParams as { prompt?: string }).prompt).toBe('第二场');
  });

  it('switching next rebuilds different full Details payload', () => {
    const a = buildNodeDetailsPreviewFromGeneratedThumb(thumbs[0]);
    const b = buildNodeDetailsPreviewFromGeneratedThumb(
      resolveGeneratedThumbNavTarget(thumbs, { activeThumbId: 't0' }, 'next')!
    );
    expect(a.data.prompt).toBe('第一场');
    expect(b.data.prompt).toBe('第二场');
    expect(a.data.imagePreview).not.toBe(b.data.imagePreview);
  });
});
