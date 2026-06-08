/** @param {string} iso */
export function toSqlDatetime(iso) {
  if (!iso) return new Date().toISOString().slice(0, 23).replace('T', ' ');
  return String(iso).slice(0, 23).replace('T', ' ');
}

/** @param {unknown} v */
export function parseJsonCol(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

/** @param {unknown} v */
export function stringifyJsonCol(v) {
  if (v == null) return null;
  return JSON.stringify(v);
}
