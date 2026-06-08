import { getPool } from '../db.mjs';
import { parseJsonCol, stringifyJsonCol, toSqlDatetime } from './jsonCol.mjs';

function rowToChat(row) {
  const messages = parseJsonCol(row.messages, []) || [];
  return {
    modelId: row.model_id,
    messages,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    userId: row.user_id,
    projectId: row.project_id || undefined,
  };
}

export async function getChatSession(chatId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_chat_sessions WHERE chat_id = ? LIMIT 1', [
    chatId,
  ]);
  return rows[0] ? rowToChat(rows[0]) : null;
}

export async function upsertChatSession(chatId, record) {
  const pool = getPool();
  const messages = Array.isArray(record.messages) ? record.messages.slice(-200) : [];
  const now = toSqlDatetime(record.updatedAt || new Date().toISOString());
  await pool.query(
    `INSERT INTO flowgen_chat_sessions
      (chat_id, user_id, project_id, model_id, messages, message_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      project_id = VALUES(project_id),
      model_id = VALUES(model_id),
      messages = VALUES(messages),
      message_count = VALUES(message_count),
      updated_at = VALUES(updated_at)`,
    [
      chatId,
      record.userId,
      record.projectId || null,
      record.modelId || '',
      stringifyJsonCol(messages),
      messages.length,
      now,
    ]
  );
}

export async function deleteChatSession(chatId) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_chat_sessions WHERE chat_id = ?', [chatId]);
}

export async function deleteChatByProjectId(projectId) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_chat_sessions WHERE project_id = ?', [projectId]);
}

export async function listChatSessionsForUser(user, { projectId } = {}) {
  const pool = getPool();
  let sql =
    'SELECT chat_id, user_id, project_id, model_id, message_count, updated_at, messages FROM flowgen_chat_sessions WHERE user_id = ?';
  /** @type {unknown[]} */
  const params = [user.id];
  if (projectId) {
    sql += ' AND project_id = ?';
    params.push(projectId);
  }
  sql += ' ORDER BY updated_at DESC LIMIT 500';
  const [rows] = await pool.query(sql, params);
  const pickFirstMessage = (messages) => {
    const list = parseJsonCol(messages, []);
    if (!Array.isArray(list) || list.length === 0) return '';
    const firstUser = list.find((m) => String(m?.role || '') === 'user' && String(m?.content || '').trim());
    if (firstUser) return String(firstUser.content || '').trim().slice(0, 120);
    const firstAny = list.find((m) => String(m?.content || '').trim());
    return firstAny ? String(firstAny.content || '').trim().slice(0, 120) : '';
  };
  return rows.map((r) => ({
    chatId: r.chat_id,
    userId: r.user_id,
    projectId: r.project_id || undefined,
    modelId: r.model_id,
    messageCount: r.message_count,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    firstMessage: pickFirstMessage(r.messages),
  }));
}
