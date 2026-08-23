'use strict';

const express = require('express');
const controller = require('./videos.controller');
const { requirePermission, requireLogin } = require('../../middleware/auth');
const { PERMISSIONS } = require('../auth/seed');

const router = express.Router();

// Veřejné čtení
router.get('/', controller.list);
router.get('/categories', controller.categories);
router.get('/:id', controller.detail);

// Upload flow (SPEC C)
router.post(
  '/upload-request',
  requirePermission(PERMISSIONS.UPLOAD_VIDEOS),
  controller.uploadRequest
);
router.post(
  '/:id/confirm',
  requirePermission(PERMISSIONS.UPLOAD_VIDEOS),
  controller.confirmUpload
);

// Edit / delete
router.put('/:id', requirePermission(PERMISSIONS.UPLOAD_VIDEOS), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.DELETE_OWN_VIDEOS), controller.remove);

// Views / stats
router.post('/:id/view', controller.recordView);
router.get('/:id/stats', controller.stats);
router.post('/:id/rate', requireLogin, controller.rate);
router.get('/:id/playback', controller.playback);

// Vlastní videa
router.get('/me/list', requireLogin, controller.myVideos);

module.exports = router;
