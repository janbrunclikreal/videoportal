'use strict';

const systemService = require('./system.service');

function logs(req, res, next) {
  try {
    const { limit, date } = req.query;
    res.json({
      logs: systemService.listRecentLogs({
        limit: limit ? Math.min(parseInt(limit, 10), 1000) : 200,
        date: date || null,
      }),
    });
  } catch (err) { next(err); }
}

function stats(req, res, next) {
  try { res.json({ stats: systemService.adminStats() }); } catch (err) { next(err); }
}

module.exports = { logs, stats };
