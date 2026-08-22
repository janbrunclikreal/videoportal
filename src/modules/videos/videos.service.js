'use strict';

const path = require('path');

const db = require('../../config/db');
const storage = require('../storage/storage.service');
const { writeLog, LOG_TYPES } = require('../../config/logger');

const VISIBILITY = Object.freeze(['public', 'private', 'unlisted']);
const STATUS = Object.freeze(['pending', 'published', 'flagged', 'takedown', 'deleted']);

function rowToVideo(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    filename: row.filename,
    upload_date: row.upload_date,
    views: row.views,
    size: row.size,
    duration: row.duration,
    user_id: row.user_id,
    category_id: row.category_id,
    visibility: row.visibility,
    s3_key: row.s3_key,
    status: row.status,
    consent_obtained: !!row.consent_obtained,
    tos_version: row.tos_version,
    deleted_at: row.deleted_at,
  };
}

// ===== Čtení =====
function listPublic({ search = '', categoryId = null, limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [`v.status = 'published'`, `v.deleted_at IS NULL`];

  if (search) {
    where.push(`(v.title LIKE ? OR v.description LIKE ?)`);
    const s = `%${search}%`;
    params.push(s, s);
  }
  if (categoryId) {
    where.push(`v.category_id = ?`);
    params.push(categoryId);
  }

  const sql = `
    SELECT v.*, u.username AS author_username, c.name AS category_name, c.icon AS category_icon
    FROM videos v
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN categories c ON c.id = v.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY v.upload_date DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  return db.all(sql, params).rows.map((r) => ({ ...rowToVideo(r), author_username: r.author_username, category_name: r.category_name, category_icon: r.category_icon }));
}

function getById(id) {
  const { row } = db.get(`SELECT * FROM videos WHERE id = ? AND deleted_at IS NULL`, [id]);
  return rowToVideo(row);
}

function listByUser(userId) {
  const { rows } = db.all(
    `SELECT * FROM videos WHERE user_id = ? AND deleted_at IS NULL ORDER BY upload_date DESC`,
    [userId]
  );
  return rows.map(rowToVideo);
}

function listCategories() {
  return db.all(`SELECT * FROM categories ORDER BY name`).rows;
}

// ===== Upload flow (SPEC C) =====
async function createUploadRequest({ user, title, description, categoryId, visibility, consentObtained, tosVersion, originalFilename, contentType }) {
  if (!VISIBILITY.includes(visibility)) {
    const e = new Error('Neplatná hodnota viditelnosti.');
    e.status = 400; e.code = 'VALIDATION';
    throw e;
  }
  if (!consentObtained) {
    const e = new Error('Chybí potvrzení o autorských právech (consent_obtained).');
    e.status = 400; e.code = 'CONSENT_REQUIRED';
    throw e;
  }
  if (!tosVersion) {
    const e = new Error('Chybí verze ToS, se kterou autor souhlasil.');
    e.status = 400; e.code = 'TOS_REQUIRED';
    throw e;
  }

  // Vytvoříme záznam ve stavu 'pending' ještě před uploadem.
  // Předem si ale ověříme S3 (vygenerujeme klíč), aby v DB neležely mrtvé záznamy.
  const { key, uploadUrl } = await storage.createUploadUrl({
    ownerId: user.id,
    originalFilename,
    contentType,
  });

  // filename placeholder – skutečný soubor je v S3 pod s3_key.
  const placeholder = path.basename(key);
  const { lastInsertRowid } = db.run(
    `INSERT INTO videos
       (title, description, filename, user_id, size, category_id, visibility, s3_key, status, consent_obtained, tos_version)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'pending', 1, ?)`,
    [title, description || '', placeholder, user.id, categoryId || null, visibility, key, tosVersion]
  );
  writeLog(LOG_TYPES.UPLOAD, `Upload request vytvořen (id=${lastInsertRowid})`, { key });
  return { videoId: lastInsertRowid, uploadUrl, s3Key: key };
}

async function confirmUpload({ videoId, user, tosVersion }) {
  const v = getById(videoId);
  if (!v) {
    const e = new Error('Video nenalezeno.'); e.status = 404; e.code = 'NOT_FOUND'; throw e;
  }
  if (v.user_id !== user.id) {
    const e = new Error('Nemáte oprávnění potvrdit toto video.'); e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }
  if (v.status !== 'pending') {
    const e = new Error('Video je ve stavu, který neumožňuje potvrzení.'); e.status = 409; e.code = 'INVALID_STATE'; throw e;
  }
  // Ověříme, že objekt v S3 skutečně existuje.
  const head = await storage.headObject(v.s3_key);
  if (!head) {
    const e = new Error('Soubor v S3 nebyl nalezen. Upload se nezdařil.');
    e.status = 400; e.code = 'UPLOAD_INCOMPLETE';
    throw e;
  }
  db.run(
    `UPDATE videos SET status = 'published', size = ? WHERE id = ?`,
    [head.size, videoId]
  );
  // GDPR audit
  const recordConsent = (e) => require('../legal/legal.service').recordConsent(e);
  recordConsent({
    userId: user.id,
    type: 'upload_rights',
    tosVersion,
    granted: true,
  });
  writeLog(LOG_TYPES.UPLOAD, `Upload potvrzen`, { videoId, size: head.size });
  return getById(videoId);
}

// ===== Edit / smazání =====
function update({ videoId, user, canEditAll, patch }) {
  const v = getById(videoId);
  if (!v) { const e = new Error('Video nenalezeno.'); e.status = 404; throw e; }
  if (v.user_id !== user.id && !canEditAll) {
    const e = new Error('Nemáte oprávnění.'); e.status = 403; throw e;
  }
  const fields = [];
  const params = [];
  if (patch.title !== undefined) { fields.push('title = ?'); params.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); params.push(patch.description); }
  if (patch.categoryId !== undefined) { fields.push('category_id = ?'); params.push(patch.categoryId); }
  if (patch.visibility !== undefined) {
    if (!VISIBILITY.includes(patch.visibility)) { const e = new Error('Neplatná viditelnost.'); e.status = 400; throw e; }
    fields.push('visibility = ?'); params.push(patch.visibility);
  }
  if (fields.length === 0) return v;
  params.push(videoId);
  db.run(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`, params);
  return getById(videoId);
}

