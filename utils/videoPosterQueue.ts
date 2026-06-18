import { captureVideoMiddleFrame } from './videoThumbnail';
import { profileAsync } from './runtimeProfile';

type QueueTask = {
  url: string;
  resolve: (value: string | null) => void;
};

const MAX_CONCURRENT_POSTER_CAPTURES = 2;
const pending: QueueTask[] = [];
const inFlightByUrl = new Map<string, Promise<string | null>>();
let running = 0;

function runNext() {
  if (running >= MAX_CONCURRENT_POSTER_CAPTURES) return;
  const task = pending.shift();
  if (!task) return;
  running += 1;
  profileAsync(
    'poster-capture',
    () => captureVideoMiddleFrame(task.url),
    { queueDepth: pending.length, running, urlPrefix: task.url.slice(0, 64) }
  )
    .then((result) => task.resolve(result))
    .catch(() => task.resolve(null))
    .finally(() => {
      running = Math.max(0, running - 1);
      runNext();
    });
}

export function captureVideoMiddleFrameQueued(url: string): Promise<string | null> {
  const existing = inFlightByUrl.get(url);
  if (existing) return existing;
  const promise = new Promise<string | null>((resolve) => {
    pending.push({ url, resolve });
    runNext();
  });
  inFlightByUrl.set(url, promise);
  void promise.finally(() => {
    if (inFlightByUrl.get(url) === promise) inFlightByUrl.delete(url);
  });
  return promise;
}

