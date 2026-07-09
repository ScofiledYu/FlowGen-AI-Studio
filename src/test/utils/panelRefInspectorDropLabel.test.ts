import { describe, expect, it } from 'vitest';
import { resolvePanelRefLabelForInspectorDrop } from '../../../utils/referenceImageSlotLabels';

describe('resolvePanelRefLabelForInspectorDrop', () => {
  it('canvas node drop uses 图片n not imageName', () => {
    const label = resolvePanelRefLabelForInspectorDrop({
      url: 'https://cdn.example/cat.png',
      incomingLabel: 'hekovs-animals-9533774_1920.jpg',
      fromCanvasNode: true,
      slotIndex: 0,
      referenceImages: ['https://cdn.example/cat.png'],
      imagePreview: '',
    });
    expect(label).toBe('图片1');
  });

  it('sequential canvas drops increment 图片n', () => {
    const first = resolvePanelRefLabelForInspectorDrop({
      url: 'https://cdn.example/a.png',
      fromCanvasNode: true,
      slotIndex: 0,
      referenceImages: ['https://cdn.example/a.png'],
    });
    const second = resolvePanelRefLabelForInspectorDrop({
      url: 'https://cdn.example/b.png',
      fromCanvasNode: true,
      slotIndex: 1,
      referenceImages: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
      imagePreview: 'https://cdn.example/main.png',
    });
    expect(first).toBe('图片1');
    expect(second).toBe('图片2');
  });

  it('asset library name wins over incoming filename', () => {
    const label = resolvePanelRefLabelForInspectorDrop({
      url: '/flowgen-api/projects/p1/assets/a1/file',
      incomingLabel: 'a1.jpg',
      fromCanvasNode: false,
      slotIndex: 0,
      referenceImages: ['/flowgen-api/projects/p1/assets/a1/file'],
      projectAssets: [{ slug: 'a1', name: '萧逍', url: '/flowgen-api/projects/p1/assets/a1/file' }],
    });
    expect(label).toBe('萧逍');
  });

  it('stale deleted asset name on blob URL uses 图片n', () => {
    const label = resolvePanelRefLabelForInspectorDrop({
      url: 'blob:http://localhost:3001/fresh.png',
      incomingLabel: '萧逍',
      fromCanvasNode: false,
      slotIndex: 1,
      referenceImages: ['blob:http://localhost/a.png', 'blob:http://localhost:3001/fresh.png'],
      projectAssets: [{ slug: 'other', name: '其它', url: '/flowgen-api/projects/p1/assets/other/file' }],
    });
    expect(label).toBe('图片2');
  });
});