async function softDelete({ videoId, user, canDeleteAny }) {
  const v = getById(videoId);
  if (!v) { const e = new Error('Video nenalezeno.'); e.status = 404; throw e; }
  if (v.user_id !== user.id && !canDeleteAny) {
    const e = new Error('Nemáte oprávnění.'); e.status = 403; throw e;
  }
  db.run(
    `UPDATE videos SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [videoId]
  );
  // S3 objekt necháme – auditní stopa, smaže se jobem / na explicitní purge.
  await storage.deleteObject(v.s3_key);
  return true;
}

// ===== Statistiky / views =====
function recordView({ videoId, userId = null, ip = null, duration = 0, completed = false }) {
  db.run(
    `INSERT INTO video_views (video_id, user_id, viewer_ip, watch_duration, completed) VALUES (?, ?, ?, ?, ?)`,
    [videoId, userId, ip, duration, completed ? 1 : 0]
  );
  db.run(`UPDATE videos SET views = views + 1 WHERE id = ?`, [videoId]);
}

function getStats(videoId) {
  const { row: total } = db.get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(watch_duration), 0) AS total_duration,
            COALESCE(SUM(completed), 0) AS completed
     FROM video_views WHERE video_id = ?`,
    [videoId]
  );
  return {
    totalViews: total.c || 0,
    totalWatchSeconds: total.total_duration || 0,
    completedViews: total.completed || 0,
  };
}

// ===== Hodnocení =====
function rateVideo({ videoId, userId, value }) {
  if (![-1, 1].includes(value)) { const e = new Error('Hodnota musí být -1 nebo 1.'); e.status = 400; throw e; }
  db.run(
    `INSERT INTO ratings (video_id, user_id, rating) VALUES (?, ?, ?)
     ON CONFLICT(video_id, user_id) DO UPDATE SET rating = excluded.rating, created_at = CURRENT_TIMESTAMP`,
    [videoId, userId, value]
  );
  const { row: agg } = db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) AS likes,
       COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) AS dislikes
     FROM ratings WHERE video_id = ?`,
    [videoId]
  );
  return { likes: agg.likes, dislikes: agg.dislikes };
}

function getUserRating({ videoId, userId }) {
  const { row } = db.get(`SELECT rating FROM ratings WHERE video_id = ? AND user_id = ?`, [
    videoId,
    userId,
  ]);
  return row ? row.rating : 0;
}

module.exports = {
  VISIBILITY,
  STATUS,
  rowToVideo,
  listPublic,
  getById,
  listByUser,
  listCategories,
  createUploadRequest,
  confirmUpload,
  update,
  softDelete,
  recordView,
  getStats,
  rateVideo,
  getUserRating,
};
