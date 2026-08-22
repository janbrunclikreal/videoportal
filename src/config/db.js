'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('./index');
const { writeLog, LOG_TYPES } = require('./logger');

let db;

function ensureDbDir() {
  const dbPath = path.isAbsolute(config.db.path)
    ? config.db.path
    : path.join(process.cwd(), config.db.path);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dbPath;
}

function getDb() {
  if (db) return db;
  const dbPath = ensureDbDir();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  writeLog(LOG_TYPES.DATABASE, `Databáze otevřena: ${dbPath}`);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

/**
 * Spustí parametrizovaný SQL dotaz.
 * - `run` (INSERT/UPDATE/DELETE)  → { lastInsertRowid, changes }
 * - `get` (SELECT ... LIMIT 1)    → { row } | { row: undefined }
 * - `all` (SELECT)                → { rows: [] }
 *
 * Parametry jsou vždy předány přes prepared statement – žádná
 * string-interpolace do SQL, žádné child_process exec.
 */
function query(sql, params = [], mode = 'all') {
  const conn = getDb();
  const stmt = conn.prepare(sql);
  try {
    if (mode === 'run') {
      const info = stmt.run(...params);
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    }
    if (mode === 'get') {
      const row = stmt.get(...params);
      return { row };
    }
    const rows = stmt.all(...params);
    return { rows };
  } catch (err) {
    writeLog(LOG_TYPES.ERROR, 'DB error', { sql, error: err.message });
    throw err;
  }
}

const run = (sql, params = []) => query(sql, params, 'run');
const get = (sql, params = []) => query(sql, params, 'get');
const all = (sql, params = []) => query(sql, params, 'all');

function transaction(fn) {
  const conn = getDb();
  return conn.transaction(fn)();
}

module.exports = {
  getDb,
  closeDb,
  run,
  get,
  all,
  transaction,
  query,
};
