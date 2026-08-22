'use strict';

const db = require('../../config/db');
const { writeLog, LOG_TYPES } = require('../../config/logger');

function list() {
  return db.all(`SELECT * FROM categories ORDER BY name`).rows;
}

function create({ name, icon, color }) {
  if (!name) { const e = new Error('Název je povinný.'); e.status = 400; throw e; }
  const { lastInsertRowid } = db.run(
    `INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)`,
    [name, icon || '📁', color || '#007bff']
  );
  writeLog(LOG_TYPES.ADMIN, `Kategorie vytvořena (id=${lastInsertRowid})`, { name });
  return lastInsertRowid;
}

function remove(id) {
  db.run(`DELETE FROM categories WHERE id = ?`, [id]);
  writeLog(LOG_TYPES.ADMIN, `Kategorie smazána (id=${id})`);
}

module.exports = { list, create, remove };
