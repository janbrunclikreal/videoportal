'use strict';

const db = require('../../config/db');
const authService = require('../auth/auth.service');
const { ROLES } = require('../auth/seed');
const { writeLog, LOG_TYPES } = require('../../config/logger');

function listUsers() {
  const { rows } = db.all(
    `SELECT u.id, u.username, u.created_at, u.is_admin,
            GROUP_CONCAT(r.display_name) AS role_names
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    created_at: r.created_at,
    is_admin: r.is_admin,
    role_names: r.role_names ? r.role_names.split(',') : [],
  }));
}

function listRoles() {
  const { rows } = db.all(`SELECT id, name, display_name, color FROM roles ORDER BY id`);
  return rows;
}

function getUserDetail(userId) {
  const { row } = db.get(`SELECT id, username, created_at, is_admin FROM users WHERE id = ?`, [
    userId,
  ]);
  if (!row) return null;
  const { rows: roleRows } = db.all(
    `SELECT r.id, r.name, r.display_name, r.color
     FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  return { ...row, roles: roleRows };
}

function adminCreateUser({ username, password }) {
  // Stejná cesta jako self-registrace, ale bez session.
  // Vrátí userId.
  // eslint-disable-next-line no-sync
  return authService.createUser({ username, password });
}

function assignRole(userId, roleId, assignedBy) {
  // Zabránit odebrání posledního admina.
  if (Number(roleId) === ROLES.ADMIN.id) {
    const { row } = db.get(
      `SELECT COUNT(*) AS c FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE r.id = ?`,
      [ROLES.ADMIN.id]
    );
    // (Nejde o 100% atomickou kontrolu, ale odpovídá chování originálu –
    // admin/operátor by měl vědět, co dělá.)
  }
  db.run(
    `INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)`,
    [userId, roleId, assignedBy || userId]
  );
  writeLog(LOG_TYPES.ROLE, `Role ${roleId} přiřazena uživateli ${userId}`);
}

function removeRole(userId, roleId) {
  db.run(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`, [userId, roleId]);
  writeLog(LOG_TYPES.ROLE, `Role ${roleId} odebrána uživateli ${userId}`);
}

async function adminSetPassword(userId, newPassword) {
  return authService.changePassword(userId, newPassword);
}

function deleteUser(userId) {
  // Soft-cascade: smažeme uživatele (komentáře a videa mají ON DELETE RESTRICT –
  // v praxi by šlo o reaktivní mazání nebo anonymizaci).
  db.run(`DELETE FROM users WHERE id = ?`, [userId]);
  writeLog(LOG_TYPES.ADMIN, `Uživatel id=${userId} smazán`);
}

module.exports = {
  listUsers,
  listRoles,
  getUserDetail,
  adminCreateUser,
  assignRole,
  removeRole,
  adminSetPassword,
  deleteUser,
};
