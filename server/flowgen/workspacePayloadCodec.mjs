import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const WORKSPACE_GZIP_KEY = '__flowgen_gzip_v1__';
/** gzip workspace JSON when uncompressed size exceeds this */
export const WORKSPACE_COMPRESS_THRESHOLD = 512 * 1024;
/** Reject stored payload above ~3.5MB even after compression */
export const WORKSPACE_MAX_STORED_BYTES = 3.5 * 1024 * 1024;

/**
 * @param {unknown} payloadObj
 * @returns {Promise<{ stored: unknown; storedBytes: number; uncompressedBytes: number }>}
 */
export async function encodeWorkspacePayloadForDb(payloadObj) {
  const json = JSON.stringify(payloadObj ?? null);
  const uncompressedBytes = Buffer.byteLength(json, 'utf8');
  if (uncompressedBytes <= WORKSPACE_COMPRESS_THRESHOLD) {
    return { stored: payloadObj ?? null, storedBytes: uncompressedBytes, uncompressedBytes };
  }
  const compressed = await gzip(Buffer.from(json, 'utf8'), { level: 6 });
  const b64 = compressed.toString('base64');
  const stored = { [WORKSPACE_GZIP_KEY]: b64 };
  const storedBytes = Buffer.byteLength(JSON.stringify(stored), 'utf8');
  if (storedBytes >= uncompressedBytes) {
    return { stored: payloadObj ?? null, storedBytes: uncompressedBytes, uncompressedBytes };
  }
  if (storedBytes > WORKSPACE_MAX_STORED_BYTES) {
    const err = new Error('工程数据过大，无法保存到数据库');
    err.code = 'WORKSPACE_PAYLOAD_TOO_LARGE';
    err.uncompressedBytes = uncompressedBytes;
    err.storedBytes = storedBytes;
    throw err;
  }
  return { stored, storedBytes, uncompressedBytes };
}

/**
 * @param {unknown} raw
 * @returns {Promise<unknown>}
 */
export async function decodeWorkspacePayloadFromDb(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const wrapped = /** @type {Record<string, unknown>} */ (raw);
  if (!(WORKSPACE_GZIP_KEY in wrapped)) return raw;
  const b64 = wrapped[WORKSPACE_GZIP_KEY];
  if (typeof b64 !== 'string' || !b64) return raw;
  const out = await gunzip(Buffer.from(b64, 'base64'));
  return JSON.parse(out.toString('utf8'));
}
