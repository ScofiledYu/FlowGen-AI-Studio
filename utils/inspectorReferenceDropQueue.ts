/** 属性面板参考区拖入/中键投放：串行队列，避免并发读同一 cur.length 覆盖槽位（§10.23） */

type QueueTask = () => Promise<void>;

let chain: Promise<void> = Promise.resolve();

export function enqueueInspectorReferenceDrop(task: QueueTask): Promise<void> {
  const run = chain.then(task);
  chain = run.catch(() => undefined);
  return run;
}

/** @internal vitest only */
export function resetInspectorReferenceDropQueueForTests(): void {
  chain = Promise.resolve();
}
