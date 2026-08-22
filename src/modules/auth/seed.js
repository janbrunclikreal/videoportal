'use strict';

const bcrypt = require('bcrypt');

const db = require('../../config/db');
const { writeLog, LOG_TYPES } = require('../../config/logger');
const config = require('../../config');

// ===== Definice oprávnění =====
const PERMISSIONS = Object.freeze({
  UPLOAD_VIDEOS: 'upload_videos',
  DELETE_OWN_VIDEOS: 'delete_own_videos',
  EDIT_OWN_PROFILE: 'edit_own_profile',
  MODERATE_COMMENTS: 'moderate_comments',
  MODERATE_VIDEOS: 'moderate_videos',
  MANAGE_CATEGORIES: 'manage_categories',
  EDIT_ALL_VIDEOS: 'edit_all_videos',
  VIEW_ADMIN_PANEL: 'view_admin_panel',
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  DELETE_ANY_CONTENT: 'delete_any_content',
  VIEW_SYSTEM_LOGS: 'view_system_logs',
});

// ===== Definice rolí =====
const ROLES = Object.freeze({
  USER: {
    id: 1,
    name: 'User',
    display_name: 'Uživatel',
    color: '#28a745',
    permissions: [
      PERMISSIONS.UPLOAD_VIDEOS,
      PERMISSIONS.DELETE_OWN_VIDEOS,
      PERMISSIONS.EDIT_OWN_PROFILE,
    ],
  },
  MODERATOR: {
    id: 2,
    name: 'Moderator',
    display_name: 'Moderátor',
    color: '#ffc107',
    permissions: [
      PERMISSIONS.UPLOAD_VIDEOS,
      PERMISSIONS.DELETE_OWN_VIDEOS,
      PERMISSIONS.EDIT_OWN_PROFILE,
      PERMISSIONS.MODERATE_COMMENTS,
      PERMISSIONS.MODERATE_VIDEOS,
    ],
  },
  EDITOR: {
    id: 3,
    name: 'Editor',
    display_name: 'Editor',
    color: '#17a2b8',
    permissions: [
      PERMISSIONS.UPLOAD_VIDEOS,
      PERMISSIONS.DELETE_OWN_VIDEOS,
      PERMISSIONS.EDIT_OWN_PROFILE,
      PERMISSIONS.MODERATE_COMMENTS,
      PERMISSIONS.MODERATE_VIDEOS,
      PERMISSIONS.MANAGE_CATEGORIES,
      PERMISSIONS.EDIT_ALL_VIDEOS,
    ],
  },
  ADMIN: {
    id: 4,
    name: 'Admin',
    display_name: 'Administrátor',
    color: '#dc3545',
    permissions: Object.values(PERMISSIONS),
  },
});

const PERMISSION_CATEGORIES = Object.freeze({
  Uživatelské: [
    PERMISSIONS.UPLOAD_VIDEOS,
    PERMISSIONS.DELETE_OWN_VIDEOS,
    PERMISSIONS.EDIT_OWN_PROFILE,
  ],
  'Moderátorské': [PERMISSIONS.MODERATE_COMMENTS, PERMISSIONS.MODERATE_VIDEOS],
  Editorské: [PERMISSIONS.MANAGE_CATEGORIES, PERMISSIONS.EDIT_ALL_VIDEOS],
  Adminské: [
    PERMISSIONS.VIEW_ADMIN_PANEL,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.DELETE_ANY_CONTENT,
    PERMISSIONS.VIEW_SYSTEM_LOGS,
  ],
});

const PERMISSION_DISPLAY = Object.freeze({
  upload_videos: 'Nahrávání videí',
  delete_own_videos: 'Mazání vlastních videí',
  edit_own_profile: 'Úprava vlastního profilu',
  moderate_comments: 'Moderování komentářů',
  moderate_videos: 'Moderování videí',
  manage_categories: 'Správa kategorií',
  edit_all_videos: 'Úprava všech videí',
  view_admin_panel: 'Zobrazení admin panelu',
  manage_users: 'Správa uživatelů',
  manage_roles: 'Správa rolí',
  delete_any_content: 'Mazání jakéhokoliv obsahu',
  view_system_logs: 'Zobrazení systémových logů',
});

