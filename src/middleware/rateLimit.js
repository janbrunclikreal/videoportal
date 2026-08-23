'use strict';

/**
 * Fáze 2: Wrapper nad `express-rate-limit`.
 * API zůstává kompatibilní s původní implementací.
 * Výhody: standardní RateLimit-* hlavičky, IPv6-safe přes ipKeyGenerator,
 * thread-safe MemoryStore, JSON handler.
 */
const rateLimitFactory = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

function rateLimit(opts = {}) {
  const {
    windowMs = 60_000,
    max = 100,
    message = 'Příliš mnoho požadavků, zkuste to později.',
    keyGenerator,
    skip,
    standardHeaders = 'draft-7',
    legacyHeaders = false,
  } = opts;

  return rateLimitFactory({
    windowMs,
    limit: max,
    standardHeaders,
    legacyHeaders,
    keyGenerator: keyGenerator || ((req) => ipKeyGenerator(req.ip)),
    skip: skip || (() => false),
    handler: (req, res) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: message });
    },
  });
}

module.exports = { rateLimit, ipKeyGenerator };
