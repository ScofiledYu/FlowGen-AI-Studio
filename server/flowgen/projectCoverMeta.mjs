/** @param {unknown} ext */
export function isManualProjectCover(ext) {
  if (!ext || typeof ext !== 'object') return false;
  return ext.coverSource === 'manual';
}

/**
 * @param {Record<string, unknown>} ext
 * @param {'manual' | 'auto'} source
 */
export function markProjectCoverSource(ext, source) {
  const next = { ...(ext || {}) };
  next.coverSource = source;
  next.coverUpdatedAt = Date.now();
  return next;
}

/** @param {Record<string, unknown>} ext */
export function clearProjectCoverSource(ext) {
  const next = { ...(ext || {}) };
  delete next.coverSource;
  delete next.coverUpdatedAt;
  return next;
}
