import { describe, expect, it } from 'vitest';
import {
  extractInspectorDragUrl,
  extractInspectorDragUrls,
  hasInspectorLocalFiles,
} from '../../../utils/inspectorMediaDrop';

function makeDataTransfer(init: Record<string, string> = {}, files: File[] = []): DataTransfer {
  const store = new Map<string, string>(Object.entries(init));
  const dt = {
    getData: (format: string) => store.get(format) || '',
    setData: (format: string, value: string) => {
      store.set(format, value);
    },
    files: files as unknown as FileList,
    types: [...store.keys(), ...(files.length ? ['Files'] : [])],
  } as unknown as DataTransfer;
  return dt;
}

describe('extractInspectorDragUrls', () => {
  it('reads application/flowgen/image', () => {
    const dt = makeDataTransfer({ 'application/flowgen/image': 'https://x/a.png' });
    expect(extractInspectorDragUrls(dt)).toEqual(['https://x/a.png']);
  });

  it('falls back to text/plain when no local files', () => {
    expect(extractInspectorDragUrls(makeDataTransfer({ 'text/plain': 'https://x/b.png' }))).toEqual([
      'https://x/b.png',
    ]);
  });

  it('ignores file:// text/plain when desktop Files present', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const dt = makeDataTransfer({ 'text/plain': 'file:///C:/Users/a.png' }, [file]);
    expect(hasInspectorLocalFiles(dt)).toBe(true);
    expect(extractInspectorDragUrls(dt)).toEqual([]);
  });

  it('falls back to text/plain when Files type is listed but file list is empty', () => {
    const store = new Map<string, string>([['text/plain', 'https://x/d.png']]);
    const dt = {
      getData: (format: string) => store.get(format) || '',
      setData: (format: string, value: string) => {
        store.set(format, value);
      },
      files: [] as unknown as FileList,
      types: ['Files', 'text/plain'],
    } as unknown as DataTransfer;
    expect(hasInspectorLocalFiles(dt)).toBe(false);
    expect(extractInspectorDragUrls(dt)).toEqual(['https://x/d.png']);
  });

  it('still reads flowgen payload when Files also present', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const dt = makeDataTransfer({ 'application/flowgen/image': 'https://x/c.png' }, [file]);
    expect(extractInspectorDragUrls(dt)).toEqual(['https://x/c.png']);
  });

  it('parses application/flowgen/images JSON array', () => {
    const dt = makeDataTransfer({
      'application/flowgen/images': JSON.stringify(['https://x/1.png', 'https://x/2.png']),
    });
    expect(extractInspectorDragUrls(dt)).toEqual(['https://x/1.png', 'https://x/2.png']);
  });

  it('prefers window __flowGenDragImages buffer', () => {
    const prev = (window as { __flowGenDragImages?: string[] }).__flowGenDragImages;
    (window as { __flowGenDragImages?: string[] }).__flowGenDragImages = ['https://win/1.png'];
    const dt = makeDataTransfer({ 'application/flowgen/image': 'https://ignored.png' });
    expect(extractInspectorDragUrls(dt)).toEqual(['https://win/1.png']);
    (window as { __flowGenDragImages?: string[] }).__flowGenDragImages = prev;
  });

  it('extractInspectorDragUrl returns first only', () => {
    const dt = makeDataTransfer({
      'application/flowgen/images': JSON.stringify(['https://x/1.png', 'https://x/2.png']),
    });
    expect(extractInspectorDragUrl(dt)).toBe('https://x/1.png');
  });
});
