'use strict';

const { writeLog, LOG_TYPES } = require('../config/logger');

class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'Endpoint nenalezen', path: req.path });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // HttpError = očekávaná chyba (validace, autorizace…).
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      writeLog(LOG_TYPES.ERROR, `HttpError ${err.status} ${err.code}: ${err.message}`, {
        path: req.path,
        details: err.details,
      });
    }
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Neošetřená chyba = logujeme a vracíme generickou zprávu (žádné interní detaily ven).
  writeLog(LOG_TYPES.ERROR, `Neošetřená chyba: ${err.message}`, {
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({ error: 'Interní chyba serveru' });
}

module.exports = {
  HttpError,
  notFoundHandler,
  errorHandler,
};
