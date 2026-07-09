import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flowgenFetch, FLOWGEN_TOKEN_KEY, FLOWGEN_USER_KEY } from '../../../services/flowgenApi';

describe('flowgenFetch 401 自动登出', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(FLOWGEN_TOKEN_KEY, 'stale-token');
    localStorage.setItem(FLOWGEN_USER_KEY, JSON.stringify({ id: 'u1' }));
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('401 时清除 token 并跳转 #/login', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'token 已过期' }),
    });

    await expect(flowgenFetch('/projects')).rejects.toThrow('token 已过期');

    expect(localStorage.getItem(FLOWGEN_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(FLOWGEN_USER_KEY)).toBeNull();
    expect(window.location.hash).toBe('#/login');
  });

  it('已在 #/login 时不重复跳转', async () => {
    window.location.hash = '#/login';
    localStorage.setItem(FLOWGEN_TOKEN_KEY, 'stale-token');

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: '未授权' }),
    });

    await expect(flowgenFetch('/projects')).rejects.toThrow('未授权');
    expect(localStorage.getItem(FLOWGEN_TOKEN_KEY)).toBeNull();
    expect(window.location.hash).toBe('#/login');
  });

  it('非 401 错误不清 token', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => JSON.stringify({ error: '数据库连接异常' }),
    });

    await expect(flowgenFetch('/projects')).rejects.toThrow('数据库连接异常');
    expect(localStorage.getItem(FLOWGEN_TOKEN_KEY)).toBe('stale-token');
  });
});
