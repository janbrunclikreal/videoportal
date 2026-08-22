'use strict';

const fs = require('fs');
const path = require('path');

function listRecentLogs({ limit = 200, date = null } = {}) {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) return [];
  const target = date || new Date().toISOString().split('T')[0];
  const file = path.join(logsDir, `videoportal-${target}.log`);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  return lines.slice(-limit).reverse();
}

function adminStats() {
  // Lehký statistický endpoint pro admin dashboard – data z DB.
  const db = require('../../config/db');
  const counts = {};
  for (const t of ['users', 'videos', 'comments', 'categories', 'ratings', 'video_views', 'comment_likes']) {
    const { row } = db.get(`SELECT COUNT(*) AS c FROM ${t}`);
    counts[t] = row.c;
  }
  return counts;
}

module.exports = { listRecentLogs, adminStats };
