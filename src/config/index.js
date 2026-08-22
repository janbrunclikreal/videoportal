'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function bool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function int(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8081),

  db: Object.freeze({
    path: process.env.DB_PATH || 'database/videoportal.db',
  }),

  session: Object.freeze({
    cookieName: process.env.SESSION_COOKIE_NAME || 'sessionId',
    ttlMs: int(process.env.SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000),
    secret: process.env.SESSION_SECRET || 'change-me-in-production-please',
  }),

  storage: Object.freeze({
    bucket: process.env.S3_BUCKET || 'videoportal-videos',
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || undefined,
    localDir: process.env.LOCAL_UPLOAD_DIR || 'uploads',
    // S3 je aktivní jen pokud jsou k dispozici přihlašovací údaje.
    get s3Enabled() {
      return Boolean(
        this.accessKeyId &&
          this.secretAccessKey &&
          this.bucket
      );
    },
  }),

  security: Object.freeze({
    allowPublicRegistration: bool(process.env.ALLOW_PUBLIC_REGISTRATION, true),
  }),

  legal: Object.freeze({
    currentTosVersion: process.env.CURRENT_TOS_VERSION || 'v1.0',
  }),
});

module.exports = config;
