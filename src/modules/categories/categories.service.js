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

// Fáze 1 – editace kategorie (přejmenování, změna ikony/barvy).
// Non-breaking: nový service method, existující routes kontrakt se nemění.
function update({ id, name, icon, color }) {
  const { row } = db.get(`SELECT id FROM categories WHERE id = ?`, [id]);
  if (!row) {
    const e = new Error('Kategorie nenalezena.'); e.status = 404; throw e;
  }
  const fields = [];
  const params = [];
  if (name !== undefined) {
    if (!name || !String(name).trim()) {
      const e = new Error('Název nesmí být prázdný.'); e.status = 400; throw e;
    }
    fields.push('name = ?'); params.push(String(name).trim());
  }
  if (icon !== undefined) {
    fields.push('icon = ?'); params.push(icon || '📁');
  }
  if (color !== undefined) {
    fields.push('color = ?'); params.push(color || '#007bff');
  }
  if (fields.length === 0) {
    const e = new Error('Nebyly předány žádné položky k aktualizaci.'); e.status = 400; throw e;
  }
  params.push(id);
  db.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, params);
  writeLog(LOG_TYPES.ADMIN, `Kategorie upravena (id=${id})`, { fields: Object.keys({ name, icon, color }) });
  return { id };
}

module.exports = { list, create, remove, update };
