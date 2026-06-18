import { describe, it, expect } from 'vitest';
import { NodeType } from '../../../types';
import {
  deriveDownloadFilenameFromUrl,
  isGenericDownloadFilename,
  resolveNodeDownloadFilename,
} from '../../../utils/nodeDownloadFilename';

describe('resolveNodeDownloadFilename', () => {
  it('prefers customName over imageName and label', () => {
    const name = resolveNodeDownloadFilename(
      {
        customName: 'ep001_seq001_sc007',
        imageName: 'Generated_482.png',
        label: 'Output Picture Node',
      },
      { nodeType: NodeType.OUTPUT, nodeId: 'node-abc123' }
    );
    expect(name).toBe('ep001_seq001_sc007.png');
  });

  it('uses imageName when no customName', () => {
    const name = resolveNodeDownloadFilename(
      { imageName: '萧逍.png', label: 'Input Picture Node' },
      { nodeType: NodeType.INPUT }
    );
    expect(name).toBe('萧逍.png');
  });

  it('uses label when imageName is generic', () => {
    const name = resolveNodeDownloadFilename(
      { imageName: 'Generated_123.png', label: '分镜镜头A' },
      { nodeType: NodeType.OUTPUT }
    );
    expect(name).toBe('分镜镜头A.png');
  });

  it('uses mov extension for MOV nodes', () => {
    const name = resolveNodeDownloadFilename(
      { customName: 'hero_take_01' },
      { nodeType: NodeType.MOV }
    );
    expect(name).toBe('hero_take_01.mov');
  });

  it('derives filename from preview URL as fallback', () => {
    const name = resolveNodeDownloadFilename(
      { imageName: 'Generated_1.png', label: 'Output Picture Node' },
      {
        nodeType: NodeType.OUTPUT,
        imagePreview: 'https://cdn.example.com/assets/final_frame.webp?token=abc',
      }
    );
    expect(name).toBe('final_frame.webp');
  });

  it('sanitizes illegal Windows filename characters', () => {
    const name = resolveNodeDownloadFilename(
      { customName: 'shot:01|take' },
      { nodeType: NodeType.OUTPUT }
    );
    expect(name).toBe('shot_01_take.png');
  });
});

describe('deriveDownloadFilenameFromUrl', () => {
  it('unwraps proxy-file URLs', () => {
    const name = deriveDownloadFilenameFromUrl(
      '/proxy-file?url=' + encodeURIComponent('https://x.com/path/my_video.mp4')
    );
    expect(name).toBe('my_video.mp4');
  });

  it('returns empty for generic proxy segments', () => {
    expect(
      deriveDownloadFilenameFromUrl(
        '/proxy-file?url=' + encodeURIComponent('https://cdn.example.com/proxy-file')
      )
    ).toBe('');
  });
});

describe('isGenericDownloadFilename', () => {
  it('flags auto-generated names', () => {
    expect(isGenericDownloadFilename('Generated_999.png')).toBe(true);
    expect(isGenericDownloadFilename('萧逍.png')).toBe(false);
  });
});
