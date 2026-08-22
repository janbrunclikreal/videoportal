'use strict';

const { HttpError } = require('./errorHandler');
const authService = require('../modules/auth/auth.service');
const { writeLog, LOG_TYPES } = require('../config/logger');
const config = require('../config');

function loadSessionUser(req, res, next) {
  const sessionId = req.cookies && req.cookies[config.session.cookieName];
  const session = authService.getSession(sessionId);
  if (!session) {
    req.user = null;
    return next();
  }
  try {
    const user = authService.loadUserWithRoles(session.userId);
    req.user = user || null;
  } catch (err) {
    writeLog(LOG_TYPES.ERROR, 'loadSessionUser selhal', { error: err.message });
    req.user = null;
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    return next(new HttpError(401, 'NOT_LOGGED_IN', 'Nejste přihlášeni'));
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'NOT_LOGGED_IN', 'Nejste přihlášeni'));
    }
    if (!authService.hasPermission(req.user, permission)) {
      writeLog(LOG_TYPES.SECURITY, `Přístup odepřen - chybí oprávnění: ${permission}`, {
        user: req.user.username,
        url: req.url,
        method: req.method,
      });
      return next(new HttpError(403, 'FORBIDDEN', 'Nemáte dostatečná oprávnění'));
    }
    next();
  };
}

module.exports = {
  loadSessionUser,
  requireLogin,
  requirePermission,
};
