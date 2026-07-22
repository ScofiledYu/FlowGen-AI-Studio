import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { canUseSaveFilePicker, ensureJsonFileName, saveJsonBlob } from '../../../utils/saveJsonFile';

describe('canUseSaveFilePicker', () => {
  it('false when API missing', () => {
    expect(canUseSaveFilePicker({ isSecureContext: true })).toBe(false);
  });

  it('false on insecure context even if API present (http://内网IP)', () => {
    expect(
      canUseSaveFilePicker({
        isSecureContext: false,
        showSaveFilePicker: async () => {
          throw new Error('should not call');
        },
      })
    ).toBe(false);
  });

  it('true only when secure + API present', () => {
    expect(
      canUseSaveFilePicker({
        isSecureContext: true,
        showSaveFilePicker: async () => ({}) as FileSystemFileHandle,
      })
    ).toBe(true);
  });
});

describe('ensureJsonFileName', () => {
  it('appends .json', () => {
    expect(ensureJsonFileName('nodes-a', 'fallback')).toBe('nodes-a.json');
  });

  it('keeps existing .json', () => {
    expect(ensureJsonFileName('x.JSON', 'fallback')).toBe('x.JSON');
  });

  it('uses fallback when empty', () => {
    expect(ensureJsonFileName('  ', 'nodes-export')).toBe('nodes-export.json');
  });
});

describe('saveJsonBlob insecure fallback', () => {
  const originalConfirm = window.confirm;

  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn());
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    vi.unstubAllGlobals();
  });

  it('aborts when user cancels confirm on insecure path', async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await saveJsonBlob(new Blob(['{}']), 'a.json');
    expect(result).toBe('aborted');
    expect(window.confirm).toHaveBeenCalled();
  });
});
