'use strict';

const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.method}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const arr = buckets.get(key) || [];
    const recent = arr.filter((t) => t > now - windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'Příliš mnoho požadavků, zkuste to později.' });
    }
    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}

module.exports = { rateLimit };
