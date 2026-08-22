'use strict';

const express = require('express');
const controller = require('./categories.controller');
const { requirePermission } = require('../../middleware/auth');
const { PERMISSIONS } = require('../auth/seed');

const router = express.Router();

router.get('/', controller.list);
router.post('/', requirePermission(PERMISSIONS.MANAGE_CATEGORIES), controller.create);
router.delete('/:id', requirePermission(PERMISSIONS.MANAGE_CATEGORIES), controller.remove);

module.exports = router;
