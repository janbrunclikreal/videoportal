'use strict';

const commentsService = require('./comments.service');
const { PERMISSIONS } = require('../auth/seed');
const { HttpError } = require('../../middleware/errorHandler');

function list(req, res, next) {
  try {
    const videoId = parseInt(req.params.videoId, 10);
    const comments = commentsService.listForVideo(videoId, req.user ? req.user.id : null);
    res.json({ comments });
  } catch (err) {
    next(err);
  }
}

function create(req, res, next) {
  try {
    const { video_id, content } = req.body || {};
    if (!video_id) throw new HttpError(400, 'VALIDATION', 'video_id je povinné');
    const c = commentsService.create({ videoId: parseInt(video_id, 10), userId: req.user.id, content });
    res.status(201).json({ comment: c });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const canModerate = req.user.permissions.includes(PERMISSIONS.MODERATE_COMMENTS);
    const c = commentsService.update({
      id,
      userId: req.user.id,
      canModerate,
      content: req.body ? req.body.content : '',
    });
    res.json({ comment: c });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const canModerate = req.user.permissions.includes(PERMISSIONS.MODERATE_COMMENTS);
    commentsService.softDelete({ id, userId: req.user.id, canModerate });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

function like(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const value = parseInt(req.body && req.body.value, 10);
    if (value === 0) {
      const result = commentsService.unlike({ id, userId: req.user.id });
      return res.json({ ok: true, ...result, user_like: 0 });
    }
    const result = commentsService.like({ id, userId: req.user.id, value });
    res.json({ ok: true, ...result, user_like: value });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

function likesCount(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    res.json(commentsService.tally(id));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove, like, likesCount };
