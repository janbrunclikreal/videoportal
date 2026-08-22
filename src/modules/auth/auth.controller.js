'use strict';

const config = require('../../config');
const authService = require('./auth.service');
const { HttpError } = require('../../middleware/errorHandler');
const { writeLog, LOG_TYPES } = require('../../config/logger');

function setSessionCookie(res, sessionId) {
  res.cookie(config.session.cookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.session.ttlMs,
    secure: config.env === 'production',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName);
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      throw new HttpError(400, 'VALIDATION', 'Uživatelské jméno i heslo jsou povinné');
    }
    const user = await authService.findByUsername(username);
    if (!user) {
      writeLog(LOG_TYPES.SECURITY, `Neúspěšné přihlášení (unknown user): ${username}`, {
        ip: req.ip,
      });
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Neplatné přihlášení');
    }
    const ok = await authService.verifyAndMaybeRehash(user, password);
    if (!ok) {
      writeLog(LOG_TYPES.SECURITY, `Neúspěšné přihlášení (wrong password): ${username}`, {
        ip: req.ip,
      });
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Neplatné přihlášení');
    }
    const sessionId = authService.createSession(user.id);
    setSessionCookie(res, sessionId);
    writeLog(LOG_TYPES.USER, `Přihlášení: ${user.username}`, { ip: req.ip });
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    next(err);
  }
}

async function register(req, res, next) {
  try {
    if (!config.security.allowPublicRegistration) {
      throw new HttpError(403, 'REGISTRATION_DISABLED', 'Veřejná registrace je vypnutá');
    }
    const { username, password, passwordConfirm } = req.body || {};
    if (!username || !password) {
      throw new HttpError(400, 'VALIDATION', 'Uživatelské jméno i heslo jsou povinné');
    }
    if (password.length < 4) {
      throw new HttpError(400, 'VALIDATION', 'Heslo musí mít alespoň 4 znaky');
    }
    if (passwordConfirm !== undefined && password !== passwordConfirm) {
      throw new HttpError(400, 'VALIDATION', 'Hesla se neshodují');
    }
    const existing = await authService.findByUsername(username);
    if (existing) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'Uživatel již existuje');
    }
    const userId = await authService.createUser({ username, password });
    const sessionId = authService.createSession(userId);
    setSessionCookie(res, sessionId);
    writeLog(LOG_TYPES.USER, `Registrace: ${username}`, { ip: req.ip });
    res.status(201).json({ ok: true, user: { id: userId, username } });
  } catch (err) {
    next(err);
  }
}

function logout(req, res, next) {
  try {
    const sessionId = req.cookies && req.cookies[config.session.cookieName];
    if (sessionId) {
      authService.destroySession(sessionId);
    }
    clearSessionCookie(res);
    writeLog(LOG_TYPES.USER, 'Odhlášení', { user: req.user ? req.user.username : 'anonymous' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, register, logout, setSessionCookie, clearSessionCookie };
