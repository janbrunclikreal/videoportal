'use strict';

const usersService = require('./users.service');
const authService = require('../auth/auth.service');
const { HttpError } = require('../../middleware/errorHandler');
const { writeLog, LOG_TYPES } = require('../../config/logger');

function listUsers(req, res, next) {
  try {
    res.json({ users: usersService.listUsers(), roles: usersService.listRoles() });
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      throw new HttpError(400, 'VALIDATION', 'Uživatel i heslo jsou povinné');
    }
    if (password.length < 4) {
      throw new HttpError(400, 'VALIDATION', 'Heslo musí mít alespoň 4 znaky');
    }
    if (await authService.findByUsername(username)) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'Uživatel již existuje');
    }
    const id = await usersService.adminCreateUser({ username, password });
    writeLog(LOG_TYPES.ADMIN, `Admin vytvořil uživatele: ${username}`, {
      by: req.user.username,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
}

function assignRole(req, res, next) {
  try {
    const userId = parseInt(req.params.userId, 10);
    const { roleId } = req.body || {};
    if (!userId || !roleId) {
      throw new HttpError(400, 'VALIDATION', 'userId a roleId jsou povinné');
    }
    usersService.assignRole(userId, roleId, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

function removeRole(req, res, next) {
  try {
    const userId = parseInt(req.params.userId, 10);
    const { roleId } = req.body || {};
    if (!userId || !roleId) {
      throw new HttpError(400, 'VALIDATION', 'userId a roleId jsou povinné');
    }
    usersService.removeRole(userId, roleId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

function deleteUser(req, res, next) {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) throw new HttpError(400, 'VALIDATION', 'userId je povinné');
    if (userId === req.user.id) {
      throw new HttpError(400, 'SELF_DELETE', 'Nemůžete smazat sám sebe');
    }
    usersService.deleteUser(userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function changeOwnPassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      throw new HttpError(400, 'VALIDATION', 'Současné i nové heslo jsou povinné');
    }
    if (newPassword.length < 4) {
      throw new HttpError(400, 'VALIDATION', 'Heslo musí mít alespoň 4 znaky');
    }
    const user = await authService.findById(req.user.id);
    const ok = await authService.verifyAndMaybeRehash(user, currentPassword);
    if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Současné heslo nesouhlasí');
    await authService.changePassword(req.user.id, newPassword);
    writeLog(LOG_TYPES.USER, `Změna hesla`, { user: req.user.username });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function deleteOwnAccount(req, res, next) {
  try {
    const { password } = req.body || {};
    if (!password) throw new HttpError(400, 'VALIDATION', 'Heslo je povinné');
    const user = await authService.findById(req.user.id);
    const ok = await authService.verifyAndMaybeRehash(user, password);
    if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Heslo nesouhlasí');
    usersService.deleteUser(req.user.id);
    const config = require('../../config');
    const sessionId = req.cookies && req.cookies[config.session.cookieName];
    if (sessionId) authService.destroySession(sessionId);
    res.clearCookie(config.session.cookieName);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

function me(req, res, next) {
  try {
    if (!req.user) return res.json({ user: null });
    res.json({ user: req.user });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  createUser,
  assignRole,
  removeRole,
  deleteUser,
  changeOwnPassword,
  deleteOwnAccount,
  me,
};
