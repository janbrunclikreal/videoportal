'use strict';

const express = require('express');
const controller = require('./users.controller');
const { requirePermission, requireLogin } = require('../../middleware/auth');
const { PERMISSIONS } = require('../auth/seed');

const router = express.Router();

// Self-service (vlastní profil)
router.get('/me', controller.me);
router.post('/me/password', requireLogin, controller.changeOwnPassword);
router.post('/me/delete', requireLogin, controller.deleteOwnAccount);

// Admin: správa uživatelů
router.get('/', requirePermission(PERMISSIONS.MANAGE_USERS), controller.listUsers);
router.post('/', requirePermission(PERMISSIONS.MANAGE_USERS), controller.createUser);
router.post('/:userId/role', requirePermission(PERMISSIONS.MANAGE_USERS), controller.assignRole);
router.delete(
  '/:userId/role',
  requirePermission(PERMISSIONS.MANAGE_USERS),
  controller.removeRole
);
router.delete(
  '/:userId',
  requirePermission(PERMISSIONS.DELETE_ANY_CONTENT),
  controller.deleteUser
);

module.exports = router;
