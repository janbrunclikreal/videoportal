'use strict';

const config = require('../../config');

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const db = require('../../config/db');
const { writeLog, LOG_TYPES } = require('../../config/logger');
const { ROLES, assignRoleToUser } = require('./seed');
// Lazy require – legal modul přichází v pozdějším commitu.
const recordConsent = (entry) => require('../legal/legal.service').recordConsent(entry);

// ===== Hesla =====
// Bezpečné hashování přes bcrypt (salt + adaptive cost).
async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

// Zpětná kompatibilita: kdyby v DB zůstaly staré SHA-256 hashe, akceptujeme
// je jednou a při příští změně hesla přepíšeme na bcrypt.
function isLegacySha256Hash(hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash);
}

function legacyHash(plain) {
  return crypto.createHash('sha256').update(plain + 'salt').digest('hex');
}

async function verifyAndMaybeRehash(user, plain) {
  if (await verifyPassword(plain, user.password_hash)) {
    return true;
  }
  if (isLegacySha256Hash(user.password_hash) && legacyHash(plain) === user.password_hash) {
    // Přehashuj na bcrypt pro příště.
    const fresh = await hashPassword(plain);
    db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [fresh, user.id]);
    writeLog(LOG_TYPES.SECURITY, `Přehashováno heslo (legacy SHA-256) pro user id=${user.id}`);
    return true;
  }
  return false;
}

// ===== User CRUD =====
async function findByUsername(username) {
  const { row } = db.get(`SELECT * FROM users WHERE username = ?`, [username]);
  return row || null;
}

async function findById(id) {
  const { row } = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
  return row || null;
}

async function createUser({ username, password }) {
  const hash = await hashPassword(password);
  const { lastInsertRowid } = db.run(
    `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)`,
    [username, hash]
  );
  // Každý nový uživatel dostane default roli USER.
  assignRoleToUser(lastInsertRowid, ROLES.USER.id, lastInsertRowid);
  // GDPR: evidence souhlasu s podmínkami při registraci.
  recordConsent({
    userId: lastInsertRowid,
    type: 'tos',
    granted: true,
  });
  return lastInsertRowid;
}

async function changePassword(userId, newPassword) {
  const hash = await hashPassword(newPassword);
  db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, userId]);
}

async function deleteUser(userId) {
  db.run(`DELETE FROM users WHERE id = ?`, [userId]);
}

// ===== Role / permissions loader =====
async function loadUserWithRoles(userId) {
  const user = await findById(userId);
  if (!user) return null;

  const { rows: roleRows } = db.all(
    `SELECT r.id, r.name, r.display_name, r.color
     FROM user_roles ur
     JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [userId]
  );

  let roles = roleRows;
  let permissions = [];

  if (roles.length === 0) {
    assignRoleToUser(userId, ROLES.USER.id, userId);
    roles = [{
      id: ROLES.USER.id,
      name: ROLES.USER.name,
      display_name: ROLES.USER.display_name,
      color: ROLES.USER.color,
    }];
    permissions = ROLES.USER.permissions.slice();
  } else {
    const roleIds = roles.map((r) => r.id);
    const placeholders = roleIds.map(() => '?').join(',');
    const { rows: permRows } = db.all(
      `SELECT DISTINCT rp.permission_name
       FROM role_permissions rp
       WHERE rp.role_id IN (${placeholders})`,
      roleIds
    );
    permissions = permRows.map((r) => r.permission_name);
  }

  return {
    id: user.id,
    username: user.username,
    created_at: user.created_at,
    is_admin: user.is_admin,
    roles,
    permissions,
  };
}

function hasPermission(user, permission) {
  if (!user || !Array.isArray(user.permissions)) return false;
  return user.permissions.includes(permission);
}

// ===== Session (Fáze 2: perzistentní v SQLite) =====
// API beze změny: createSession / getSession / destroySession. Storage se
// přesunul z in-memory `Map` do tabulky `sessions` – sessions přežijí restart
// kontejneru. Lazy cleanup expired řádků proběhne při getSession (1% šance
// na každý lookup, aby to nebylo za trest).
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(userId) {
  const id = generateSessionId();
  const ttlMs = config.session.ttlMs;
  const expiresAt = new Date(Date.now() + ttlMs);
  db.run(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
    [id, userId, expiresAt.toISOString()]
  );
  return id;
}

function destroySession(sessionId) {
  if (!sessionId) return;
  db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}

function getSession(sessionId) {
  if (!sessionId) return undefined;
  // Lazy cleanup 1% případů – odstraní prošlé sessions.
  if (Math.random() < 0.01) {
    try {
      db.run(`DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`);
    } catch (err) {
      writeLog(LOG_TYPES.WARNING, 'Session cleanup selhal', { error: err.message });
    }
  }
  const { row } = db.get(
    `SELECT id, user_id, created_at, expires_at
     FROM sessions
     WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`,
    [sessionId]
  );
  if (!row) return undefined;
  return { userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at };
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyAndMaybeRehash,
  findByUsername,
  findById,
  createUser,
  changePassword,
  deleteUser,
  loadUserWithRoles,
  hasPermission,
  createSession,
  destroySession,
  getSession,
};
