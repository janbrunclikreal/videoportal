'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config');
const { writeLog, LOG_TYPES, requestLogger } = require('./config/logger');
const { loadSessionUser } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { rateLimit } = require('./middleware/rateLimit');
const storage = require('./modules/storage/storage.service');
const db = require('./config/db');

// ===== Moduly =====
const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const videosRoutes = require('./modules/videos/videos.routes');
const commentsRoutes = require('./modules/comments/comments.routes');
const legalRoutes = require('./modules/legal/legal.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const systemRoutes = require('./modules/system/system.routes');
const { applySchema } = require('../database/init');
const { seedDefaultData } = require('./modules/auth/seed');

const viewsRoutes = require('./views/views.routes');

function buildApp() {
  const app = express();

  // ===== Bezpečnost =====
  app.use(
    helmet({
      contentSecurityPolicy: false, // frontend může být na jiné doméně
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(cors({ origin: true, credentials: true }));

  // ===== Body parsers =====
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // ===== Static + uploads (zpětná kompatibilita pro starší lokální videa) =====
  storage.ensureLocalDir();
  app.use('/uploads', express.static(path.join(process.cwd(), config.storage.localDir)));
  // `index: false` = root neukazuje na public/index.html, chceme tam dynamický view.
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

  // ===== Logování HTTP =====
  app.use(requestLogger);

  // ===== Rate limit (lightweight) =====
  app.use('/api/auth/login', rateLimit({ windowMs: 60_000, max: 10 }));
  app.use('/api/auth/register', rateLimit({ windowMs: 60_000, max: 5 }));

  // ===== Session middleware =====
  app.use(loadSessionUser);

  // ===== Health =====
  app.get('/api/health', (req, res) => res.json({ ok: true, s3: storage.isS3Enabled() }));

  // ===== Moduly – API =====
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/videos', videosRoutes);
  app.use(commentsRoutes); // mixované cesty (/api/videos/:videoId/comments, /api/comments)
  app.use('/api/legal', legalRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/system', systemRoutes);

  // ===== HTML pohledy (minimální kostry – viz views/views.routes.js) =====
  // Statická landing page z public/index.html, pokud někdo chce metadata o API.
  app.get('/welcome', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });
  app.use('/', viewsRoutes);

  // ===== Chyby =====
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function bootstrap() {
  // 1) DB schéma + seed
  applySchema();
  seedDefaultData();

  // 2) Build app
  const app = buildApp();

  // 3) Listen
  const server = app.listen(config.port, () => {
    writeLog(LOG_TYPES.INFO, `VideoPortal v2 běží na http://localhost:${config.port}`, {
      env: config.env,
      s3: storage.isS3Enabled(),
    });
  });

  function shutdown(signal) {
    writeLog(LOG_TYPES.INFO, `Shutdown: ${signal}`);
    server.close(() => {
      db.closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  bootstrap();
}

module.exports = { buildApp, bootstrap };
