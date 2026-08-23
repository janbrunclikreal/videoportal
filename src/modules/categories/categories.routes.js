'use strict';

const express = require('express');
const controller = require('./categories.controller');
const { requirePermission } = require('../../middleware/auth');
const { PERMISSIONS } = require('../auth/seed');

const router = express.Router();

router.get('/', controller.list);
router.post('/', requirePermission(PERMISSIONS.MANAGE_CATEGORIES), controller.create);
// Fáze 1 – PUT pro editaci kategorie (přejmenování, ikona, barva).
// Non-breaking rozšíření – existující routes (GET/POST/DELETE) zůstávají beze změny.
router.put('/:id', requirePermission(PERMISSIONS.MANAGE_CATEGORIES), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.MANAGE_CATEGORIES), controller.remove);

module.exports = router;
