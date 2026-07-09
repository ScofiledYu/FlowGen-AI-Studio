import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  uploadImage,
  createNanoTask,
  getTaskStatus,
  normalizeKlingOmniImageListForAiTopProxy,
  normalizeKlingOmniElementListForPayload,
  dedupeKlingOmniElementListAgainstImageList,
  mergeKlingOmniElementListDeduped,
  shouldLogAitopModelPreloadBody,
  compactAitopPreloadBodyForLog,
} from '../../../services/aitop';

// Mock fetch globally
global.fetch = vi.fn();

describe('AiTop Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadImage', () => {
    it('should upload image successfully', async () => {
      const mockImageUrl = 'https://example.com/image.png';
      const mockResponse = {
        code: 0,
        success: true,
        data: { key: 'test-key.png' }
      };

      // Mock fetch for getBlobFromUrl（直连需 ok，否则会走 /proxy-file 与上传 mock 错位）
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob()),
      });

      // Mock fetch for upload
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockResponse)
      });

      const result = await uploadImage(mockImageUrl);
      
      expect(result).toBe('https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/test-key.png');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw on upload failure with API detail', async () => {
      const mockImageUrl = 'https://example.com/image.png';
      const mockResponse = {
        code: 1102,
        success: false,
        message: 'account balance not enough',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob()),
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockResponse),
      });

      await expect(uploadImage(mockImageUrl)).rejects.toThrow(/account balance not enough/);
    });

    it('should throw on network error', async () => {
      const mockImageUrl = 'https://example.com/image.png';

      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(uploadImage(mockImageUrl)).rejects.toThrow(/Network error/);
    });

    it('should fetch flowgen protected asset with JWT before upload', async () => {
      const flowgenPath = '/flowgen-api/projects/p1/assets/a1/file';
      const mockResponse = {
        code: 0,
        success: true,
        data: { key: 'fg-asset.png' },
      };

      vi.stubGlobal('localStorage', {
        getItem: (key: string) => (key === 'flowgen_token' ? 'test-jwt' : null),
      });
      vi.stubGlobal('window', {
        location: { origin: 'http://localhost:3001' },
      });

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          blob: () => Promise.resolve(new Blob(['img'])),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(mockResponse),
        });

      const result = await uploadImage(flowgenPath);

      expect(result).toBe(
        'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/fg-asset.png'
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:3001/flowgen-api/projects/p1/assets/a1/file',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-jwt' },
        })
      );
    });
  });

  describe('createNanoTask', () => {
    it('should create nano task successfully', async () => {
      const mockResponse = {
        code: 0,
        success: true,
        data: { taskId: 'test-task-id' }
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockResponse)
      });

      const result = await createNanoTask('test prompt', ['image1.png'], {
        aspectRatio: '1:1',
        imageSize: '2K',
      });
      
      expect(result).toBe('test-task-id');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/images/nanoBanana'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'api-key': expect.any(String),
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            platform: 'NANO_BANANA_2_FLASH',
            prompt: 'test prompt',
            aspectRatio: '1:1',
            image: ['image1.png'],
            imageSize: '2K',
            generateNum: 1,
          })
        })
      );
    });

    it('should throw error on task creation failure', async () => {
      const mockResponse = {
        code: 1,
        success: false
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockResponse)
      });

      await expect(createNanoTask('test prompt')).rejects.toThrow();
    });
  });

  describe('getTaskStatus', () => {
    it('should get task status successfully', async () => {
      const mockResponse = {
        code: 0,
        success: true,
        data: {
          status: '2',
          resourceUrl: 'https://example.com/result.png'
        }
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockResponse)
      });

      const result = await getTaskStatus('test-task-id');
      
      expect(result).toEqual(mockResponse.data);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/task-status?taskId=test-task-id'),
        expect.objectContaining({
          method: 'GET',
          cache: 'no-store'
        })
      );
    });

    it('should throw error on status check failure', async () => {
      const mockResponse = {
        code: 1,
        success: false
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockResponse)
      });

      await expect(getTaskStatus('test-task-id')).rejects.toThrow();
    });
  });

  describe('normalizeKlingOmniImageListForAiTopProxy', () => {
    it('fills first missing as first_frame and further missing as end_frame (Kling forbids multiple first_frame)', () => {
      const out = normalizeKlingOmniImageListForAiTopProxy([
        { image_url: 'https://x/a.png' },
        { image_url: 'https://x/b.png' },
      ]);
      expect(out).toEqual([
        { image_url: 'https://x/a.png', type: 'first_frame' },
        { image_url: 'https://x/b.png', type: 'end_frame' },
      ]);
    });

    it('after explicit first_frame, further missing becomes end_frame', () => {
      const out = normalizeKlingOmniImageListForAiTopProxy([
        { image_url: 'https://x/a.png', type: 'first_frame' },
        { image_url: 'https://x/b.png' },
      ]);
      expect(out).toEqual([
        { image_url: 'https://x/a.png', type: 'first_frame' },
        { image_url: 'https://x/b.png', type: 'end_frame' },
      ]);
    });

    it('trims type and preserves explicit values', () => {
      const out = normalizeKlingOmniImageListForAiTopProxy([
        { image_url: 'https://x/c.png', type: '  end_frame  ' },
      ]);
      expect(out).toEqual([{ image_url: 'https://x/c.png', type: 'end_frame' }]);
    });

    it('with hasVideo, emits image_url only (no first_frame/end_frame)', () => {
      const out = normalizeKlingOmniImageListForAiTopProxy(
        [
          { image_url: 'https://x/a.png' },
          { image_url: 'https://x/b.png' },
        ],
        { hasVideo: true }
      );
      expect(out).toEqual([
        { image_url: 'https://x/a.png' },
        { image_url: 'https://x/b.png' },
      ]);
    });

    it('with hasVideo, strips element_id from payload rows（主体进平级 elementList）', () => {
      const out = normalizeKlingOmniImageListForAiTopProxy(
        [
          { image_url: 'https://x/a.png', element_id: 'elem-1' },
          { image_url: 'https://x/b.png' },
        ],
        { hasVideo: true }
      );
      expect(out).toEqual([{ image_url: 'https://x/a.png' }, { image_url: 'https://x/b.png' }]);
    });

    it('without video, output image rows have no element_id', () => {
      const out = normalizeKlingOmniImageListForAiTopProxy([
        { image_url: 'https://x/a.png', type: 'first_frame', element_id: 'e1' },
        { image_url: 'https://x/b.png', element_id: 'e2' },
      ]);
      expect(out).toEqual([
        { image_url: 'https://x/a.png', type: 'first_frame' },
        { image_url: 'https://x/b.png', type: 'end_frame' },
      ]);
    });

    it('Omni multi-ref (>2 images): extra refs omit type (no spurious end_frame)', () => {
      const out = normalizeKlingOmniImageListForAiTopProxy([
        { image_url: 'https://x/a.png', type: 'first_frame' },
        { image_url: 'https://x/b.png' },
        { image_url: 'https://x/c.png' },
      ]);
      expect(out).toEqual([
        { image_url: 'https://x/a.png', type: 'first_frame' },
        { image_url: 'https://x/b.png' },
        { image_url: 'https://x/c.png' },
      ]);
    });
  });

  describe('mergeKlingOmniElementListDeduped', () => {
    it('merges and dedupes element_id from multiple arrays', () => {
      expect(
        mergeKlingOmniElementListDeduped(
          [{ element_id: 'a' }, { elementId: 'b' }],
          [{ element_id: 'a' }, { element_id: 'c' }]
        )
      ).toEqual([{ element_id: 'a' }, { element_id: 'b' }, { element_id: 'c' }]);
    });
  });

  describe('normalizeKlingOmniElementListForPayload', () => {
    it('maps elementId / element_id and drops empty', () => {
      expect(
        normalizeKlingOmniElementListForPayload([
          { element_id: ' a ' },
          { elementId: 'b' },
          {},
          { element_id: '' },
        ])
      ).toEqual([{ element_id: 'a' }, { element_id: 'b' }]);
    });

    it('returns empty for null/empty input', () => {
      expect(normalizeKlingOmniElementListForPayload(undefined)).toEqual([]);
      expect(normalizeKlingOmniElementListForPayload([])).toEqual([]);
    });
  });

  describe('dedupeKlingOmniElementListAgainstImageList', () => {
    it('drops element_ids already present on image rows', () => {
      const images = [
        { image_url: 'https://x/a.png', element_id: '307069937907251' },
      ];
      const elements = [{ element_id: '307069937907251' }, { element_id: '999' }];
      expect(dedupeKlingOmniElementListAgainstImageList(images, elements)).toEqual([{ element_id: '999' }]);
    });

    it('keeps elementList when no overlap with images', () => {
      const images = [{ image_url: 'https://x/a.png' }];
      const elements = [{ element_id: 'e1' }];
      expect(dedupeKlingOmniElementListAgainstImageList(images, elements)).toEqual([{ element_id: 'e1' }]);
    });
  });

  describe('shouldLogAitopModelPreloadBody', () => {
    it('logs first batch task only when clientBatchTotal > 1', () => {
      expect(shouldLogAitopModelPreloadBody({ clientBatchIndex: 1, clientBatchTotal: 3 })).toBe(true);
      expect(shouldLogAitopModelPreloadBody({ clientBatchIndex: 2, clientBatchTotal: 3 })).toBe(false);
      expect(shouldLogAitopModelPreloadBody({ prompt: 'x' })).toBe(true);
    });
  });

  describe('compactAitopPreloadBodyForLog', () => {
    it('drops snake_case duplicates when camelCase sibling exists (Omni dual-write)', () => {
      const imagePayload = [{ image_url: 'https://x/a.png' }];
      const compact = compactAitopPreloadBodyForLog({
        modelName: 'KLING_V3_OMNI',
        model_name: 'KLING_V3_OMNI',
        generateNum: 1,
        generate_num: 1,
        aspectRatio: '16:9',
        aspect_ratio: '16:9',
        imageList: imagePayload,
        image_list: imagePayload,
        scoreProjectId: '14',
      }) as Record<string, unknown>;
      expect(compact).toEqual({
        modelName: 'KLING_V3_OMNI',
        generateNum: 1,
        aspectRatio: '16:9',
        imageList: imagePayload,
        scoreProjectId: '14',
      });
    });

    it('keeps API-only snake_case fields (image_url, element_id)', () => {
      expect(
        compactAitopPreloadBodyForLog({
          imageList: [{ image_url: 'https://x/a.png', element_id: 'e1' }],
        })
      ).toEqual({
        imageList: [{ image_url: 'https://x/a.png', element_id: 'e1' }],
      });
    });

    it('recursively compacts nested objects', () => {
      expect(
        compactAitopPreloadBodyForLog({
          parameters: { aspect_ratio: '16:9', aspectRatio: '16:9', duration: 5 },
        })
      ).toEqual({
        parameters: { aspectRatio: '16:9', duration: 5 },
      });
    });
  });
});









