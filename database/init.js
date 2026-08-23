'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../src/config/db');
const { writeLog, LOG_TYPES } = require('../src/config/logger');
const { seedDefaultData } = require('../src/modules/auth/seed');

/**
 * Zjistí, jestli schéma odpovídá aktuální verzi.
 * Vrací true, pokud DB vyžaduje migraci.
 */
function needsMigration() {
  const conn = db.getDb();
  const tables = conn
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='videos'`)
    .all();
  if (tables.length === 0) return false; // čerstvá DB, schema ho vytvoří
  const cols = conn.prepare(`PRAGMA table_info(videos)`).all();
  const colNames = new Set(cols.map((c) => c.name));
  // Pokud chybí některé nové sloupce, je to staré schéma.
  const required = ['s3_key', 'status', 'consent_obtained', 'tos_version', 'deleted_at'];
  return required.some((c) => !colNames.has(c));
}

/**
 * Smaže všechny tabulky v DB. Používá se jen při startu, pokud
 * detekujeme staré schéma – v produkci by se psaly inkrementální migrace.
 */
function dropAllTables() {
  const conn = db.getDb();
  const tables = conn
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);
  // foreign_keys vypneme dočasně, abychom mohli smazat v libovolném pořadí.
  conn.pragma('foreign_keys = OFF');
  const dropAll = conn.transaction((names) => {
    for (const name of names) conn.exec(`DROP TABLE IF EXISTS ${name}`);
  });
  dropAll(tables);
  conn.pragma('foreign_keys = ON');
  writeLog(LOG_TYPES.WARNING, `Smazáno ${tables.length} starých tabulek (před novou inicializací)`);
}

function applySchema() {
  const conn = db.getDb();
  if (needsMigration()) {
    writeLog(LOG_TYPES.WARNING, 'Detekováno staré schéma – provádím reset DB');
    dropAllTables();
  }
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  conn.exec(sql);
  writeLog(LOG_TYPES.INFO, 'Schema aplikováno');
}

function main() {
  writeLog(LOG_TYPES.INFO, '=== Inicializace databáze VideoPortal v2 ===');
  applySchema();
  seedDefaultData();
  writeLog(LOG_TYPES.INFO, '=== Databáze připravena ===');
  db.closeDb();
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    writeLog(LOG_TYPES.ERROR, 'Inicializace selhala', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

module.exports = { applySchema };