function seedRolesAndPermissions() {
  writeLog(LOG_TYPES.INFO, 'Seed rolí a oprávnění...');

  const insertRole = db.run(
    `INSERT OR REPLACE INTO roles (id, name, display_name, color) VALUES (?, ?, ?, ?)`
  );
  for (const role of Object.values(ROLES)) {
    insertRole.run([role.id, role.name, role.display_name, role.color]);
  }

  const insertPerm = db.run(
    `INSERT OR REPLACE INTO permissions (name, display_name, category) VALUES (?, ?, ?)`
  );
  for (const [category, perms] of Object.entries(PERMISSION_CATEGORIES)) {
    for (const name of perms) {
      insertPerm.run([name, PERMISSION_DISPLAY[name], category]);
    }
  }

  const insertRolePerm = db.run(
    `INSERT OR REPLACE INTO role_permissions (role_id, permission_name) VALUES (?, ?)`
  );
  for (const role of Object.values(ROLES)) {
    for (const perm of role.permissions) {
      insertRolePerm.run([role.id, perm]);
    }
  }
}

function seedCategories() {
  const { row } = db.get(`SELECT COUNT(*) as c FROM categories`);
  if (row && row.c > 0) return;

  const defaults = [
    { name: 'Zábava', icon: '🎬', color: '#ff6b6b' },
    { name: 'Hudba', icon: '🎵', color: '#4ecdc4' },
    { name: 'Vzdělávání', icon: '📚', color: '#45b7d1' },
    { name: 'Hry', icon: '🎮', color: '#96ceb4' },
    { name: 'Sport', icon: '⚽', color: '#feca57' },
    { name: 'Cestování', icon: '✈️', color: '#48dbfb' },
  ];
  const insert = db.run(
    `INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)`
  );
  for (const c of defaults) insert.run([c.name, c.icon, c.color]);
  writeLog(LOG_TYPES.INFO, `Vloženo ${defaults.length} výchozích kategorií`);
}

function migrateAdminUsers() {
  const { rows } = db.all(`SELECT id, username FROM users WHERE is_admin = 1`);
  if (rows.length === 0) {
    const { row: cnt } = db.get(`SELECT COUNT(*) as c FROM users`);
    if (cnt && cnt.c === 0) {
      const passwordHash = bcrypt.hashSync('admin123', 10);
      const { lastInsertRowid } = db.run(
        `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)`,
        ['admin', passwordHash]
      );
      writeLog(LOG_TYPES.INFO, `Výchozí admin vytvořen (id=${lastInsertRowid})`);
      assignRoleToUser(lastInsertRowid, ROLES.ADMIN.id, lastInsertRowid);
    }
    return;
  }
  for (const u of rows) {
    assignRoleToUser(u.id, ROLES.ADMIN.id, u.id);
  }
}

function assignRoleToUser(userId, roleId, assignedBy = null) {
  db.run(
    `INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)`,
    [userId, roleId, assignedBy || userId]
  );
  writeLog(LOG_TYPES.ROLE, `Role ${roleId} přiřazena uživateli ${userId}`);
}

function seedTosVersion() {
  const { row } = db.get(`SELECT id FROM tos_versions WHERE version = ?`, [
    config.legal.currentTosVersion,
  ]);
  if (row) return;
  db.run(
    `INSERT INTO tos_versions (version, summary) VALUES (?, ?)`,
    [
      config.legal.currentTosVersion,
      `Výchozí verze podmínek použití pro VideoPortal v2.`,
    ]
  );
  writeLog(LOG_TYPES.INFO, `Vložena verze ToS ${config.legal.currentTosVersion}`);
}

function seedDefaultData() {
  seedRolesAndPermissions();
  seedCategories();
  seedTosVersion();
  migrateAdminUsers();
}

module.exports = {
  PERMISSIONS,
  ROLES,
  PERMISSION_DISPLAY,
  seedDefaultData,
  seedRolesAndPermissions,
  seedCategories,
  seedTosVersion,
  migrateAdminUsers,
  assignRoleToUser,
};
