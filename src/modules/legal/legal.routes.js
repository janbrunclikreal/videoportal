'use strict';

const express = require('express');
const controller = require('./legal.controller');
const { requireLogin, requirePermission } = require('../../middleware/auth');
const { PERMISSIONS } = require('../auth/seed');

const router = express.Router();

// Veřejné: aktuální verze ToS
router.get('/tos', controller.currentTos);

// Přihlášený uživatel: jeho consent audit
router.get('/me/consents', requireLogin, controller.myConsents);

// DSA: nahlášení videa (kdokoliv přihlášený)
router.post('/videos/:id/flag', requireLogin, controller.flag);

// Takedown – jen moderátor/editor/admin
router.post(
  '/videos/:id/takedown',
  requirePermission(PERMISSIONS.MODERATE_VIDEOS),
  controller.takedown
);

module.exports = router;
