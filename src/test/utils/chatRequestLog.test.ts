import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock 工厂被提升到顶部，不能引用普通顶层变量；用 vi.hoisted 创建 mock
const { logPreloadJsonMock, isPreloadDebugEnabledMock } = vi.hoisted(() => ({
  logPreloadJsonMock: vi.fn(),
  isPreloadDebugEnabledMock: vi.fn(),
}));

vi.mock('../../../services/aitop', () => ({
  logPreloadJson: logPreloadJsonMock,
  isPreloadDebugEnabled: () => isPreloadDebugEnabledMock(),
}));

vi.mock('../../../utils/aitopBilling', () => ({
  getAitopBillingContext: () => ({ domainAccount: 'acc-1', scoreProjectId: 'proj-9' }),
}));

import { logChatLlmPreload } from '../../../utils/chatRequestLog';

describe('chatRequestLog logChatLlmPreload', () => {
  beforeEach(() => {
    logPreloadJsonMock.mockClear();
    isPreloadDebugEnabledMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debug 开启时输出 channel=llm-chat 且脱敏 headers', () => {
    isPreloadDebugEnabledMock.mockReturnValue(true);
    logChatLlmPreload({
      model: 'deepseek-v4-pro-260425',
      url: '/aitop-llm-see',
      upstreamUrl: 'https://upstream/llm/see',
      headers: { 'api-key': 'secret-key', Authorization: 'Bearer abc123', 'Content-Type': 'application/json' },
      body: { prompt: 'hi' },
    });

    expect(logPreloadJsonMock).toHaveBeenCalledTimes(1);
    const payload = logPreloadJsonMock.mock.calls[0][0];
    expect(payload.debugType).toBe('preload');
    expect(payload.channel).toBe('llm-chat');
    expect(payload.model).toBe('deepseek-v4-pro-260425');
    expect(payload.method).toBe('POST');
    expect(payload.url).toBe('/aitop-llm-see');
    expect(payload.upstreamUrl).toBe('https://upstream/llm/see');
    expect(payload.domainAccount).toBe('acc-1');
    expect(payload.scoreProjectId).toBe('proj-9');
    // 脱敏
    expect(payload.headers['api-key']).toBe('***');
    expect(payload.headers.Authorization).toBe('Bearer ***');
    expect(payload.headers['Content-Type']).toBe('application/json');
    expect(payload.body).toEqual({ prompt: 'hi' });
  });

  it('debug 关闭时不输出', () => {
    isPreloadDebugEnabledMock.mockReturnValue(false);
    logChatLlmPreload({
      model: 'qwen',
      url: '/api/v1/chat/completions',
      headers: {},
      body: {},
    });
    expect(logPreloadJsonMock).not.toHaveBeenCalled();
  });

  it('无 upstreamUrl 时不写入该字段', () => {
    isPreloadDebugEnabledMock.mockReturnValue(true);
    logChatLlmPreload({
      model: 'qwen',
      url: '/api/v1/chat/completions',
      headers: {},
      body: {},
    });
    const payload = logPreloadJsonMock.mock.calls[0][0];
    expect(payload.upstreamUrl).toBeUndefined();
  });

  it('非 Bearer 的 Authorization 不脱敏', () => {
    isPreloadDebugEnabledMock.mockReturnValue(true);
    logChatLlmPreload({
      model: 'qwen',
      url: '/x',
      headers: { Authorization: 'Basic xyz' },
      body: {},
    });
    const payload = logPreloadJsonMock.mock.calls[0][0];
    expect(payload.headers.Authorization).toBe('Basic xyz');
  });
});
