'use strict';

const fs = require('fs');
const path = require('path');

const LOG_TYPES = Object.freeze({
  INFO: 'INFO',
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  USER: 'USER',
  DATABASE: 'DATABASE',
  UPLOAD: 'UPLOAD',
  REQUEST: 'REQUEST',
  SECURITY: 'SECURITY',
  ROLE: 'ROLE',
  ADMIN: 'ADMIN',
});

function getTimestamp() {
  return new Date().toLocaleString('cs-CZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Prague',
  });
}

function ensureLogsDir() {
  const dir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

let logsDirReady = false;

function writeLog(type, message, data = null) {
  const timestamp = getTimestamp();
  const line = `[${timestamp}] [${String(type).toUpperCase()}] ${message}${
    data ? ' | Data: ' + JSON.stringify(data) : ''
  }\n`;

  process.stdout.write(`📝 ${line.trim()}\n`);

  try {
    if (!logsDirReady) ensureLogsDir();
    const today = new Date().toISOString().split('T')[0];
    fs.appendFileSync(path.join(process.cwd(), 'logs', `videoportal-${today}.log`), line, {
      encoding: 'utf8',
    });
  } catch (err) {
    // Logování do souboru nesmí shodit request – chybu jen pošleme na stderr.
    process.stderr.write(`Logger file write failed: ${err.message}\n`);
  }
}

function requestLogger(req, res, next) {
  const start = Date.now();
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const method = req.method;
  const url = req.url;

  writeLog(LOG_TYPES.REQUEST, `${method} ${url}`, {
    ip,
    userAgent,
    user: req.user ? req.user.username : 'anonymous',
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    writeLog(LOG_TYPES.REQUEST, `${method} ${url} - ${res.statusCode} (${duration}ms)`, {
      ip,
      statusCode: res.statusCode,
      duration,
      user: req.user ? req.user.username : 'anonymous',
    });
  });

  next();
}

module.exports = {
  LOG_TYPES,
  writeLog,
  requestLogger,
};
