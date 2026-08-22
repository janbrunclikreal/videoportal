'use strict';

const express = require('express');
const controller = require('./comments.controller');
const { requireLogin, requirePermission } = require('../../middleware/auth');
const { PERMISSIONS } = require('../auth/seed');

const router = express.Router({ mergeParams: true });

// GET /api/videos/:videoId/comments
router.get('/videos/:videoId/comments', controller.list);
router.get('/comments', (req, res) => res.json({ comments: [] })); // placeholder pro staré routy

// Vytvoření komentáře vyžaduje přihlášení a právo UPLOAD_VIDEOS
// (stejně jako v monolitiu – komentovat mohou jen registrovaní).
router.post('/comments', requireLogin, requirePermission(PERMISSIONS.UPLOAD_VIDEOS), controller.create);
router.put('/comments/:id', requireLogin, controller.update);
router.delete('/comments/:id', requireLogin, controller.remove);
router.post('/comments/:id/like', requireLogin, controller.like);
router.get('/comments/:id/likes', controller.likesCount);

module.exports = router;
