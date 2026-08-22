'use strict';

const legalService = require('./legal.service');
const { HttpError } = require('../../middleware/errorHandler');
const { writeLog, LOG_TYPES } = require('../../config/logger');

function currentTos(req, res, next) {
  try {
    res.json({
      version: legalService.getCurrentTosVersion(),
      versions: legalService.listTosVersions(),
    });
  } catch (err) {
    next(err);
  }
}

function myConsents(req, res, next) {
  try {
    res.json({ consents: legalService.listConsentsForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
}

function flag(req, res, next) {
  try {
    const videoId = parseInt(req.params.id, 10);
    if (!videoId) throw new HttpError(400, 'VALIDATION', 'id je povinné');
    const { reason } = req.body || {};
    legalService.flagVideo({ videoId, reporterId: req.user.id, reason });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

function takedown(req, res, next) {
  try {
    const videoId = parseInt(req.params.id, 10);
    if (!videoId) throw new HttpError(400, 'VALIDATION', 'id je povinné');
    const { reason } = req.body || {};
    legalService.takedownVideo({ videoId, moderatorId: req.user.id, reason });
    writeLog(LOG_TYPES.ADMIN, `Moderator takedown (id=${videoId})`, { by: req.user.username, reason });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { currentTos, myConsents, flag, takedown };
