'use strict';

const db = require('../../config/db');
const { writeLog, LOG_TYPES } = require('../../config/logger');

function rowToComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    video_id: row.video_id,
    user_id: row.user_id,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    author_username: row.author_username,
    likes: row.likes || 0,
    dislikes: row.dislikes || 0,
    user_like: row.user_like || 0,
  };
}

function listForVideo(videoId, viewerId = null) {
  const { rows } = db.all(
    `SELECT c.*, u.username AS author_username,
            COALESCE(SUM(CASE WHEN cl.like_type = 1 THEN 1 ELSE 0 END), 0) AS likes,
            COALESCE(SUM(CASE WHEN cl.like_type = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
            COALESCE(MAX(CASE WHEN cl.user_id = ? THEN cl.like_type ELSE 0 END), 0) AS user_like
     FROM comments c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN comment_likes cl ON cl.comment_id = c.id
     WHERE c.video_id = ? AND c.deleted_at IS NULL
     GROUP BY c.id
     ORDER BY c.created_at ASC`,
    [viewerId || 0, videoId]
  );
  return rows.map(rowToComment);
}

function getById(id) {
  const { row } = db.get(`SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL`, [id]);
  return row;
}

function create({ videoId, userId, content }) {
  if (!content || !content.trim()) {
    const e = new Error('Komentář je prázdný.'); e.status = 400; throw e;
  }
  const { lastInsertRowid } = db.run(
    `INSERT INTO comments (video_id, user_id, content) VALUES (?, ?, ?)`,
    [videoId, userId, content.trim()]
  );
  writeLog(LOG_TYPES.USER, `Komentář vytvořen (id=${lastInsertRowid})`, { videoId, userId });
  return getById(lastInsertRowid);
}

function update({ id, userId, canModerate, content }) {
  const c = getById(id);
  if (!c) { const e = new Error('Komentář nenalezen.'); e.status = 404; throw e; }
  if (c.user_id !== userId && !canModerate) {
    const e = new Error('Nemáte oprávnění upravit tento komentář.'); e.status = 403; throw e;
  }
  if (!content || !content.trim()) {
    const e = new Error('Komentář je prázdný.'); e.status = 400; throw e;
  }
  db.run(
    `UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [content.trim(), id]
  );
  return getById(id);
}

function softDelete({ id, userId, canModerate }) {
  const c = getById(id);
  if (!c) { const e = new Error('Komentář nenalezen.'); e.status = 404; throw e; }
  if (c.user_id !== userId && !canModerate) {
    const e = new Error('Nemáte oprávnění smazat tento komentář.'); e.status = 403; throw e;
  }
  db.run(
    `UPDATE comments SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id]
  );
  return true;
}

function like({ id, userId, value }) {
  if (![-1, 1].includes(value)) {
    const e = new Error('Hodnota musí být -1 nebo 1.'); e.status = 400; throw e;
  }
  const c = getById(id);
  if (!c) { const e = new Error('Komentář nenalezen.'); e.status = 404; throw e; }
  db.run(
    `INSERT INTO comment_likes (comment_id, user_id, like_type) VALUES (?, ?, ?)
     ON CONFLICT(comment_id, user_id) DO UPDATE SET like_type = excluded.like_type, created_at = CURRENT_TIMESTAMP`,
    [id, userId, value]
  );
  return tally(id);
}

function unlike({ id, userId }) {
  const c = getById(id);
  if (!c) { const e = new Error('Komentář nenalezen.'); e.status = 404; throw e; }
  db.run(`DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?`, [id, userId]);
  return tally(id);
}

function tally(id) {
  const { row } = db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN like_type = 1 THEN 1 ELSE 0 END), 0) AS likes,
       COALESCE(SUM(CASE WHEN like_type = -1 THEN 1 ELSE 0 END), 0) AS dislikes
     FROM comment_likes WHERE comment_id = ?`,
    [id]
  );
  return { likes: row.likes, dislikes: row.dislikes };
}

function getUserLike({ id, userId }) {
  const { row } = db.get(
    `SELECT like_type FROM comment_likes WHERE comment_id = ? AND user_id = ?`,
    [id, userId]
  );
  return row ? row.like_type : 0;
}

module.exports = {
  listForVideo,
  getById,
  create,
  update,
  softDelete,
  like,
  unlike,
  tally,
  getUserLike,
};
