type ProfileMeta = Record<string, unknown> | undefined;

const PROFILE_FLAG_KEY = 'flowgen:runtime-profile';
const PROFILE_SLOW_MS = 24;

function isProfileEnabled(): boolean {
  try {
    return localStorage.getItem(PROFILE_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function profileSync<T>(label: string, fn: () => T, meta?: ProfileMeta): T {
  if (!isProfileEnabled()) return fn();
  const startedAt = performance.now();
  const result = fn();
  const elapsed = performance.now() - startedAt;
  if (elapsed >= PROFILE_SLOW_MS) {
    console.info(
      `[FlowGen:profile] ${label} ${elapsed.toFixed(1)}ms ${JSON.stringify(meta || {})}`
    );
  }
  return result;
}

export async function profileAsync<T>(label: string, fn: () => Promise<T>, meta?: ProfileMeta): Promise<T> {
  if (!isProfileEnabled()) return fn();
  const startedAt = performance.now();
  const result = await fn();
  const elapsed = performance.now() - startedAt;
  if (elapsed >= PROFILE_SLOW_MS) {
    console.info(
      `[FlowGen:profile] ${label} ${elapsed.toFixed(1)}ms ${JSON.stringify(meta || {})}`
    );
  }
  return result;
}

