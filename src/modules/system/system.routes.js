'use strict';

const express = require('express');
const controller = require('./system.controller');
const { requirePermission } = require('../../middleware/auth');
const { PERMISSIONS } = require('../auth/seed');

const router = express.Router();

router.get('/logs', requirePermission(PERMISSIONS.VIEW_SYSTEM_LOGS), controller.logs);
router.get('/stats', requirePermission(PERMISSIONS.VIEW_ADMIN_PANEL), controller.stats);

module.exports = router;
