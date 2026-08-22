-- VideoPortal v2 – referenční schéma databáze.
-- Tento soubor je single source of truth pro strukturu DB. Inicializační
-- skript (database/init.js) ho aplikuje přes better-sqlite3 prepared
-- statements. Všechny dotazy z aplikace musejí být parametrizované.

-- ===== Uživatelé =====
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_admin INTEGER DEFAULT 0
);

-- ===== Kategorie =====
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📁',
    color TEXT DEFAULT '#007bff',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== Videa =====
-- Nová pole oproti v1:
--   s3_key           – klíč objektu v S3/R2 (NULL u starších lokálních videí).
--   status           – 'pending' | 'published' | 'flagged' | 'takedown' | 'deleted'.
--   consent_obtained – boolean, autor potvrdil vlastnictví práv.
--   tos_version      – verze ToS, se kterou autor souhlasil.
--   deleted_at       – soft delete (auditní stopa pro GDPR/DSA).
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    filename TEXT NOT NULL,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    views INTEGER DEFAULT 0,
    size INTEGER,
    duration TEXT,
    user_id INTEGER,
    category_id INTEGER,
    visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'private', 'unlisted')),
    s3_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'published', 'flagged', 'takedown', 'deleted')),
    consent_obtained INTEGER NOT NULL DEFAULT 0,
    tos_version TEXT,
    deleted_at TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_deleted_at ON videos(deleted_at);

-- ===== Komentáře =====
-- Přidán deleted_at pro soft delete.
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER,
    user_id INTEGER,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    deleted_at TIMESTAMP,
    FOREIGN KEY(video_id) REFERENCES videos(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_deleted_at ON comments(deleted_at);

-- ===== Hodnocení videí =====
CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER,
    user_id INTEGER,
    rating INTEGER CHECK (rating IN (-1, 1)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(video_id) REFERENCES videos(id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(video_id, user_id)
);

-- ===== Role =====
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    color TEXT DEFAULT '#6c757d',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== Oprávnění =====
CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    category TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== Propojení user ↔ role =====
CREATE TABLE IF NOT EXISTS user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    role_id INTEGER,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(role_id) REFERENCES roles(id),
    FOREIGN KEY(assigned_by) REFERENCES users(id),
    UNIQUE(user_id, role_id)
);

-- ===== Propojení role ↔ permission =====
CREATE TABLE IF NOT EXISTS role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER,
    permission_name TEXT,
    FOREIGN KEY(role_id) REFERENCES roles(id),
    UNIQUE(role_id, permission_name)
);

-- ===== Statistiky sledování =====
CREATE TABLE IF NOT EXISTS video_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    user_id INTEGER,
    viewer_ip TEXT,
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    watch_duration INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT 0,
    FOREIGN KEY(video_id) REFERENCES videos(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- ===== Like / dislike komentářů =====
CREATE TABLE IF NOT EXISTS comment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    like_type INTEGER CHECK (like_type IN (-1, 1)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(comment_id, user_id)
);

-- ===== GDPR: Audit souhlasů =====
-- Každý souhlas (registrace, upload, aktualizace ToS) se zaloguje.
CREATE TABLE IF NOT EXISTS consent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    consent_type TEXT NOT NULL,   -- 'tos', 'upload_rights', 'personal_data'
    tos_version TEXT,
    granted INTEGER NOT NULL,     -- 1 = granted, 0 = revoked
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_consent_log_user ON consent_log(user_id);

-- ===== Verze ToS =====
CREATE TABLE IF NOT EXISTS tos_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT UNIQUE NOT NULL,
    document_url TEXT,
    summary TEXT,
    effective_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY(created_by) REFERENCES users(id)
);
