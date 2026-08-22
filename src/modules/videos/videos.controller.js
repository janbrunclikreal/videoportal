'use strict';

const videosService = require('./videos.service');
const storage = require('../storage/storage.service');
const { HttpError } = require('../../middleware/errorHandler');
const { writeLog, LOG_TYPES } = require('../../config/logger');
const { PERMISSIONS } = require('../auth/seed');

// ===== Čtení =====
async function list(req, res, next) {
  try {
    const { search, category } = req.query;
    const videos = videosService.listPublic({
      search: search || '',
      categoryId: category ? parseInt(category, 10) : null,
    });
    // Přidáme playback URL paralelně (best-effort).
    const enriched = await Promise.all(
      videos.map(async (v) => ({
        ...v,
        playback_url: await storage.getPlaybackUrl(v),
      }))
    );
    res.json({ videos: enriched });
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const video = videosService.getById(id);
    if (!video) throw new HttpError(404, 'NOT_FOUND', 'Video nenalezeno');
    if (video.status !== 'published' && (!req.user || (req.user.id !== video.user_id && !req.user.permissions.includes(PERMISSIONS.MODERATE_VIDEOS)))) {
      throw new HttpError(403, 'FORBIDDEN', 'Toto video není veřejně dostupné');
    }
    const playback_url = await storage.getPlaybackUrl(video);
    const userRating = req.user ? videosService.getUserRating({ videoId: id, userId: req.user.id }) : 0;
    res.json({ video: { ...video, playback_url }, userRating });
  } catch (err) {
    next(err);
  }
}

async function categories(req, res, next) {
  try {
    res.json({ categories: videosService.listCategories() });
  } catch (err) {
    next(err);
  }
}

async function myVideos(req, res, next) {
  try {
    res.json({ videos: videosService.listByUser(req.user.id) });
  } catch (err) {
    next(err);
  }
}

// ===== Upload flow (SPEC C) =====
async function uploadRequest(req, res, next) {
  try {
    const { title, description, category_id, visibility, consent_obtained, tos_version, filename, content_type } = req.body || {};
    if (!title || !visibility) {
      throw new HttpError(400, 'VALIDATION', 'title a visibility jsou povinné');
    }
    if (!filename) {
      throw new HttpError(400, 'VALIDATION', 'filename (originální název) je povinný pro S3 upload');
    }
    const { videoId, uploadUrl, s3Key } = await videosService.createUploadRequest({
      user: req.user,
      title,
      description,
      categoryId: category_id,
      visibility,
      consentObtained: !!consent_obtained,
      tosVersion: tos_version,
      originalFilename: filename,
      contentType: content_type,
    });
    res.status(201).json({ videoId, s3Key, uploadUrl });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

async function confirmUpload(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { tos_version } = req.body || {};
    const video = await videosService.confirmUpload({ videoId: id, user: req.user, tosVersion: tos_version });
    res.json({ video });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

// ===== Edit / delete =====
async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const canEditAll = req.user.permissions.includes(PERMISSIONS.EDIT_ALL_VIDEOS);
    const video = videosService.update({
      videoId: id,
      user: req.user,
      canEditAll,
      patch: {
        title: req.body.title,
        description: req.body.description,
        categoryId: req.body.category_id,
        visibility: req.body.visibility,
      },
    });
    res.json({ video });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const canDeleteAny = req.user.permissions.includes(PERMISSIONS.DELETE_ANY_CONTENT);
    await videosService.softDelete({ videoId: id, user: req.user, canDeleteAny });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

// ===== Statistiky / views =====
async function recordView(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    videosService.recordView({
      videoId: id,
      userId: req.user ? req.user.id : null,
      ip: req.ip,
      duration: req.body ? parseInt(req.body.duration || 0, 10) : 0,
      completed: !!(req.body && req.body.completed),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function stats(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    res.json({ stats: videosService.getStats(id) });
  } catch (err) {
    next(err);
  }
}

function rate(req, res, next) {
  try {
    const id = parseInt(req.params.id || req.body.video_id, 10);
    const value = parseInt(req.body.rating, 10);
    const result = videosService.rateVideo({ videoId: id, userId: req.user.id, value });
    res.json(result);
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, err.code || 'ERROR', err.message));
    next(err);
  }
}

module.exports = {
  list,
  detail,
  categories,
  myVideos,
  uploadRequest,
  confirmUpload,
  update,
  remove,
  recordView,
  stats,
  rate,
};
