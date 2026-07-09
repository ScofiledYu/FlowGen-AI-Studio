import { describe, expect, it } from 'vitest';
import {
  isKnownUpstreamFailureMessage,
  sanitizeAiTopTaskFailureMessage,
} from '../../../utils/aitopTaskRecovery';

describe('aitopTaskRecovery', () => {
  describe('isKnownUpstreamFailureMessage', () => {
    it('recognizes invalid_request_error', () => {
      expect(isKnownUpstreamFailureMessage('上游返回 invalid_request_error')).toBe(true);
    });

    it('recognizes 上游拒绝了生成请求', () => {
      expect(isKnownUpstreamFailureMessage('image 2 上游拒绝了生成请求：xxx')).toBe(true);
    });

    it('recognizes 任务失败', () => {
      expect(isKnownUpstreamFailureMessage('任务失败：超时')).toBe(true);
    });

    it('recognizes referenced_image_ids', () => {
      expect(isKnownUpstreamFailureMessage('referenced_image_ids 字段不合规')).toBe(true);
    });

    it('returns false for transient/network errors', () => {
      expect(isKnownUpstreamFailureMessage('Failed to fetch')).toBe(false);
      expect(isKnownUpstreamFailureMessage('ECONNRESET')).toBe(false);
    });

    it('returns false for empty/undefined', () => {
      expect(isKnownUpstreamFailureMessage(undefined)).toBe(false);
      expect(isKnownUpstreamFailureMessage('')).toBe(false);
    });
  });

  describe('sanitizeAiTopTaskFailureMessage', () => {
    it('returns default for empty', () => {
      expect(sanitizeAiTopTaskFailureMessage('')).toBe('任务失败（无详细说明）');
      expect(sanitizeAiTopTaskFailureMessage(undefined)).toBe('任务失败（无详细说明）');
    });

    it('summarizes invalid_request_error with prompt hint', () => {
      const out = sanitizeAiTopTaskFailureMessage(
        'invalid_request_error: bad request',
        'image 2'
      );
      expect(out).toContain('invalid_request_error');
      expect(out).toContain('image 2');
      expect(out).toContain('prompt');
    });

    it('detects batch merge (multiple prompt keys)', () => {
      const raw = 'invalid_request_error {"prompt":"a"}{"prompt":"b"}';
      const out = sanitizeAiTopTaskFailureMessage(raw, 'image 2');
      expect(out).toContain('2 段');
      expect(out).toContain('生成张数');
    });

    it('truncates long messages', () => {
      const long = 'x'.repeat(800);
      const out = sanitizeAiTopTaskFailureMessage(long);
      expect(out.length).toBeLessThanOrEqual(520);
    });
  });
});
