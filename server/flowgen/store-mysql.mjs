/**
 * MySQL chunked snapshot (mirrors store.json). Large JSON is gzip'd then split into ~900KB parts.
 */
import zlib from 'zlib';
import { promisify } from 'util';
import { getPool } from './db.mjs';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const SNAPSHOT_ID = 1;
const COMPRESS_THRESHOLD = 512 * 1024;
/** Keep each INSERT under default 4MB max_allowed_packet */
const CHUNK_BYTES = 900 * 1024;

function isGzipBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

async function encodePayload(payloadJson) {
  const buf = Buffer.from(payloadJson, 'utf8');
  if (buf.length <= COMPRESS_THRESHOLD) return buf;
  return gzip(buf, { level: 6 });
}

async function decodePayload(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  if (isGzipBuffer(buf)) {
    const out = await gunzip(buf);
    return out.toString('utf8');
  }
  return buf.toString('utf8');
}

async function loadLegacySnapshot(pool) {
  const [rows] = await pool.query(
    'SELECT payload FROM flowgen_store_snapshot WHERE id = ? LIMIT 1',
    [SNAPSHOT_ID]
  );
  if (!rows.length || rows[0].payload == null) return null;
  return decodePayload(rows[0].payload);
}

export async function loadStoreFromMysql() {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT part, payload FROM flowgen_store_chunk WHERE snapshot_id = ? ORDER BY part ASC',
    [SNAPSHOT_ID]
  );
  if (rows.length > 0) {
    const combined = Buffer.concat(
      rows.map((r) => (Buffer.isBuffer(r.payload) ? r.payload : Buffer.from(r.payload)))
    );
    return decodePayload(combined);
  }
  return loadLegacySnapshot(pool);
}

export async function saveStoreToMysql(payloadJson) {
  const pool = getPool();
  const stored = await encodePayload(payloadJson);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM flowgen_store_chunk WHERE snapshot_id = ?', [SNAPSHOT_ID]);
    const parts = Math.max(1, Math.ceil(stored.length / CHUNK_BYTES));
    for (let part = 0; part < parts; part++) {
      const slice = stored.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES);
      await conn.query(
        'INSERT INTO flowgen_store_chunk (snapshot_id, part, payload) VALUES (?, ?, ?)',
        [SNAPSHOT_ID, part, slice]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function mysqlSnapshotExists() {
  const pool = getPool();
  const [chunks] = await pool.query(
    'SELECT 1 AS ok FROM flowgen_store_chunk WHERE snapshot_id = ? LIMIT 1',
    [SNAPSHOT_ID]
  );
  if (chunks.length > 0) return true;
  const [legacy] = await pool.query(
    'SELECT 1 AS ok FROM flowgen_store_snapshot WHERE id = ? LIMIT 1',
    [SNAPSHOT_ID]
  );
  return legacy.length > 0;
}
