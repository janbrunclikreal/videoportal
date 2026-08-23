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
  // Fáze 2: CORS whitelist. V produkci nastavit
  //   ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"
  allowedOrigins: (process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
      : [
          'https://videoportal.server.lan',
          'http://videoportal.server.lan',
          'https://videoportal.server.lan:8082',
          'http://videoportal.server.lan:8082',
          'http://localhost:8081',
          'http://localhost:8082',
        ]
    ),
  // Fáze 2: TRUST_PROXY=1 = důvěřujeme X-Forwarded-For z reverzní proxy.
  trustProxy: bool(process.env.TRUST_PROXY, false),
}),

session: Object.freeze({
  cookieName: process.env.SESSION_COOKIE_NAME || 'sessionId',
  // Fáze 2: 14 dní perzistentní cookie (bylo 7).
  ttlMs: int(process.env.SESSION_TTL_MS, 14 * 24 * 60 * 60 * 1000),
  secret: process.env.SESSION_SECRET || 'change-me-in-production-please',
}),

legal: Object.freeze({
    currentTosVersion: process.env.CURRENT_TOS_VERSION || 'v1.0',
  }),
});

module.exports = config;
