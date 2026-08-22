'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../src/config/db');
const { writeLog, LOG_TYPES } = require('../src/config/logger');
const { seedDefaultData } = require('../src/modules/auth/seed');

function applySchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const conn = db.getDb();
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
