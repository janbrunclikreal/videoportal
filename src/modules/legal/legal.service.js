'use strict';

const db = require('../../config/db');
const { writeLog, LOG_TYPES } = require('../../config/logger');
const config = require('../../config');

/**
 * GDPR/DSA: zaznamená souhlas uživatele.
 * @param {object} entry
 * @param {number} entry.userId
 * @param {'tos'|'upload_rights'|'personal_data'} entry.type
 * @param {string} [entry.tosVersion]
 * @param {boolean} entry.granted
 * @param {string} [entry.ipAddress]
 * @param {string} [entry.userAgent]
 */
function recordConsent({ userId, type, tosVersion = null, granted = true, ipAddress = null, userAgent = null }) {
  if (!userId) throw new Error('userId je povinný pro recordConsent');
  const allowed = ['tos', 'upload_rights', 'personal_data'];
  if (!allowed.includes(type)) throw new Error(`Neznámý typ souhlasu: ${type}`);
  db.run(
    `INSERT INTO consent_log (user_id, consent_type, tos_version, granted, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, tosVersion, granted ? 1 : 0, ipAddress, userAgent]
  );
  writeLog(LOG_TYPES.SECURITY, `Consent uložen: ${type} granted=${granted}`, { userId, tosVersion });
}

function listConsentsForUser(userId) {
  return db.all(
    `SELECT id, consent_type, tos_version, granted, ip_address, user_agent, created_at
     FROM consent_log WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  ).rows;
}

function listTosVersions() {
  return db.all(`SELECT id, version, document_url, summary, effective_at, created_by FROM tos_versions ORDER BY effective_at DESC`).rows;
}

function getCurrentTosVersion() {
  return config.legal.currentTosVersion;
}

// ===== DSA: hlášení obsahu =====
function flagVideo({ videoId, reporterId, reason }) {
  db.run(
    `UPDATE videos SET status = 'flagged' WHERE id = ?`,
    [videoId]
  );
  db.run(
    `INSERT INTO consent_log (user_id, consent_type, granted) VALUES (?, 'flag', 1)`,
    [reporterId]
  );
  writeLog(LOG_TYPES.SECURITY, `Video nahlášeno (id=${videoId})`, { reporterId, reason });
}

function takedownVideo({ videoId, moderatorId, reason }) {
  db.run(
    `UPDATE videos SET status = 'takedown', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [videoId]
  );
  writeLog(LOG_TYPES.SECURITY, `Takedown (id=${videoId})`, { moderatorId, reason });
}

module.exports = {
  recordConsent,
  listConsentsForUser,
  listTosVersions,
  getCurrentTosVersion,
  flagVideo,
  takedownVideo,
};
