const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8081;

// ===== LOGOVÁNÍ SYSTÉM =====

// Vytvoření logs adresáře
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

// Formátování času pro logy
function getTimestamp() {
    return new Date().toLocaleString('cs-CZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Prague'
    });
}

// Funkce pro logování do souboru
function writeLog(type, message, data = null) {
    const timestamp = getTimestamp();
    const logEntry = {
        timestamp: timestamp,
        type: type,
        message: message,
        data: data
    };
    
    const logString = `[${timestamp}] [${type.toUpperCase()}] ${message}${data ? ' | Data: ' + JSON.stringify(data) : ''}\n`;
    
    // Logování do konzole
    console.log(`📝 ${logString.trim()}`);
    
    // Logování do souboru
    const today = new Date().toISOString().split('T')[0];
    const logFile = `logs/videoportal-${today}.log`;
    
    fs.appendFileSync(logFile, logString, { encoding: 'utf8' });
}

// Typy logů
const LOG_TYPES = {
    INFO: 'INFO',
    ERROR: 'ERROR',
    WARNING: 'WARNING',
    USER: 'USER',
    DATABASE: 'DATABASE',
    UPLOAD: 'UPLOAD',
    REQUEST: 'REQUEST',
    SECURITY: 'SECURITY',
    ROLE: 'ROLE',
    ADMIN: 'ADMIN'
};

// Middleware pro logování HTTP requestů
function requestLogger(req, res, next) {
    const start = Date.now();
    const method = req.method;
    const url = req.url;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || 'Unknown';
    
    // Logování příchozího requestu
    writeLog(LOG_TYPES.REQUEST, `${method} ${url}`, {
        ip: ip,
        userAgent: userAgent,
        user: req.user ? req.user.username : 'anonymous'
    });
    
    // Logování response při dokončení
    res.on('finish', () => {
        const duration = Date.now() - start;
        const statusCode = res.statusCode;
        
        writeLog(LOG_TYPES.REQUEST, `${method} ${url} - ${statusCode} (${duration}ms)`, {
            ip: ip,
            statusCode: statusCode,
            duration: duration,
            user: req.user ? req.user.username : 'anonymous'
        });
    });
    
    next();
}

// ===== ROLE A PERMISSIONS SYSTÉM =====

// Definice oprávnění
const PERMISSIONS = {
    // Uživatelské oprávnění
    UPLOAD_VIDEOS: 'upload_videos',
    DELETE_OWN_VIDEOS: 'delete_own_videos',
    EDIT_OWN_PROFILE: 'edit_own_profile',
    
    // Moderátorské oprávnění
    MODERATE_COMMENTS: 'moderate_comments',
    MODERATE_VIDEOS: 'moderate_videos',
    
    // Editorské oprávnění
    MANAGE_CATEGORIES: 'manage_categories',
    EDIT_ALL_VIDEOS: 'edit_all_videos',
    
    // Adminské oprávnění
    VIEW_ADMIN_PANEL: 'view_admin_panel',
    MANAGE_USERS: 'manage_users',
    MANAGE_ROLES: 'manage_roles',
    DELETE_ANY_CONTENT: 'delete_any_content',
    VIEW_SYSTEM_LOGS: 'view_system_logs'
};

// Definice rolí a jejich oprávnění
const ROLES = {
    USER: {
        id: 1,
        name: 'User',
        display_name: 'Uživatel',
        color: '#28a745',
        permissions: [
            PERMISSIONS.UPLOAD_VIDEOS,
            PERMISSIONS.DELETE_OWN_VIDEOS,
            PERMISSIONS.EDIT_OWN_PROFILE
        ]
    },
    MODERATOR: {
        id: 2,
        name: 'Moderator',
        display_name: 'Moderátor',
        color: '#ffc107',
        permissions: [
            PERMISSIONS.UPLOAD_VIDEOS,
            PERMISSIONS.DELETE_OWN_VIDEOS,
            PERMISSIONS.EDIT_OWN_PROFILE,
            PERMISSIONS.MODERATE_COMMENTS,
            PERMISSIONS.MODERATE_VIDEOS
        ]
    },
    EDITOR: {
        id: 3,
        name: 'Editor',
        display_name: 'Editor',
        color: '#17a2b8',
        permissions: [
            PERMISSIONS.UPLOAD_VIDEOS,
            PERMISSIONS.DELETE_OWN_VIDEOS,
            PERMISSIONS.EDIT_OWN_PROFILE,
            PERMISSIONS.MODERATE_COMMENTS,
            PERMISSIONS.MODERATE_VIDEOS,
            PERMISSIONS.MANAGE_CATEGORIES,
            PERMISSIONS.EDIT_ALL_VIDEOS
        ]
    },
    ADMIN: {
        id: 4,
        name: 'Admin',
        display_name: 'Administrátor',
        color: '#dc3545',
        permissions: Object.values(PERMISSIONS)
    }
};

// ===== DATABÁZE INICIALIZACE =====

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync('uploads')) {
            fs.mkdirSync('uploads');
        }
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /mp4|avi|mov|wmv|flv|webm|mkv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb('Chyba: Neplatný formát videa!');
        }
    }
});

// Bezpečné hashování hesel
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'salt').digest('hex');
}

// Databáze funkce
function queryDB(sql, params = [], callback) {
    const timeout = 10000; // 10 sekund timeout
    const command = `timeout ${timeout/1000} sqlite3 -cmd ".timeout 5000" database/videoportal.db "${sql.replace(/"/g, '\\"')}"`;
    
    // Pro SELECT dotazy s parametry
    if (params.length > 0) {
        const escapedParams = params.map(param => `'${String(param).replace(/'/g, "''")}'`);
        const finalSql = sql.replace(/\?/g, () => escapedParams.shift());
        const finalCommand = `timeout ${timeout/1000} sqlite3 -cmd ".timeout 5000" database/videoportal.db "${finalSql.replace(/"/g, '\\"')}"`;
        
        exec(finalCommand, (error, stdout, stderr) => {
            if (error) {
                writeLog(LOG_TYPES.ERROR, 'Database error', { 
                    error: error.message, 
                    duration: timeout,
                    sql: sql 
                });
                return callback(error, null);
            }
            
            try {
                const rows = stdout.trim().split('\n')
                    .filter(line => line.length > 0)
                    .map(line => line.split('|'));
                callback(null, rows);
            } catch (parseError) {
                writeLog(LOG_TYPES.ERROR, 'Parse error', { error: parseError.message });
                callback(parseError, null);
            }
        });
        return;
    }
    
    // Pro obyčejné dotazy bez parametrů
    exec(command, (error, stdout, stderr) => {
        if (error) {
            writeLog(LOG_TYPES.ERROR, 'Database error', { 
                error: error.message,
                duration: timeout,
                sql: sql 
            });
            return callback(error, null);
        }
        
        try {
            const sqlUpper = sql.trim().toUpperCase();
            if (sqlUpper.startsWith('SELECT') || sqlUpper.startsWith('PRAGMA')) {
                const rows = stdout.trim().split('\n')
                    .filter(line => line.length > 0)
                    .map(line => line.split('|'));
                callback(null, rows);
            } else {
                callback(null, { changes: 1 });
            }
        } catch (parseError) {
            writeLog(LOG_TYPES.ERROR, 'Parse error', { error: parseError.message });
            callback(parseError, null);
        }
    });
}

// Vytvoření databáze adresáře a souborů
function initDatabase() {
    writeLog(LOG_TYPES.INFO, 'Inicializace databáze...');
    
    if (!fs.existsSync('database')) {
        fs.mkdirSync('database');
        writeLog(LOG_TYPES.INFO, 'Vytvořen adresář database/');
    }
    
    const dbPath = 'database/videoportal.db';
    
    // Vytvoření všech tabulek
    const tables = [
        // Tabulka uživatelů
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_admin INTEGER DEFAULT 0
        )`,
        
        // Tabulka kategorií
        `CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '📁',
            color TEXT DEFAULT '#007bff',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Tabulka videí
        `CREATE TABLE IF NOT EXISTS videos (
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
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(category_id) REFERENCES categories(id)
        )`,
        
        // Tabulka komentářů
        `CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id INTEGER,
            user_id INTEGER,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT,
            FOREIGN KEY(video_id) REFERENCES videos(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`,
        
        // Tabulka hodnocení
        `CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id INTEGER,
            user_id INTEGER,
            rating INTEGER CHECK (rating IN (-1, 1)),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(video_id) REFERENCES videos(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(video_id, user_id)
        )`,
        
        // Tabulka rolí
        `CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            color TEXT DEFAULT '#6c757d',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Tabulka oprávnění
        `CREATE TABLE IF NOT EXISTS permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            category TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Tabulka propojení uživatelů a rolí
        `CREATE TABLE IF NOT EXISTS user_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            role_id INTEGER,
            assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            assigned_by INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(role_id) REFERENCES roles(id),
            FOREIGN KEY(assigned_by) REFERENCES users(id),
            UNIQUE(user_id, role_id)
        )`,
        
        // Tabulka propojení rolí a oprávnění
        `CREATE TABLE IF NOT EXISTS role_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_id INTEGER,
            permission_name TEXT,
            FOREIGN KEY(role_id) REFERENCES roles(id),
            UNIQUE(role_id, permission_name)
        )`,
        
        // Tabulka sledování videí (statistiky)
        `CREATE TABLE IF NOT EXISTS video_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id INTEGER NOT NULL,
            user_id INTEGER,
            viewer_ip TEXT,
            viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            watch_duration INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT 0,
            FOREIGN KEY(video_id) REFERENCES videos(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`,
        
        // Tabulka hodnocení komentářů (like/dislike)
        `CREATE TABLE IF NOT EXISTS comment_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comment_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            like_type INTEGER CHECK (like_type IN (-1, 1)),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(comment_id, user_id)
        )`
    ];
    
    // Vytvoření tabulek postupně
    let tableIndex = 0;
    
    function createNextTable() {
        if (tableIndex >= tables.length) {
            writeLog(LOG_TYPES.INFO, 'Tabulky vytvořeny');
            seedRolesAndPermissions();
            return;
        }
        
        queryDB(tables[tableIndex], [], (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, `Chyba při vytváření tabulky ${tableIndex}`, { error: err.message });
            } else {
                writeLog(LOG_TYPES.INFO, `Tabulka ${tableIndex + 1}/${tables.length} vytvořena`);
            }
            tableIndex++;
            setTimeout(createNextTable, 100);
        });
    }
    
    createNextTable();
}

// Vkládání rolí a oprávnění
function seedRolesAndPermissions() {
    writeLog(LOG_TYPES.INFO, 'Vkládání rolí a oprávnění...');
    
    // Vložení rolí
    Object.values(ROLES).forEach(role => {
        queryDB(
            `INSERT OR REPLACE INTO roles (id, name, display_name, color) VALUES (?, ?, ?, ?)`,
            [role.id, role.name, role.display_name, role.color],
            (err) => {
                if (err) {
                    writeLog(LOG_TYPES.ERROR, `Chyba při vkládání role ${role.name}`, { error: err.message });
                } else {
                    writeLog(LOG_TYPES.INFO, `Role ${role.name} vložena`);
                }
            }
        );
    });
    
    // Vložení oprávnění
    const permissionCategories = {
        'Uživatelské': ['upload_videos', 'delete_own_videos', 'edit_own_profile'],
        'Moderátorské': ['moderate_comments', 'moderate_videos'],
        'Editorské': ['manage_categories', 'edit_all_videos'],
        'Adminské': ['view_admin_panel', 'manage_users', 'manage_roles', 'delete_any_content', 'view_system_logs']
    };
    
    const permissionDisplayNames = {
        'upload_videos': 'Nahrávání videí',
        'delete_own_videos': 'Mazání vlastních videí',
        'edit_own_profile': 'Úprava vlastního profilu',
        'moderate_comments': 'Moderování komentářů',
        'moderate_videos': 'Moderování videí',
        'manage_categories': 'Správa kategorií',
        'edit_all_videos': 'Úprava všech videí',
        'view_admin_panel': 'Zobrazení admin panelu',
        'manage_users': 'Správa uživatelů',
        'manage_roles': 'Správa rolí',
        'delete_any_content': 'Mazání jakéhokoliv obsahu',
        'view_system_logs': 'Zobrazení systémových logů'
    };
    
    Object.entries(permissionCategories).forEach(([category, permissions]) => {
        permissions.forEach(permission => {
            queryDB(
                `INSERT OR REPLACE INTO permissions (name, display_name, category) VALUES (?, ?, ?)`,
                [permission, permissionDisplayNames[permission], category],
                (err) => {
                    if (err) {
                        writeLog(LOG_TYPES.ERROR, `Chyba při vkládání oprávnění ${permission}`, { error: err.message });
                    }
                }
            );
        });
    });
    
    // Vložení propojení rolí a oprávnění
    setTimeout(() => {
        Object.values(ROLES).forEach(role => {
            role.permissions.forEach(permission => {
                queryDB(
                    `INSERT OR REPLACE INTO role_permissions (role_id, permission_name) VALUES (?, ?)`,
                    [role.id, permission],
                    (err) => {
                        if (err) {
                            writeLog(LOG_TYPES.ERROR, `Chyba při vkládání oprávnění ${permission} pro roli ${role.name}`, { error: err.message });
                        }
                    }
                );
            });
        });
        
        // Migrace existujících uživatelů
        setTimeout(migrateAdminUsers, 1000);
        
        // Seed kategorií
        setTimeout(seedCategories, 1500);
        
        // Migrace viditelnosti videí
        setTimeout(migrateVideoVisibility, 2000);
    }, 500);
}

// Migrace existujících admin uživatelů
function migrateAdminUsers() {
    writeLog(LOG_TYPES.INFO, 'Migrace admin uživatelů...');
    
    // Najít všechny admin uživatele
    queryDB(`SELECT id, username FROM users WHERE is_admin = 1`, [], (err, adminUsers) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při hledání admin uživatelů', { error: err.message });
            return;
        }
        
        if (adminUsers.length === 0) {
            writeLog(LOG_TYPES.INFO, 'Žádní admin uživatelé k migraci');
            
            // Vytvoření výchozího admin uživatele pokud neexistuje žádný
            queryDB(`SELECT COUNT(*) as count FROM users`, [], (err, countResult) => {
                if (!err && countResult.length > 0 && parseInt(countResult[0][0]) === 0) {
                    const defaultAdmin = {
                        username: 'admin',
                        password: 'admin123'
                    };
                    
                    queryDB(
                        `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)`,
                        [defaultAdmin.username, hashPassword(defaultAdmin.password)],
                        (err, result) => {
                            if (!err) {
                                writeLog(LOG_TYPES.INFO, 'Výchozí admin uživatel vytvořen', { username: defaultAdmin.username });
                                
                                // Přiřadit admin roli
                                queryDB(`SELECT last_insert_rowid()`, [], (err, idResult) => {
                                    if (!err && idResult.length > 0) {
                                        const userId = parseInt(idResult[0][0]);
                                        assignRoleToUser(userId, ROLES.ADMIN.id, userId);
                                    }
                                });
                            }
                        }
                    );
                }
            });
            return;
        }
        
        // Migrace každého admin uživatele
        adminUsers.forEach(adminUser => {
            const userId = adminUser[0];
            const username = adminUser[1];
            
            writeLog(LOG_TYPES.INFO, `Migrace admin uživatele: ${username}`);
            
            // Přiřadit admin roli
            assignRoleToUser(userId, ROLES.ADMIN.id, userId);
        });
    });
}

// Funkce pro přiřazení role uživateli
function assignRoleToUser(userId, roleId, assignedBy = null) {
    queryDB(
        `INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)`,
        [userId, roleId, assignedBy || userId],
        (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, `Chyba při přiřazování role ${roleId} uživateli ${userId}`, { error: err.message });
            } else {
                writeLog(LOG_TYPES.ROLE, `Role ${roleId} přiřazena uživateli ${userId}`);
            }
        }
    );
}

// Migrace viditelnosti videí
function migrateVideoVisibility() {
    writeLog(LOG_TYPES.INFO, 'Migrace viditelnosti videí...');
    
    // Přidat sloupec visibility pokud neexistuje
    queryDB(
        `PRAGMA table_info(videos)`,
        [],
        (err, rows) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při kontrole struktury tabulky videos', { error: err.message });
                return;
            }
            
            // Zkontrolovat, jestli rows je pole a zpracovat odpovídajícím způsobem
            let hasVisibility = false;
            
            if (Array.isArray(rows)) {
                hasVisibility = rows.some(row => Array.isArray(row) && row[1] === 'visibility');
            } else {
                // Pokud není pole, zkusíme přímo dotaz na sloupec
                writeLog(LOG_TYPES.INFO, 'PRAGMA vrátilo neočekávaný formát, zkouším alternativní kontrolu');
                // Zkusíme přímo SELECT na sloupec visibility
                queryDB(
                    `SELECT visibility FROM videos LIMIT 1`,
                    [],
                    (selectErr, selectRows) => {
                        if (selectErr) {
                            // Chyba znamená, že sloupec neexistuje
                            writeLog(LOG_TYPES.INFO, 'Sloupec visibility neexistuje, přidávám ho');
                            addVisibilityColumn();
                        } else {
                            writeLog(LOG_TYPES.INFO, 'Sloupec visibility již existuje');
                        }
                    }
                );
                return;
            }
            
            if (!hasVisibility) {
                addVisibilityColumn();
            } else {
                writeLog(LOG_TYPES.INFO, 'Sloupec visibility již existuje');
            }
        }
    );
}

// Pomocná funkce pro přidání sloupce visibility
function addVisibilityColumn() {
    writeLog(LOG_TYPES.INFO, 'Přidávám sloupec visibility do tabulky videos');
    queryDB(
        `ALTER TABLE videos ADD COLUMN visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'private', 'unlisted'))`,
        [],
        (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při přidávání sloupce visibility', { error: err.message });
            } else {
                writeLog(LOG_TYPES.INFO, 'Sloupec visibility úspěšně přidán');
            }
        }
    );
}

// Seed kategorií
function seedCategories() {
    const categories = [
        { name: 'Hudba', icon: '🎵', color: '#e91e63' },
        { name: 'Sport', icon: '⚽', color: '#4caf50' },
        { name: 'Vzdělávání', icon: '📚', color: '#2196f3' },
        { name: 'Hry', icon: '🎮', color: '#9c27b0' },
        { name: 'Cestování', icon: '✈️', color: '#ff9800' },
        { name: 'Komedie', icon: '😂', color: '#ffeb3b' },
        { name: 'Technologie', icon: '💻', color: '#607d8b' },
        { name: 'Jídlo', icon: '🍕', color: '#795548' }
    ];
    
    categories.forEach(category => {
        // Nejprve zkontroluj, zda kategorie existuje
        queryDB(
            `SELECT COUNT(*) FROM categories WHERE name = ?`,
            [category.name],
            (err, rows) => {
                if (err) {
                    writeLog(LOG_TYPES.ERROR, `Chyba při kontrole kategorie ${category.name}`, { error: err.message });
                    return;
                }
                
                const count = parseInt(rows[0][0]);
                if (count === 0) {
                    // Kategorie neexistuje, vložíme ji
                    queryDB(
                        `INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)`,
                        [category.name, category.icon, category.color],
                        (err) => {
                            if (err) {
                                writeLog(LOG_TYPES.ERROR, `Chyba při vkládání kategorie ${category.name}`, { error: err.message });
                            } else {
                                writeLog(LOG_TYPES.INFO, `Kategorie ${category.name} vložena`);
                            }
                        }
                    );
                }
                // Pokud kategorie existuje, nevypisujeme nic
            }
        );
    });
}

// Funkce pro načtení kategorií
function loadCategories(callback) {
    queryDB('SELECT id, name, icon, color FROM categories ORDER BY name', [], (err, rows) => {
        if (err) {
            return callback(err, []);
        }
        
        const categories = rows.map(row => ({
            id: row[0],
            name: row[1],
            icon: row[2],
            color: row[3]
        }));
        
        callback(null, categories);
    });
}

// ===== MIDDLEWARE SETUP =====

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware s cookies (bez externí závislosti)
const sessions = {};

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

// Jednoduché parsování cookies
function parseCookies(req) {
    const cookies = {};
    const cookieString = req.headers.cookie;
    
    if (cookieString) {
        cookieString.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            if (name && value) {
                cookies[name] = decodeURIComponent(value);
            }
        });
    }
    
    return cookies;
}

// Middleware pro načtení uživatele ze session
app.use((req, res, next) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.sessionId;
    
    if (sessionId && sessions[sessionId]) {
        const userId = sessions[sessionId].userId;
        
        // Načíst uživatele s rolemi
        loadUserWithRoles(userId, (err, user) => {
            if (!err && user) {
                req.user = user;
            }
            next();
        });
    } else {
        next();
    }
});

app.use(express.static('uploads'));
app.use(express.static('public'));
app.use(requestLogger);

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(cors());

// Funkce pro načtení uživatele s rolemi
function loadUserWithRoles(userId, callback) {
    queryDB(
        `SELECT u.id, u.username, u.created_at, u.is_admin
         FROM users u WHERE u.id = ?`,
        [userId],
        (err, userRows) => {
            if (err || userRows.length === 0) {
                return callback(err, null);
            }
            
            const user = {
                id: userRows[0][0],
                username: userRows[0][1],
                created_at: userRows[0][2],
                is_admin: userRows[0][3],
                roles: [],
                permissions: []
            };
            
            // Načíst role uživatele
            queryDB(
                `SELECT r.id, r.name, r.display_name, r.color
                 FROM user_roles ur
                 JOIN roles r ON ur.role_id = r.id
                 WHERE ur.user_id = ?`,
                [userId],
                (err, roleRows) => {
                    if (!err && roleRows.length > 0) {
                        user.roles = roleRows.map(row => ({
                            id: row[0],
                            name: row[1],
                            display_name: row[2],
                            color: row[3]
                        }));
                        
                        // Načíst oprávnění pro role uživatele
                        const roleIds = user.roles.map(role => role.id);
                        if (roleIds.length > 0) {
                            queryDB(
                                `SELECT DISTINCT rp.permission_name
                                 FROM role_permissions rp
                                 WHERE rp.role_id IN (${roleIds.map(() => '?').join(',')})`,
                                roleIds,
                                (err, permissionRows) => {
                                    if (!err && permissionRows.length > 0) {
                                        user.permissions = permissionRows.map(row => row[0]);
                                    }
                                    callback(null, user);
                                }
                            );
                        } else {
                            callback(null, user);
                        }
                    } else {
                        // Uživatel nemá žádné role, přiřadit základní uživatelskou roli
                        assignRoleToUser(userId, ROLES.USER.id, userId);
                        user.roles = [ROLES.USER];
                        user.permissions = ROLES.USER.permissions;
                        callback(null, user);
                    }
                }
            );
        }
    );
}

// Funkce pro kontrolu oprávnění
function hasPermission(user, permission) {
    if (!user || !user.permissions) return false;
    return user.permissions.includes(permission);
}

// Middleware pro vyžadování oprávnění
function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Nejste přihlášeni' });
        }
        
        if (!hasPermission(req.user, permission)) {
            writeLog(LOG_TYPES.SECURITY, `Přístup odepřen - chybí oprávnění: ${permission}`, {
                user: req.user.username,
                url: req.url,
                method: req.method
            });
            return res.status(403).json({ error: 'Nemáte dostatečná oprávnění' });
        }
        
        next();
    };
}

// Middleware pro vyžadování přihlášení (bez kontroly specifických oprávnění)
function requireLogin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Nejste přihlášeni' });
    }
    next();
}

// Helper funkce pro kompatibilitu
function isAdmin(user) {
    return hasPermission(user, PERMISSIONS.VIEW_ADMIN_PANEL);
}

// ===== ADMIN PANEL ROUTES =====

// Hlavní admin panel
app.get('/admin', requirePermission(PERMISSIONS.VIEW_ADMIN_PANEL), (req, res) => {
    // Načíst statistiky
    loadAdminStatistics((err, stats) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při načítání admin statistik', { error: err.message });
            stats = {
                totalUsers: 0,
                totalVideos: 0,
                totalComments: 0,
                totalCategories: 0
            };
        }
        
        // Načíst kategorie
        loadCategories((err, categories) => {
            if (err) categories = [];
            
            const content = `
                <h2>🔧 Administrační panel</h2>
                
                <div class="admin-tabs">
                    <button class="admin-tab active" onclick="showAdminTab('dashboard')">📊 Dashboard</button>
                    <button class="admin-tab" onclick="showAdminTab('users')">👥 Uživatelé</button>
                    <button class="admin-tab" onclick="showAdminTab('categories')">🗂️ Kategorie</button>
                    ${hasPermission(req.user, PERMISSIONS.VIEW_SYSTEM_LOGS) ? '<button class="admin-tab" onclick="showAdminTab(\'logs\')">📋 Logy</button>' : ''}
                </div>
                
                <!-- Dashboard Tab -->
                <div id="dashboard" class="admin-content active">
                    <h3>📊 Statistiky systému</h3>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number">${stats.totalUsers}</div>
                            <div class="stat-label">👥 Celkem uživatelů</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${stats.totalVideos}</div>
                            <div class="stat-label">🎥 Celkem videí</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${stats.totalComments}</div>
                            <div class="stat-label">💬 Celkem komentářů</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">${stats.totalCategories}</div>
                            <div class="stat-label">🗂️ Celkem kategorií</div>
                        </div>
                    </div>
                    
                    <div class="admin-section">
                        <h4>⚡ Rychlé akce</h4>
                        <div class="quick-actions">
                            <button class="button" onclick="showAdminTab('users')">👥 Správa uživatelů</button>
                            <button class="button" onclick="showAdminTab('categories')">🗂️ Správa kategorií</button>
                            ${hasPermission(req.user, PERMISSIONS.VIEW_SYSTEM_LOGS) ? '<button class="button" onclick="showAdminTab(\'logs\')">📋 Zobrazit logy</button>' : ''}
                        </div>
                    </div>
                </div>
                
                <!-- Users Tab -->
                <div id="users" class="admin-content">
                    <h3>👥 Správa uživatelů</h3>
                    <div id="users-content">
                        <div class="loading">Načítání uživatelů...</div>
                    </div>
                </div>
                
                <!-- Categories Tab -->
                <div id="categories" class="admin-content">
                    <h3>🗂️ Správa kategorií</h3>
                    
                    ${hasPermission(req.user, PERMISSIONS.MANAGE_CATEGORIES) ? `
                        <div class="admin-section">
                            <h4>➕ Přidat novou kategorii</h4>
                            <form action="/admin/category/create" method="POST">
                                <div class="form-group">
                                    <label for="category-name">Název kategorie:</label>
                                    <input type="text" id="category-name" name="name" required>
                                </div>
                                <div class="form-group">
                                    <label for="category-icon">Ikona (emoji):</label>
                                    <input type="text" id="category-icon" name="icon" placeholder="📁" maxlength="2">
                                </div>
                                <div class="form-group">
                                    <label for="category-color">Barva:</label>
                                    <input type="color" id="category-color" name="color" value="#007bff">
                                </div>
                                <button type="submit" class="button success">➕ Vytvořit kategorii</button>
                            </form>
                        </div>
                    ` : ''}
                    
                    <div class="admin-section">
                        <h4>📋 Existující kategorie</h4>
                        <div class="categories-list">
                            ${categories.map(cat => `
                                <div class="category-admin-item" style="border-left: 4px solid ${cat.color};">
                                    <div class="category-info">
                                        <span class="category-icon">${cat.icon}</span>
                                        <span class="category-name">${cat.name}</span>
                                        <span class="category-id">(ID: ${cat.id})</span>
                                    </div>
                                    ${hasPermission(req.user, PERMISSIONS.MANAGE_CATEGORIES) ? `
                                        <div class="category-actions">
                                            <button class="button warning" onclick="editCategory(${cat.id}, '${cat.name}', '${cat.icon}', '${cat.color}')">✏️ Upravit</button>
                                            <button class="button danger" onclick="deleteCategory(${cat.id}, '${cat.name}')">🗑️ Smazat</button>
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                ${hasPermission(req.user, PERMISSIONS.VIEW_SYSTEM_LOGS) ? `
                    <!-- Logs Tab -->
                    <div id="logs" class="admin-content">
                        <h3>📋 Systémové logy</h3>
                        <div id="logs-content">
                            <div class="loading">Načítání logů...</div>
                        </div>
                    </div>
                ` : ''}
            `;
            
            res.send(getMainLayout('Admin Panel', content, req.user, categories));
        });
    });
});

// API pro načtení uživatelů pro admin panel
app.get('/admin/api/users', requirePermission(PERMISSIONS.MANAGE_USERS), (req, res) => {
    queryDB(
        `SELECT u.id, u.username, u.created_at, u.is_admin,
                GROUP_CONCAT(r.display_name) as roles,
                GROUP_CONCAT(r.color) as role_colors,
                GROUP_CONCAT(r.id) as role_ids
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.user_id
         LEFT JOIN roles r ON ur.role_id = r.id
         GROUP BY u.id, u.username, u.created_at, u.is_admin
         ORDER BY u.created_at DESC`,
        [],
        (err, rows) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při načítání uživatelů pro admin', { error: err.message });
                return res.status(500).json({ error: 'Chyba při načítání uživatelů' });
            }
            
            const users = rows.map(row => ({
                id: row[0],
                username: row[1],
                created_at: row[2],
                is_admin: row[3],
                roles: row[4] ? row[4].split(',') : [],
                role_colors: row[5] ? row[5].split(',') : [],
                role_ids: row[6] ? row[6].split(',').map(id => parseInt(id)) : []
            }));
            
            // Načíst dostupné role
            queryDB('SELECT id, name, display_name, color FROM roles ORDER BY id', [], (err, roleRows) => {
                const availableRoles = roleRows ? roleRows.map(row => ({
                    id: row[0],
                    name: row[1],
                    display_name: row[2],
                    color: row[3]
                })) : [];
                
                res.json({
                    users: users,
                    availableRoles: availableRoles
                });
            });
        }
    );
});

// API pro přiřazení role uživateli
app.post('/admin/user/:userId/assign-role', requirePermission(PERMISSIONS.MANAGE_USERS), (req, res) => {
    const userId = parseInt(req.params.userId);
    const { roleId } = req.body;
    
    if (!userId || !roleId) {
        return res.status(400).json({ error: 'Chybí požadované parametry' });
    }
    
    // Kontrola, zda uživatel již má tuto roli
    queryDB(
        'SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?',
        [userId, roleId],
        (err, existing) => {
            if (err) {
                return res.status(500).json({ error: 'Chyba při kontrole existující role' });
            }
            
            if (existing.length > 0) {
                return res.status(400).json({ error: 'Uživatel již má tuto roli' });
            }
            
            // Přiřadit roli
            queryDB(
                'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)',
                [userId, roleId, req.user.id],
                (err) => {
                    if (err) {
                        writeLog(LOG_TYPES.ERROR, 'Chyba při přiřazování role', { 
                            error: err.message, 
                            userId: userId, 
                            roleId: roleId,
                            assignedBy: req.user.username
                        });
                        return res.status(500).json({ error: 'Chyba při přiřazování role' });
                    }
                    
                    writeLog(LOG_TYPES.ADMIN, 'Role přiřazena uživateli', {
                        userId: userId,
                        roleId: roleId,
                        assignedBy: req.user.username
                    });
                    
                    res.json({ success: true });
                }
            );
        }
    );
});

// API pro odebrání role uživateli
app.post('/admin/user/:userId/remove-role', requirePermission(PERMISSIONS.MANAGE_USERS), (req, res) => {
    const userId = parseInt(req.params.userId);
    const { roleId } = req.body;
    
    if (!userId || !roleId) {
        return res.status(400).json({ error: 'Chybí požadované parametry' });
    }
    
    // Kontrola, zda se uživatel nesnaží odebrat sám sobě admin roli
    if (userId === req.user.id && roleId === ROLES.ADMIN.id) {
        return res.status(400).json({ error: 'Nemůžete odebrat sami sobě admin roli' });
    }
    
    queryDB(
        'DELETE FROM user_roles WHERE user_id = ? AND role_id = ?',
        [userId, roleId],
        (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při odebírání role', { 
                    error: err.message, 
                    userId: userId, 
                    roleId: roleId,
                    removedBy: req.user.username
                });
                return res.status(500).json({ error: 'Chyba při odebírání role' });
            }
            
            writeLog(LOG_TYPES.ADMIN, 'Role odebrána uživateli', {
                userId: userId,
                roleId: roleId,
                removedBy: req.user.username
            });
            
            res.json({ success: true });
        }
    );
});

// API pro smazání uživatele
app.post('/admin/user/:userId/delete', requirePermission(PERMISSIONS.DELETE_ANY_CONTENT), (req, res) => {
    const userId = parseInt(req.params.userId);
    
    if (!userId) {
        return res.status(400).json({ error: 'Chybí ID uživatele' });
    }
    
    // Kontrola, zda se uživatel nesnaží smazat sám sebe
    if (userId === req.user.id) {
        return res.status(400).json({ error: 'Nemůžete smazat sami sebe' });
    }
    
    // Získat username pro log
    queryDB('SELECT username FROM users WHERE id = ?', [userId], (err, userRows) => {
        const username = userRows && userRows.length > 0 ? userRows[0][0] : 'neznámý';
        
        // Smazat uživatele (cascade delete by měl fungovat)
        queryDB('DELETE FROM users WHERE id = ?', [userId], (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při mazání uživatele', { 
                    error: err.message, 
                    userId: userId,
                    deletedBy: req.user.username
                });
                return res.status(500).json({ error: 'Chyba při mazání uživatele' });
            }
            
            writeLog(LOG_TYPES.ADMIN, 'Uživatel smazán', {
                userId: userId,
                username: username,
                deletedBy: req.user.username
            });
            
            res.json({ success: true });
        });
    });
});

// Funkce pro načtení admin statistik
function loadAdminStatistics(callback) {
    const queries = [
        'SELECT COUNT(*) FROM users',
        'SELECT COUNT(*) FROM videos',
        'SELECT COUNT(*) FROM comments',
        'SELECT COUNT(*) FROM categories'
    ];
    
    let completed = 0;
    const stats = {};
    
    queries.forEach((query, index) => {
        queryDB(query, [], (err, result) => {
            if (!err && result && result.length > 0) {
                const count = parseInt(result[0][0]) || 0;
                switch (index) {
                    case 0: stats.totalUsers = count; break;
                    case 1: stats.totalVideos = count; break;
                    case 2: stats.totalComments = count; break;
                    case 3: stats.totalCategories = count; break;
                }
            }
            
            completed++;
            if (completed === queries.length) {
                callback(null, stats);
            }
        });
    });
}

// API pro načtení logů
app.get('/admin/api/logs', requirePermission(PERMISSIONS.VIEW_SYSTEM_LOGS), (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const logFile = `logs/videoportal-${today}.log`;
    
    fs.readFile(logFile, 'utf8', (err, data) => {
        if (err) {
            return res.json({ logs: ['Žádné logy pro dnešní den'] });
        }
        
        const logs = data.split('\n')
            .filter(line => line.trim().length > 0)
            .slice(-100) // Posledních 100 řádků
            .reverse(); // Nejnovější první
        
        res.json({ logs: logs });
    });
});

// ===== OSTATNÍ ROUTES (pokračování ze starší verze) =====

// Hlavní stránka s filtry podle kategorií
app.get('/', (req, res) => {
    const categoryFilter = req.query.category;
    
    // Načíst kategorie
    loadCategories((err, categories) => {
        if (err) categories = [];
        
        // Sestavit SQL dotaz pro videa
        let videosSQL = `
            SELECT v.*, u.username, c.name as category_name, c.icon as category_icon, c.color as category_color
            FROM videos v 
            LEFT JOIN users u ON v.user_id = u.id 
            LEFT JOIN categories c ON v.category_id = c.id
        `;
        
        let params = [];
        let whereConditions = [];
        
        // Filtr viditelnosti - zobrazit pouze veřejná videa nebo vlastní videa uživatele
        if (req.user) {
            whereConditions.push('(v.visibility = ? OR v.user_id = ?)');
            params.push('public', req.user.id);
        } else {
            whereConditions.push('v.visibility = ?');
            params.push('public');
        }
        
        if (categoryFilter) {
            whereConditions.push('v.category_id = ?');
            params.push(categoryFilter);
        }
        
        if (whereConditions.length > 0) {
            videosSQL += ' WHERE ' + whereConditions.join(' AND ');
        }
        
        videosSQL += ' ORDER BY v.upload_date DESC';
        
        queryDB(videosSQL, params, (err, videoRows) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při načítání videí', { error: err.message });
                videoRows = [];
            }
            
            const videos = videoRows.map(row => ({
                id: row[0],
                title: row[1],
                description: row[2],
                filename: row[3],
                upload_date: row[4],
                views: row[5],
                size: row[6],
                duration: row[7],
                user_id: row[8],
                category_id: row[9],
                visibility: row[10] || 'public', // Pro zpětnou kompatibilitu
                username: row[11],
                category_name: row[12],
                category_icon: row[13],
                category_color: row[14]
            }));
            
            // Získat název filtrované kategorie
            let filteredCategoryName = null;
            if (categoryFilter) {
                const filteredCategory = categories.find(cat => cat.id == categoryFilter);
                filteredCategoryName = filteredCategory ? filteredCategory.name : null;
            }
            
            const content = `
                <h2>🎥 ${filteredCategoryName ? `Kategorie: ${filteredCategoryName}` : 'Všechna videa'}</h2>
                
                ${req.user && hasPermission(req.user, PERMISSIONS.UPLOAD_VIDEOS) ? `
                    <div class="profile-section">
                        <h3>📤 Nahrát nové video</h3>
                        <form action="/upload" method="POST" enctype="multipart/form-data">
                            <div class="form-group">
                                <label for="title">Název videa:</label>
                                <input type="text" id="title" name="title" required>
                            </div>
                            <div class="form-group">
                                <label for="description">Popis:</label>
                                <textarea id="description" name="description" rows="3"></textarea>
                            </div>
                            <div class="form-group">
                                <label for="category">Kategorie:</label>
                                <select id="category" name="category_id" required>
                                    <option value="">-- Vyberte kategorii --</option>
                                    ${categories.map(cat => 
                                        `<option value="${cat.id}" style="color: ${cat.color};">${cat.icon} ${cat.name}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="visibility">Viditelnost:</label>
                                <select id="visibility" name="visibility" required>
                                    <option value="public">🌍 Veřejné - viditelné pro všechny</option>
                                    <option value="unlisted">🔗 Neveřejné přes link - viditelné jen s přímým odkazem</option>
                                    <option value="private">🔒 Soukromé - viditelné jen pro vás</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="video">Video soubor:</label>
                                <input type="file" id="video" name="video" accept="video/*" required>
                            </div>
                            <button type="submit" class="button">📤 Nahrát video</button>
                        </form>
                    </div>
                ` : !req.user ? `
                    <div class="alert warning">
                        Pro nahrávání videí se musíte <a href="/login">přihlásit</a> nebo <a href="/register">registrovat</a>.
                    </div>
                ` : `
                    <div class="alert error">
                        Nemáte oprávnění k nahrávání videí. Kontaktujte administrátora.
                    </div>
                `}
                
                <div style="margin: 20px 0;">
                    <h3>📊 Statistiky</h3>
                    <p>Celkem videí: <strong>${videos.length}</strong></p>
                    ${filteredCategoryName ? `<p>V kategorii "${filteredCategoryName}": <strong>${videos.length}</strong></p>` : ''}
                </div>
                
                ${videos.length === 0 ? `
                    <div class="alert warning">
                        ${filteredCategoryName 
                            ? `V kategorii "${filteredCategoryName}" zatím nejsou žádná videa.` 
                            : 'Zatím nejsou nahrána žádná videa.'
                        }
                    </div>
                ` : `
                    <div class="videos-list">
                        ${videos.map(video => {
                            const visibilityIcons = {
                                'public': '🌍',
                                'unlisted': '🔗', 
                                'private': '🔒'
                            };
                            
                            const visibilityTitles = {
                                'public': 'Veřejné',
                                'unlisted': 'Neveřejné přes link',
                                'private': 'Soukromé'
                            };
                            
                            const canEdit = req.user && (req.user.id === video.user_id || hasPermission(req.user, PERMISSIONS.EDIT_ALL_VIDEOS));
                            
                            return `
                                <div class="video-item">
                                    ${video.category_name ? `
                                        <div class="video-category-badge" style="background-color: ${video.category_color};">
                                            ${video.category_icon} ${video.category_name}
                                        </div>
                                    ` : ''}
                                    <div class="video-title">
                                        <a href="/video/${video.id}" style="text-decoration: none; color: inherit;">
                                            ${video.title}
                                        </a>
                                        <span style="margin-left: 10px; font-size: 0.9em;" title="${visibilityTitles[video.visibility] || 'Veřejné'}">
                                            ${visibilityIcons[video.visibility] || '🌍'}
                                        </span>
                                    </div>
                                    <div class="video-meta">
                                        👤 ${video.username || 'Neznámý'} | 
                                        📅 ${new Date(video.upload_date).toLocaleDateString('cs-CZ')} | 
                                        👁️ ${video.views} zhlédnutí
                                        ${video.size ? ` | 📦 ${Math.round(video.size / 1024 / 1024)} MB` : ''}
                                    </div>
                                    ${video.description ? `<p>${video.description}</p>` : ''}
                                    <div class="video-actions">
                                        <a href="/video/${video.id}" class="button">▶️ Přehrát</a>
                                        ${canEdit ? `
                                            <a href="/edit-video/${video.id}" class="button" style="background: #ffc107; color: #000;">✏️ Editovat</a>
                                        ` : ''}
                                        ${req.user && hasPermission(req.user, PERMISSIONS.MODERATE_VIDEOS) && req.user.id != video.user_id ? `
                                            <form action="/admin/video/${video.id}/delete" method="POST" style="display: inline;" 
                                                  onsubmit="return confirm('Opravdu smazat toto video?')">
                                                <button type="submit" class="button danger">🗑️ Smazat</button>
                                            </form>
                                        ` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            `;
            
            res.send(getMainLayout('Domů', content, req.user, categories));
        });
    });
});

// Login s automatickým načtením rolí
app.get('/login', (req, res) => {
    if (req.user) {
        return res.redirect('/');
    }
    
    const content = `
        <h2>🔐 Přihlášení</h2>
        <form action="/login" method="POST">
            <div class="form-group">
                <label for="username">Uživatelské jméno:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="password">Heslo:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" class="button">🔐 Přihlásit</button>
        </form>
        <p>Nemáte účet? <a href="/register">Registrujte se zde</a></p>
    `;
    
    res.send(getMainLayout('Přihlášení', content));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        const content = `
            <div class="alert error">Všechna pole jsou povinná!</div>
            <a href="/login" class="button">Zkusit znovu</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    const hashedPassword = hashPassword(password);
    const sql = `SELECT id, username, password_hash FROM users WHERE username = ? AND password_hash = ?`;
    
    queryDB(sql, [username, hashedPassword], (err, rows) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při přihlášení', { 
                error: err.message,
                username: username 
            });
            
            const content = `
                <div class="alert error">Chyba serveru!</div>
                <a href="/login" class="button">Zkusit znovu</a>
            `;
            return res.send(getMainLayout('Chyba', content));
        }
        
        if (rows.length === 0) {
            writeLog(LOG_TYPES.WARNING, 'Neúspěšný pokus o přihlášení', { username: username });
            
            const content = `
                <div class="alert error">Neplatné uživatelské jméno nebo heslo!</div>
                <a href="/login" class="button">Zkusit znovu</a>
            `;
            return res.send(getMainLayout('Chyba', content));
        }
        
        const user = rows[0];
        const sessionId = generateSessionId();
        sessions[sessionId] = {
            userId: user[0],
            username: user[1],
            createdAt: Date.now()
        };
        
        writeLog(LOG_TYPES.USER, 'Úspěšné přihlášení', { 
            username: username,
            sessionId: sessionId
        });
        
        // Nastavit cookie a redirect
        res.cookie('sessionId', sessionId, {
            httpOnly: true,  // Cookie není přístupné přes JavaScript (bezpečnost)
            maxAge: 24 * 60 * 60 * 1000  // 24 hodin
        });
        res.redirect('/');
    });
});

// Registrace
app.get('/register', (req, res) => {
    if (req.user) {
        return res.redirect('/');
    }
    
    const content = `
        <h2>📝 Registrace</h2>
        <form action="/register" method="POST">
            <div class="form-group">
                <label for="username">Uživatelské jméno:</label>
                <input type="text" id="username" name="username" required minlength="3" maxlength="20">
            </div>
            <div class="form-group">
                <label for="password">Heslo:</label>
                <input type="password" id="password" name="password" required minlength="6">
            </div>
            <div class="form-group">
                <label for="password_confirm">Potvrzení hesla:</label>
                <input type="password" id="password_confirm" name="password_confirm" required>
            </div>
            <button type="submit" class="button">📝 Registrovat</button>
        </form>
        <p>Již máte účet? <a href="/login">Přihlaste se zde</a></p>
    `;
    
    res.send(getMainLayout('Registrace', content));
});

app.post('/register', (req, res) => {
    const { username, password, password_confirm } = req.body;
    
    if (!username || !password || !password_confirm) {
        const content = `
            <div class="alert error">Všechna pole jsou povinná!</div>
            <a href="/register" class="button">Zkusit znovu</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    if (password !== password_confirm) {
        const content = `
            <div class="alert error">Hesla se neshodují!</div>
            <a href="/register" class="button">Zkusit znovu</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    if (password.length < 6) {
        const content = `
            <div class="alert error">Heslo musí mít alespoň 6 znaků!</div>
            <a href="/register" class="button">Zkusit znovu</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    const hashedPassword = hashPassword(password);
    const sql = `INSERT INTO users (username, password_hash) VALUES (?, ?)`;
    
    queryDB(sql, [username, hashedPassword], (err, result) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při registraci', { 
                error: err.message,
                username: username 
            });
            
            let errorMessage = 'Chyba serveru!';
            if (err.message.includes('UNIQUE constraint failed')) {
                errorMessage = 'Uživatelské jméno již existuje!';
            }
            
            const content = `
                <div class="alert error">${errorMessage}</div>
                <a href="/register" class="button">Zkusit znovu</a>
            `;
            return res.send(getMainLayout('Chyba', content));
        }
        
        writeLog(LOG_TYPES.USER, 'Nová registrace', { username: username });
        
        // Získat ID nově vytvořeného uživatele a přiřadit základní roli
        queryDB('SELECT last_insert_rowid()', [], (err, idResult) => {
            if (!err && idResult.length > 0) {
                const userId = parseInt(idResult[0][0]);
                assignRoleToUser(userId, ROLES.USER.id, userId);
            }
        });
        
        const content = `
            <div class="alert success">Registrace úspěšná! Nyní se můžete přihlásit.</div>
            <a href="/login" class="button">Přihlásit se</a>
        `;
        
        res.send(getMainLayout('Registrace úspěšná', content));
    });
});

// Odhlášení
app.get('/logout', (req, res) => {
    const cookies = parseCookies(req);
    const sessionId = cookies.sessionId;
    
    if (sessionId && sessions[sessionId]) {
        writeLog(LOG_TYPES.USER, 'Odhlášení', { 
            username: sessions[sessionId].username,
            sessionId: sessionId
        });
        delete sessions[sessionId];
    }
    
    // Smazat cookie a redirect
    res.clearCookie('sessionId');
    res.redirect('/');
});

// Nahrávání videí s rolemi
app.post('/upload', requirePermission(PERMISSIONS.UPLOAD_VIDEOS), upload.single('video'), (req, res) => {
    const { title, description, category_id, visibility } = req.body;
    
    if (!req.file) {
        const content = `
            <div class="alert error">Nebyl vybrán žádný soubor!</div>
            <a href="/" class="button">Zpět</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    if (!title || !category_id || !visibility) {
        // Smazat nahraný soubor
        fs.unlinkSync(req.file.path);
        
        const content = `
            <div class="alert error">Název, kategorie a viditelnost jsou povinné!</div>
            <a href="/" class="button">Zpět</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    // Validace viditelnosti
    if (!['public', 'private', 'unlisted'].includes(visibility)) {
        fs.unlinkSync(req.file.path);
        
        const content = `
            <div class="alert error">Neplatná hodnota viditelnosti!</div>
            <a href="/" class="button">Zpět</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    const sql = `INSERT INTO videos (title, description, filename, user_id, size, category_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const values = [title, description || '', req.file.filename, req.user.id, req.file.size, category_id, visibility];
    
    queryDB(sql, values, (err, result) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při ukládání videa do databáze', { 
                error: err.message,
                filename: req.file.filename,
                user: req.user.username 
            });
            
            // Smazat nahraný soubor
            fs.unlinkSync(req.file.path);
            
            const content = `
                <div class="alert error">Chyba při ukládání videa!</div>
                <a href="/" class="button">Zkusit znovu</a>
            `;
            return res.send(getMainLayout('Chyba', content));
        }
        
        writeLog(LOG_TYPES.UPLOAD, 'Video úspěšně nahráno', { 
            title: title,
            filename: req.file.filename,
            size: req.file.size,
            user: req.user.username,
            category_id: category_id
        });
        
        const content = `
            <div class="alert success">Video "${title}" bylo úspěšně nahráno!</div>
            <a href="/" class="button">Zpět na hlavní stránku</a>
        `;
        
        res.send(getMainLayout('Nahrávání úspěšné', content));
    });
});

// Zobrazení formuláře pro editaci videa
app.get('/edit-video/:id', requirePermission(PERMISSIONS.UPLOAD_VIDEOS), (req, res) => {
    const videoId = req.params.id;
    
    // Načíst video
    queryDB(
        `SELECT v.*, c.name as category_name FROM videos v LEFT JOIN categories c ON v.category_id = c.id WHERE v.id = ?`,
        [videoId],
        (err, rows) => {
            if (err || rows.length === 0) {
                const content = `
                    <div class="alert error">Video nenalezeno!</div>
                    <a href="/" class="button">Zpět</a>
                `;
                return res.send(getMainLayout('Chyba', content));
            }
            
            const video = {
                id: rows[0][0],
                title: rows[0][1],
                description: rows[0][2],
                filename: rows[0][3],
                upload_date: rows[0][4],
                views: rows[0][5],
                size: rows[0][6],
                duration: rows[0][7],
                user_id: rows[0][8],
                category_id: rows[0][9],
                visibility: rows[0][10] || 'public',
                category_name: rows[0][11]
            };
            
            // Kontrola oprávnění - pouze vlastník nebo admin/editor může editovat
            const canEdit = req.user.id === video.user_id || 
                          hasPermission(req.user, PERMISSIONS.EDIT_ALL_VIDEOS);
            
            if (!canEdit) {
                const content = `
                    <div class="alert error">Nemáte oprávnění editovat toto video!</div>
                    <a href="/video/${videoId}" class="button">Zpět k videu</a>
                `;
                return res.send(getMainLayout('Přístup odepřen', content));
            }
            
            // Načíst kategorie
            loadCategories((err, categories) => {
                if (err) categories = [];
                
                const visibilityIcons = {
                    'public': '🌍',
                    'unlisted': '🔗', 
                    'private': '🔒'
                };
                
                const visibilityNames = {
                    'public': 'Veřejné',
                    'unlisted': 'Neveřejné přes link',
                    'private': 'Soukromé'
                };
                
                const content = `
                    <h2>✏️ Editace videa</h2>
                    
                    <div class="profile-section">
                        <h3>📼 Aktuální video: ${video.title}</h3>
                        <p><strong>Viditelnost:</strong> ${visibilityIcons[video.visibility]} ${visibilityNames[video.visibility]}</p>
                        <p><strong>Kategorie:</strong> ${video.category_name || 'Nezařazeno'}</p>
                        <p><strong>Nahráno:</strong> ${new Date(video.upload_date).toLocaleString('cs-CZ')}</p>
                        <p><strong>Zhlédnutí:</strong> ${video.views}</p>
                        
                        <form action="/edit-video/${videoId}" method="POST">
                            <div class="form-group">
                                <label for="title">Název videa:</label>
                                <input type="text" id="title" name="title" value="${video.title.replace(/"/g, '&quot;')}" required>
                            </div>
                            <div class="form-group">
                                <label for="description">Popis:</label>
                                <textarea id="description" name="description" rows="3">${video.description || ''}</textarea>
                            </div>
                            <div class="form-group">
                                <label for="category">Kategorie:</label>
                                <select id="category" name="category_id" required>
                                    <option value="">-- Vyberte kategorii --</option>
                                    ${categories.map(cat => 
                                        `<option value="${cat.id}" ${cat.id == video.category_id ? 'selected' : ''} style="color: ${cat.color};">${cat.icon} ${cat.name}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="visibility">Viditelnost:</label>
                                <select id="visibility" name="visibility" required>
                                    <option value="public" ${video.visibility === 'public' ? 'selected' : ''}>🌍 Veřejné - viditelné pro všechny</option>
                                    <option value="unlisted" ${video.visibility === 'unlisted' ? 'selected' : ''}>🔗 Neveřejné přes link - viditelné jen s přímým odkazem</option>
                                    <option value="private" ${video.visibility === 'private' ? 'selected' : ''}>🔒 Soukromé - viditelné jen pro vás</option>
                                </select>
                            </div>
                            <div class="form-actions">
                                <button type="submit" class="button">💾 Uložit změny</button>
                                <a href="/video/${videoId}" class="button" style="background: #6c757d;">↩️ Zpět</a>
                            </div>
                        </form>
                    </div>
                `;
                
                res.send(getMainLayout('Editace videa', content));
            });
        }
    );
});

// Uložení editace videa
app.post('/edit-video/:id', requirePermission(PERMISSIONS.UPLOAD_VIDEOS), (req, res) => {
    const videoId = req.params.id;
    const { title, description, category_id, visibility } = req.body;
    
    if (!title || !category_id || !visibility) {
        const content = `
            <div class="alert error">Název, kategorie a viditelnost jsou povinné!</div>
            <a href="/edit-video/${videoId}" class="button">Zpět</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    // Validace viditelnosti
    if (!['public', 'private', 'unlisted'].includes(visibility)) {
        const content = `
            <div class="alert error">Neplatná hodnota viditelnosti!</div>
            <a href="/edit-video/${videoId}" class="button">Zpět</a>
        `;
        return res.send(getMainLayout('Chyba', content));
    }
    
    // Načíst video pro kontrolu oprávnění
    queryDB(
        `SELECT user_id FROM videos WHERE id = ?`,
        [videoId],
        (err, rows) => {
            if (err || rows.length === 0) {
                const content = `
                    <div class="alert error">Video nenalezeno!</div>
                    <a href="/" class="button">Zpět</a>
                `;
                return res.send(getMainLayout('Chyba', content));
            }
            
            const videoUserId = rows[0][0];
            
            // Kontrola oprávnění
            const canEdit = req.user.id === videoUserId || 
                          hasPermission(req.user, PERMISSIONS.EDIT_ALL_VIDEOS);
            
            if (!canEdit) {
                const content = `
                    <div class="alert error">Nemáte oprávnění editovat toto video!</div>
                    <a href="/video/${videoId}" class="button">Zpět k videu</a>
                `;
                return res.send(getMainLayout('Přístup odepřen', content));
            }
            
            // Aktualizovat video
            queryDB(
                `UPDATE videos SET title = ?, description = ?, category_id = ?, visibility = ? WHERE id = ?`,
                [title, description || '', category_id, visibility, videoId],
                (err) => {
                    if (err) {
                        writeLog(LOG_TYPES.ERROR, 'Chyba při aktualizaci videa', { 
                            error: err.message,
                            videoId: videoId,
                            user: req.user.username 
                        });
                        
                        const content = `
                            <div class="alert error">Chyba při ukládání změn!</div>
                            <a href="/edit-video/${videoId}" class="button">Zkusit znovu</a>
                        `;
                        return res.send(getMainLayout('Chyba', content));
                    }
                    
                    writeLog(LOG_TYPES.INFO, 'Video úspěšně upraveno', { 
                        videoId: videoId,
                        title: title,
                        visibility: visibility,
                        user: req.user.username 
                    });
                    
                    const content = `
                        <div class="alert success">Video "${title}" bylo úspěšně upraveno!</div>
                        <a href="/video/${videoId}" class="button">Zobrazit video</a>
                        <a href="/" class="button" style="background: #6c757d;">Zpět domů</a>
                    `;
                    
                    res.send(getMainLayout('Editace úspěšná', content));
                }
            );
        }
    );
});

// Zobrazení videa
app.get('/video/:id', (req, res) => {
    const videoId = req.params.id;
    
    // Načíst video s dodatečnými informacemi pro kontrolu viditelnosti
    const sql = `
        SELECT v.*, u.username, c.name as category_name, c.icon as category_icon, c.color as category_color
        FROM videos v 
        LEFT JOIN users u ON v.user_id = u.id 
        LEFT JOIN categories c ON v.category_id = c.id
        WHERE v.id = ?
    `;
    
    queryDB(sql, [videoId], (err, rows) => {
        if (err || rows.length === 0) {
            writeLog(LOG_TYPES.ERROR, 'Video nenalezeno', { 
                videoId: videoId,
                error: err ? err.message : 'Not found'
            });
            
            const content = `
                <div class="alert error">Video nenalezeno!</div>
                <a href="/" class="button">Zpět domů</a>
            `;
            return res.send(getMainLayout('Video nenalezeno', content));
        }
        
        const video = {
            id: rows[0][0],
            title: rows[0][1],
            description: rows[0][2],
            filename: rows[0][3],
            upload_date: rows[0][4],
            views: rows[0][5],
            size: rows[0][6],
            duration: rows[0][7],
            user_id: rows[0][8],
            category_id: rows[0][9],
            visibility: rows[0][10] || 'public',
            username: rows[0][11],
            category_name: rows[0][12],
            category_icon: rows[0][13],
            category_color: rows[0][14]
        };
        
        // Kontrola viditelnosti
        const canView = video.visibility === 'public' || 
                       (req.user && req.user.id === video.user_id) ||
                       video.visibility === 'unlisted';
        
        if (!canView) {
            writeLog(LOG_TYPES.SECURITY, 'Pokus o přístup k soukromému videu', { 
                videoId: videoId,
                userId: req.user ? req.user.id : null,
                visibility: video.visibility 
            });
            
            const content = `
                <div class="alert error">Toto video je soukromé a nemáte k němu přístup!</div>
                <a href="/" class="button">Zpět domů</a>
            `;
            return res.send(getMainLayout('Přístup odepřen', content));
        }
        
        // Zvýšit počítadlo zhlédnutí pouze pokud uživatel může video vidět
        queryDB(`UPDATE videos SET views = views + 1 WHERE id = ?`, [videoId], () => {});
        
        // Načíst hodnocení videa
        queryDB(`
            SELECT 
                SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as likes,
                SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as dislikes,
                SUM(rating) as score
            FROM ratings WHERE video_id = ?
        `, [videoId], (err, ratingRows) => {
            let likes = 0, dislikes = 0, score = 0, userRating = null;
            
            if (!err && ratingRows.length > 0) {
                likes = parseInt(ratingRows[0][0]) || 0;
                dislikes = parseInt(ratingRows[0][1]) || 0;
                score = parseInt(ratingRows[0][2]) || 0;
            }
            
            // Načíst hodnocení aktuálního uživatele
            if (req.user) {
                queryDB(`SELECT rating FROM ratings WHERE video_id = ? AND user_id = ?`, [videoId, req.user.id], (err, userRatingRows) => {
                    if (!err && userRatingRows.length > 0) {
                        userRating = parseInt(userRatingRows[0][0]);
                    }
                    
                    renderVideoPage();
                });
            } else {
                renderVideoPage();
            }
            
            function renderVideoPage() {
                // Načíst komentáře
                queryDB(`
                    SELECT c.*, u.username 
                    FROM comments c 
                    LEFT JOIN users u ON c.user_id = u.id 
                    WHERE c.video_id = ? 
                    ORDER BY c.created_at DESC
                `, [videoId], (err, commentRows) => {
                    if (err) {
                        writeLog(LOG_TYPES.ERROR, 'Chyba při načítání komentářů', { error: err.message });
                        commentRows = [];
                    }
                    
                    const comments = commentRows.map(row => ({
                        id: row[0],
                        video_id: row[1],
                        user_id: row[2],
                        content: row[3],
                        created_at: row[4],
                        updated_at: row[5],
                        username: row[6]
                    }));
                    
                    // Načíst kategorie pro navigaci
                    loadCategories((err, categories) => {
                        if (err) categories = [];
                        
                        const content = `
                            <div style="margin-bottom: 20px;">
                                <a href="/" class="button secondary">⬅️ Zpět na hlavní stránku</a>
                                ${video.category_id ? `<a href="/?category=${video.category_id}" class="button secondary">📂 Kategorie: ${video.category_name}</a>` : ''}
                            </div>
                            
                            ${video.category_name ? `
                                <div class="video-category-badge" style="background-color: ${video.category_color}; display: inline-block; margin-bottom: 15px;">
                                    ${video.category_icon} ${video.category_name}
                                </div>
                            ` : ''}
                            
                            <h2>${video.title}</h2>
                            
                            <div class="video-meta" style="margin-bottom: 20px;">
                                👤 ${video.username || 'Neznámý'} | 
                                📅 ${new Date(video.upload_date).toLocaleDateString('cs-CZ')} | 
                                👁️ ${video.views} zhlédnutí
                                ${video.size ? ` | 📦 ${Math.round(video.size / 1024 / 1024)} MB` : ''}
                                ${(() => {
                                    const visibilityIcons = {
                                        'public': '🌍',
                                        'unlisted': '🔗', 
                                        'private': '🔒'
                                    };
                                    
                                    const visibilityNames = {
                                        'public': 'Veřejné',
                                        'unlisted': 'Neveřejné přes link',
                                        'private': 'Soukromé'
                                    };
                                    
                                    return ` | ${visibilityIcons[video.visibility] || '🌍'} ${visibilityNames[video.visibility] || 'Veřejné'}`;
                                })()}
                            </div>
                            
                            ${(() => {
                                const canEdit = req.user && (req.user.id === video.user_id || hasPermission(req.user, PERMISSIONS.EDIT_ALL_VIDEOS));
                                
                                return canEdit ? `
                                    <div style="margin-bottom: 20px;">
                                        <a href="/edit-video/${video.id}" class="button" style="background: #ffc107; color: #000;">✏️ Editovat video</a>
                                    </div>
                                ` : '';
                            })()}
                            
                            <video controls style="width: 100%; max-width: 800px;" data-video-id="${video.id}">
                                <source src="/${video.filename}" type="video/mp4">
                                Váš prohlížeč nepodporuje video element.
                            </video>
                            
                            ${video.description ? `
                                <div style="margin: 20px 0;">
                                    <h3>📝 Popis</h3>
                                    <p>${video.description}</p>
                                </div>
                            ` : ''}
                            
                            <!-- Statistiky videa (pouze pro vlastníka/admin) -->
                            ${(req.user && (req.user.id == video.user_id || hasPermission(req.user, PERMISSIONS.MANAGE_USERS))) ? `
                                <div class="video-stats-section" style="margin: 20px 0; padding: 15px; background: #f0f8ff; border-radius: 8px; border: 1px solid #b3d9ff;">
                                    <h3>📊 Statistiky sledování</h3>
                                    <div id="video-stats-${video.id}" class="video-stats">
                                        <div class="stats-loading">⏳ Načítám statistiky...</div>
                                    </div>
                                </div>
                            ` : ''}
                            
                            <!-- Hodnocení videa -->
                            <div class="video-rating-section">
                                <h3>⭐ Hodnocení videa</h3>
                                <div class="video-rating">
                                    ${req.user ? `
                                        <button class="rating-btn like-btn ${userRating === 1 ? 'active' : ''}" onclick="rateVideo(${video.id}, 1)">
                                            👍 ${likes}
                                        </button>
                                        <button class="rating-btn dislike-btn ${userRating === -1 ? 'active' : ''}" onclick="rateVideo(${video.id}, -1)">
                                            👎 ${dislikes}
                                        </button>
                                    ` : `
                                        <span class="rating-display">👍 ${likes}</span>
                                        <span class="rating-display">👎 ${dislikes}</span>
                                    `}
                                    <div class="score">Skóre: ${score}</div>
                                </div>
                                ${!req.user ? '<p><em>Pro hodnocení se musíte <a href="/login">přihlásit</a>.</em></p>' : ''}
                            </div>
                            
                            <!-- Sekce komentářů -->
                            <div style="margin-top: 30px;">
                                <h3>💬 Komentáře (${comments.length})</h3>
                                
                                ${req.user ? `
                                    <form action="/comment" method="POST" style="margin: 20px 0;">
                                        <input type="hidden" name="video_id" value="${video.id}">
                                        <div class="form-group">
                                            <textarea name="content" placeholder="Napište komentář..." rows="3" required></textarea>
                                        </div>
                                        <button type="submit" class="button">💬 Přidat komentář</button>
                                    </form>
                                ` : `
                                    <p><em>Pro přidání komentáře se musíte <a href="/login">přihlásit</a>.</em></p>
                                `}
                                
                                <div class="comments">
                                    ${comments.length === 0 ? `
                                        <p><em>Zatím žádné komentáře.</em></p>
                                    ` : comments.map(comment => `
                                        <div class="comment">
                                            <div class="comment-author">${comment.username || 'Neznámý'}</div>
                                            <div class="comment-date">${new Date(comment.created_at).toLocaleString('cs-CZ')}</div>
                                            <div class="comment-content" id="comment-content-${comment.id}">
                                                ${comment.content}
                                                ${comment.updated_at ? '<em style="color: #888; font-size: 12px;"> (upraveno)</em>' : ''}
                                            </div>
                                            
                                            <!-- Like/Dislike tlačítka pro komentáře -->
                                            <div class="comment-likes" id="comment-likes-${comment.id}">
                                                ${req.user ? `
                                                    <button class="like-btn" onclick="likeComment(${comment.id}, 1)" 
                                                            id="like-btn-${comment.id}" title="Líbí se mi">
                                                        👍 <span id="likes-count-${comment.id}">0</span>
                                                    </button>
                                                    <button class="dislike-btn" onclick="likeComment(${comment.id}, -1)" 
                                                            id="dislike-btn-${comment.id}" title="Nelíbí se mi">
                                                        👎 <span id="dislikes-count-${comment.id}">0</span>
                                                    </button>
                                                ` : `
                                                    <span class="likes-display">👍 <span id="likes-count-${comment.id}">0</span></span>
                                                    <span class="dislikes-display">👎 <span id="dislikes-count-${comment.id}">0</span></span>
                                                `}
                                            </div>
                                            
                                            <div class="comment-edit-form" id="comment-edit-${comment.id}" style="display: none;">
                                                <textarea id="comment-textarea-${comment.id}" rows="3">${comment.content}</textarea>
                                                <div style="margin-top: 10px;">
                                                    <button class="button" onclick="saveComment(${comment.id})">💾 Uložit</button>
                                                    <button class="button secondary" onclick="cancelEdit(${comment.id})">❌ Zrušit</button>
                                                </div>
                                            </div>
                                            
                                            ${(req.user && (req.user.id == comment.user_id || hasPermission(req.user, PERMISSIONS.MODERATE_COMMENTS))) ? `
                                                <div class="comment-actions">
                                                    ${req.user.id == comment.user_id ? `
                                                        <button class="button warning" onclick="editComment(${comment.id})">✏️ Upravit</button>
                                                    ` : ''}
                                                    <form action="/comment/${comment.id}/delete" method="POST" style="display: inline;" 
                                                          onsubmit="return confirm('Opravdu smazat tento komentář?')">
                                                        <button type="submit" class="button danger">🗑️ Smazat</button>
                                                    </form>
                                                </div>
                                            ` : ''}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                        
                        res.send(getMainLayout(`${video.title} - VideoPortal`, content, req.user, categories));
                    });
                });
            }
        });
    });
});

// API pro hodnocení videí
app.post('/api/rate-video', requirePermission(PERMISSIONS.UPLOAD_VIDEOS), (req, res) => {
    const { videoId, rating } = req.body;
    
    if (!videoId || ![1, -1].includes(rating)) {
        return res.status(400).json({ error: 'Neplatné parametry' });
    }
    
    // Zkontrolovat, zda uživatel již hodnotil
    queryDB(
        `SELECT rating FROM ratings WHERE video_id = ? AND user_id = ?`, 
        [videoId, req.user.id], 
        (err, existingRating) => {
            if (err) {
                return res.status(500).json({ error: 'Chyba databáze' });
            }
            
            if (existingRating.length > 0) {
                const currentRating = parseInt(existingRating[0][0]);
                
                if (currentRating === rating) {
                    // Zrušit hodnocení
                    queryDB(
                        `DELETE FROM ratings WHERE video_id = ? AND user_id = ?`,
                        [videoId, req.user.id],
                        (err) => {
                            if (err) {
                                return res.status(500).json({ error: 'Chyba při rušení hodnocení' });
                            }
                            
                            // Načíst aktuální statistiky
                            loadVideoRatingStats(videoId, (stats) => {
                                res.json({
                                    success: true,
                                    userRating: null,
                                    ...stats
                                });
                            });
                        }
                    );
                } else {
                    // Změnit hodnocení
                    queryDB(
                        `UPDATE ratings SET rating = ?, created_at = CURRENT_TIMESTAMP WHERE video_id = ? AND user_id = ?`,
                        [rating, videoId, req.user.id],
                        (err) => {
                            if (err) {
                                return res.status(500).json({ error: 'Chyba při změně hodnocení' });
                            }
                            
                            // Načíst aktuální statistiky
                            loadVideoRatingStats(videoId, (stats) => {
                                res.json({
                                    success: true,
                                    userRating: rating,
                                    ...stats
                                });
                            });
                        }
                    );
                }
            } else {
                // Přidat nové hodnocení
                queryDB(
                    `INSERT INTO ratings (video_id, user_id, rating) VALUES (?, ?, ?)`,
                    [videoId, req.user.id, rating],
                    (err) => {
                        if (err) {
                            return res.status(500).json({ error: 'Chyba při přidání hodnocení' });
                        }
                        
                        // Načíst aktuální statistiky
                        loadVideoRatingStats(videoId, (stats) => {
                            res.json({
                                success: true,
                                userRating: rating,
                                ...stats
                            });
                        });
                    }
                );
            }
        }
    );
});

// Pomocná funkce pro načtení statistik hodnocení
function loadVideoRatingStats(videoId, callback) {
    queryDB(`
        SELECT 
            SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as likes,
            SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as dislikes,
            SUM(rating) as score
        FROM ratings WHERE video_id = ?
    `, [videoId], (err, rows) => {
        let likes = 0, dislikes = 0, score = 0;
        
        if (!err && rows.length > 0) {
            likes = parseInt(rows[0][0]) || 0;
            dislikes = parseInt(rows[0][1]) || 0;
            score = parseInt(rows[0][2]) || 0;
        }
        
        callback({ likes, dislikes, score });
    });
}

// Přidání komentáře
app.post('/comment', requirePermission(PERMISSIONS.UPLOAD_VIDEOS), (req, res) => {
    const { video_id, content } = req.body;
    
    if (!video_id || !content || content.trim().length === 0) {
        return res.redirect(`/video/${video_id}?error=empty`);
    }
    
    const sql = `INSERT INTO comments (video_id, user_id, content) VALUES (?, ?, ?)`;
    
    queryDB(sql, [video_id, req.user.id, content.trim()], (err, result) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při přidávání komentáře', { 
                error: err.message,
                video_id: video_id,
                user: req.user.username
            });
        } else {
            writeLog(LOG_TYPES.USER, 'Komentář přidán', { 
                video_id: video_id,
                user: req.user.username,
                content_length: content.length
            });
        }
        
        res.redirect(`/video/${video_id}`);
    });
});

// Smazání komentáře
app.post('/comment/:id/delete', (req, res) => {
    const commentId = req.params.id;
    
    if (!req.user) {
        return res.status(401).redirect('/login');
    }
    
    // Najít komentář a zkontrolovat oprávnění
    queryDB(`SELECT user_id, video_id FROM comments WHERE id = ?`, [commentId], (err, rows) => {
        if (err || rows.length === 0) {
            return res.status(404).redirect('/');
        }
        
        const comment = { user_id: rows[0][0], video_id: rows[0][1] };
        
        // Kontrola oprávnění - vlastník komentáře nebo moderátor
        if (req.user.id != comment.user_id && !hasPermission(req.user, PERMISSIONS.MODERATE_COMMENTS)) {
            writeLog(LOG_TYPES.SECURITY, 'Pokus o smazání cizího komentáře', { 
                commentId: commentId,
                user: req.user.username,
                commentOwner: comment.user_id
            });
            return res.status(403).redirect(`/video/${comment.video_id}`);
        }
        
        queryDB(`DELETE FROM comments WHERE id = ?`, [commentId], (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při mazání komentáře', { 
                    error: err.message,
                    commentId: commentId,
                    user: req.user.username
                });
            } else {
                writeLog(LOG_TYPES.USER, 'Komentář smazán', { 
                    commentId: commentId,
                    user: req.user.username,
                    video_id: comment.video_id
                });
            }
            
            res.redirect(`/video/${comment.video_id}`);
        });
    });
});

// Aktualizace komentáře
app.post('/api/comment/:id/update', (req, res) => {
    const commentId = req.params.id;
    const { content } = req.body;
    
    if (!req.user) {
        return res.status(401).json({ error: 'Nejste přihlášeni' });
    }
    
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Komentář nemůže být prázdný' });
    }
    
    // Najít komentář a zkontrolovat oprávnění
    queryDB(`SELECT user_id, video_id FROM comments WHERE id = ?`, [commentId], (err, rows) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při hledání komentáře pro úpravu', { 
                error: err.message,
                commentId: commentId,
                user: req.user.username
            });
            return res.status(500).json({ error: 'Chyba databáze' });
        }
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Komentář nenalezen' });
        }
        
        const comment = { user_id: rows[0][0], video_id: rows[0][1] };
        
        // Kontrola oprávnění - pouze vlastník může editovat
        if (req.user.id != comment.user_id) {
            writeLog(LOG_TYPES.SECURITY, 'Pokus o úpravu cizího komentáře', { 
                commentId: commentId,
                user: req.user.username,
                commentOwner: comment.user_id
            });
            return res.status(403).json({ error: 'Nemáte oprávnění upravovat tento komentář' });
        }
        
        // Aktualizovat komentář
        const sql = `UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        
        queryDB(sql, [content.trim(), commentId], (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při aktualizaci komentáře', { 
                    error: err.message,
                    commentId: commentId,
                    user: req.user.username
                });
                return res.status(500).json({ error: 'Chyba při ukládání komentáře' });
            }
            
            writeLog(LOG_TYPES.USER, 'Komentář upraven', { 
                commentId: commentId,
                user: req.user.username,
                video_id: comment.video_id
            });
            
            res.json({ success: true });
        });
    });
});

// Kategorie management routes
app.post('/admin/category/create', requirePermission(PERMISSIONS.MANAGE_CATEGORIES), (req, res) => {
    const { name, icon, color } = req.body;
    
    if (!name || name.trim().length === 0) {
        return res.redirect('/admin?error=empty_name');
    }
    
    const finalIcon = icon && icon.trim().length > 0 ? icon.trim() : '📁';
    const finalColor = color || '#007bff';
    
    queryDB(
        `INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)`,
        [name.trim(), finalIcon, finalColor],
        (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při vytváření kategorie', { 
                    error: err.message,
                    name: name,
                    user: req.user.username
                });
            } else {
                writeLog(LOG_TYPES.ADMIN, 'Kategorie vytvořena', { 
                    name: name,
                    icon: finalIcon,
                    color: finalColor,
                    user: req.user.username
                });
            }
            
            res.redirect('/admin');
        }
    );
});

app.post('/admin/category/:id/delete', requirePermission(PERMISSIONS.MANAGE_CATEGORIES), (req, res) => {
    const categoryId = req.params.id;
    
    // Najít název kategorie pro log
    queryDB('SELECT name FROM categories WHERE id = ?', [categoryId], (err, rows) => {
        const categoryName = rows && rows.length > 0 ? rows[0][0] : 'neznámá';
        
        // Smazat kategorii (videa zůstanou, ale bez kategorie)
        queryDB('DELETE FROM categories WHERE id = ?', [categoryId], (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při mazání kategorie', { 
                    error: err.message,
                    categoryId: categoryId,
                    user: req.user.username
                });
                return res.status(500).json({ error: 'Chyba při mazání kategorie' });
            }
            
            writeLog(LOG_TYPES.ADMIN, 'Kategorie smazána', { 
                categoryId: categoryId,
                categoryName: categoryName,
                user: req.user.username
            });
            
            res.json({ success: true });
        });
    });
});

// Profile page
app.get('/profile', (req, res) => {
    if (!req.user) {
        return res.redirect('/login');
    }
    
    // Načíst uživatelova videa
    queryDB(`
        SELECT v.*, c.name as category_name, c.icon as category_icon, c.color as category_color
        FROM videos v 
        LEFT JOIN categories c ON v.category_id = c.id
        WHERE v.user_id = ? 
        ORDER BY v.upload_date DESC
    `, [req.user.id], (err, videoRows) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při načítání uživatelových videí', { error: err.message });
            videoRows = [];
        }
        
        const userVideos = videoRows.map(row => ({
            id: row[0],
            title: row[1],
            description: row[2],
            filename: row[3],
            upload_date: row[4],
            views: row[5],
            size: row[6],
            duration: row[7],
            user_id: row[8],
            category_id: row[9],
            visibility: row[10] || 'public',
            category_name: row[11],
            category_icon: row[12],
            category_color: row[13]
        }));
        
        // Načíst uživatelovy komentáře
        queryDB(`
            SELECT c.*, v.title as video_title
            FROM comments c 
            LEFT JOIN videos v ON c.video_id = v.id
            WHERE c.user_id = ? 
            ORDER BY c.created_at DESC 
            LIMIT 10
        `, [req.user.id], (err, commentRows) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při načítání uživatelových komentářů', { error: err.message });
                commentRows = [];
            }
            
            const userComments = commentRows.map(row => ({
                id: row[0],
                video_id: row[1],
                user_id: row[2],
                content: row[3],
                created_at: row[4],
                updated_at: row[5],
                video_title: row[6]
            }));
            
            // Načíst kategorie
            loadCategories((err, categories) => {
                if (err) categories = [];
                
                const content = `
                    <h2>👤 Můj profil</h2>
                    
                    <div class="settings-tabs">
                        <button class="settings-tab active" onclick="showProfileTab('info')">ℹ️ Informace</button>
                        <button class="settings-tab" onclick="showProfileTab('videos')">🎥 Moje videa</button>
                        <button class="settings-tab" onclick="showProfileTab('comments')">💬 Moje komentáře</button>
                        ${hasPermission(req.user, PERMISSIONS.EDIT_OWN_PROFILE) ? '<button class="settings-tab" onclick="showProfileTab(\'settings\')">⚙️ Nastavení</button>' : ''}
                    </div>
                    
                    <div id="info" class="settings-content active">
                        <h3>ℹ️ Informace o účtu</h3>
                        <div class="profile-info">
                            <div class="profile-label">Uživatelské jméno:</div>
                            <div class="profile-value">
                                ${req.user.username}
                                ${req.user.roles && req.user.roles.length > 0 ? 
                                    req.user.roles.map(role => `<span class="role-badge ${role.name.toLowerCase()}" style="background-color: ${role.color};">${role.display_name}</span>`).join('') 
                                    : ''
                                }
                            </div>
                            <div class="profile-label">Registrován:</div>
                            <div class="profile-value">${new Date(req.user.created_at).toLocaleDateString('cs-CZ')}</div>
                            <div class="profile-label">Počet videí:</div>
                            <div class="profile-value">${userVideos.length}</div>
                            <div class="profile-label">Počet komentářů:</div>
                            <div class="profile-value">${userComments.length}</div>
                            ${req.user.roles && req.user.roles.length > 0 ? `
                                <div class="profile-label">Role:</div>
                                <div class="profile-value">
                                    ${req.user.roles.map(role => role.display_name).join(', ')}
                                </div>
                            ` : ''}
                            ${req.user.permissions && req.user.permissions.length > 0 ? `
                                <div class="profile-label">Oprávnění:</div>
                                <div class="profile-value">
                                    <details>
                                        <summary>Zobrazit oprávnění (${req.user.permissions.length})</summary>
                                        <ul style="margin: 10px 0;">
                                            ${req.user.permissions.map(permission => `<li>${permission}</li>`).join('')}
                                        </ul>
                                    </details>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div id="videos" class="settings-content">
                        <h3>🎥 Moje videa (${userVideos.length})</h3>
                        ${userVideos.length === 0 ? `
                            <p><em>Zatím jste nenahrál žádná videa.</em></p>
                        ` : `
                            <div class="videos-list">
                                ${userVideos.map(video => {
                                    const visibilityIcons = {
                                        'public': '🌍',
                                        'unlisted': '🔗', 
                                        'private': '🔒'
                                    };
                                    
                                    const visibilityTitles = {
                                        'public': 'Veřejné',
                                        'unlisted': 'Neveřejné přes link',
                                        'private': 'Soukromé'
                                    };
                                    
                                    return `
                                        <div class="video-item">
                                            ${video.category_name ? `
                                                <div class="video-category-badge" style="background-color: ${video.category_color};">
                                                    ${video.category_icon} ${video.category_name}
                                                </div>
                                            ` : ''}
                                            <div class="video-title">
                                                <a href="/video/${video.id}" style="text-decoration: none; color: inherit;">
                                                    ${video.title}
                                                </a>
                                                <span style="margin-left: 10px; font-size: 0.9em;" title="${visibilityTitles[video.visibility] || 'Veřejné'}">
                                                    ${visibilityIcons[video.visibility] || '🌍'}
                                                </span>
                                            </div>
                                            <div class="video-meta">
                                                📅 ${new Date(video.upload_date).toLocaleDateString('cs-CZ')} | 
                                                👁️ ${video.views} zhlédnutí
                                                ${video.size ? ` | 📦 ${Math.round(video.size / 1024 / 1024)} MB` : ''}
                                            </div>
                                            ${video.description ? `<p>${video.description}</p>` : ''}
                                            <div class="video-actions">
                                                <a href="/video/${video.id}" class="button">▶️ Přehrát</a>
                                                <a href="/edit-video/${video.id}" class="button" style="background: #ffc107; color: #000;">✏️ Editovat</a>
                                                ${hasPermission(req.user, PERMISSIONS.DELETE_OWN_VIDEOS) ? `
                                                    <form action="/video/${video.id}/delete" method="POST" style="display: inline;" 
                                                          onsubmit="return confirm('Opravdu smazat video &quot;${video.title}&quot;?')">
                                                        <button type="submit" class="button danger">🗑️ Smazat</button>
                                                    </form>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>
                    
                    <div id="comments" class="settings-content">
                        <h3>💬 Moje komentáře (posledních 10)</h3>
                        ${userComments.length === 0 ? `
                            <p><em>Zatím jste nenapsal žádné komentáře.</em></p>
                        ` : `
                            <div class="comments">
                                ${userComments.map(comment => `
                                    <div class="comment">
                                        <div class="comment-date">${new Date(comment.created_at).toLocaleString('cs-CZ')}</div>
                                        <div class="comment-video">
                                            K videu: <a href="/video/${comment.video_id}">${comment.video_title || 'Neznámé video'}</a>
                                        </div>
                                        <div class="comment-content">
                                            ${comment.content}
                                            ${comment.updated_at ? '<em style="color: #888; font-size: 12px;"> (upraveno)</em>' : ''}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>
                    
                    ${hasPermission(req.user, PERMISSIONS.EDIT_OWN_PROFILE) ? `
                        <div id="settings" class="settings-content">
                            <h3>⚙️ Nastavení účtu</h3>
                            
                            <div class="profile-section">
                                <h4>🔐 Změna hesla</h4>
                                <form action="/profile/change-password" method="POST">
                                    <div class="form-group">
                                        <label for="current_password">Současné heslo:</label>
                                        <input type="password" id="current_password" name="current_password" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="new_password">Nové heslo:</label>
                                        <input type="password" id="new_password" name="new_password" required minlength="6">
                                    </div>
                                    <div class="form-group">
                                        <label for="confirm_password">Potvrzení nového hesla:</label>
                                        <input type="password" id="confirm_password" name="confirm_password" required>
                                    </div>
                                    <button type="submit" class="button warning">🔐 Změnit heslo</button>
                                </form>
                            </div>
                            
                            <div class="danger-zone">
                                <h4>⚠️ Nebezpečná zona</h4>
                                <p>Akce v této sekci nelze vrátit zpět!</p>
                                <form action="/profile/delete-account" method="POST" 
                                      onsubmit="return confirm('VAROVÁNÍ: Opravdu chcete smazat svůj účet? Tato akce je nevratná!')">
                                    <button type="submit" class="button danger">💀 Smazat účet</button>
                                </form>
                            </div>
                        </div>
                    ` : ''}
                `;
                
                res.send(getMainLayout('Můj profil', content, req.user, categories));
            });
        });
    });
});

// Smazání vlastního videa
app.post('/video/:id/delete', requirePermission(PERMISSIONS.DELETE_OWN_VIDEOS), (req, res) => {
    const videoId = req.params.id;
    
    // Najít video a zkontrolovat vlastnictví nebo moderátorská práva
    queryDB(`SELECT user_id, filename, title FROM videos WHERE id = ?`, [videoId], (err, rows) => {
        if (err || rows.length === 0) {
            return res.redirect('/profile?error=video_not_found');
        }
        
        const video = { 
            user_id: rows[0][0], 
            filename: rows[0][1], 
            title: rows[0][2] 
        };
        
        // Kontrola oprávnění
        if (req.user.id != video.user_id && !hasPermission(req.user, PERMISSIONS.MODERATE_VIDEOS)) {
            writeLog(LOG_TYPES.SECURITY, 'Pokus o smazání cizího videa', { 
                videoId: videoId,
                user: req.user.username,
                videoOwner: video.user_id
            });
            return res.redirect('/profile?error=permission_denied');
        }
        
        // Smazat soubor z disku
        const filePath = path.join('uploads', video.filename);
        fs.unlink(filePath, (err) => {
            if (err) {
                writeLog(LOG_TYPES.WARNING, 'Chyba při mazání video souboru', { 
                    error: err.message,
                    filename: video.filename
                });
            }
        });
        
        // Smazat z databáze
        queryDB(`DELETE FROM videos WHERE id = ?`, [videoId], (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při mazání videa z databáze', { 
                    error: err.message,
                    videoId: videoId,
                    user: req.user.username
                });
            } else {
                writeLog(LOG_TYPES.USER, 'Video smazáno', { 
                    videoId: videoId,
                    title: video.title,
                    user: req.user.username
                });
            }
            
            res.redirect('/profile');
        });
    });
});

// Změna hesla
app.post('/profile/change-password', requirePermission(PERMISSIONS.EDIT_OWN_PROFILE), (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    
    if (!current_password || !new_password || !confirm_password) {
        return res.redirect('/profile?error=missing_fields');
    }
    
    if (new_password !== confirm_password) {
        return res.redirect('/profile?error=password_mismatch');
    }
    
    if (new_password.length < 6) {
        return res.redirect('/profile?error=password_short');
    }
    
    // Ověřit současné heslo
    const currentPasswordHash = hashPassword(current_password);
    
    queryDB(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id], (err, rows) => {
        if (err || rows.length === 0) {
            return res.redirect('/profile?error=user_not_found');
        }
        
        if (rows[0][0] !== currentPasswordHash) {
            writeLog(LOG_TYPES.SECURITY, 'Neúspěšný pokus o změnu hesla - špatné současné heslo', { 
                user: req.user.username
            });
            return res.redirect('/profile?error=wrong_current_password');
        }
        
        // Změnit heslo
        const newPasswordHash = hashPassword(new_password);
        
        queryDB(`UPDATE users SET password_hash = ? WHERE id = ?`, [newPasswordHash, req.user.id], (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při změně hesla', { 
                    error: err.message,
                    user: req.user.username
                });
                return res.redirect('/profile?error=change_failed');
            }
            
            writeLog(LOG_TYPES.USER, 'Heslo změněno', { user: req.user.username });
            res.redirect('/profile?success=password_changed');
        });
    });
});

// Smazání účtu
app.post('/profile/delete-account', requirePermission(PERMISSIONS.EDIT_OWN_PROFILE), (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    
    // Smazat uživatele (cascade by měl smazat související data)
    queryDB(`DELETE FROM users WHERE id = ?`, [userId], (err) => {
        if (err) {
            writeLog(LOG_TYPES.ERROR, 'Chyba při mazání účtu', { 
                error: err.message,
                user: username
            });
            return res.redirect('/profile?error=delete_failed');
        }
        
        writeLog(LOG_TYPES.USER, 'Účet smazán', { user: username });
        
        // Smazat cookie a odhlásit uživatele
        const cookies = parseCookies(req);
        const sessionId = cookies.sessionId;
        if (sessionId && sessions[sessionId]) {
            delete sessions[sessionId];
        }
        
        // Smazat cookie a redirect
        res.clearCookie('sessionId');
        res.redirect('/');
    });
});

// Start server
// ===== API ENDPOINTY PRO STATISTIKY A HODNOCENÍ =====

// API endpoint pro zaznamenání sledování videa
app.post('/api/video/:id/view', (req, res) => {
    const videoId = req.params.id;
    const userId = req.user ? req.user.id : null;
    const viewerIp = req.ip || req.connection.remoteAddress;
    const watchDuration = parseInt(req.body.duration) || 0;
    const completed = req.body.completed === 'true' || req.body.completed === true;
    
    // Zaznamenat sledování
    queryDB(
        `INSERT INTO video_views (video_id, user_id, viewer_ip, watch_duration, completed) 
         VALUES (?, ?, ?, ?, ?)`,
        [videoId, userId, viewerIp, watchDuration, completed ? 1 : 0],
        (err) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při zaznamenání sledování videa', {
                    error: err.message,
                    videoId: videoId,
                    userId: userId
                });
                return res.status(500).json({ error: 'Chyba při zaznamenání sledování' });
            }
            
            writeLog(LOG_TYPES.INFO, 'Zaznamenáno sledování videa', {
                videoId: videoId,
                userId: userId,
                duration: watchDuration,
                completed: completed
            });
            
            res.json({ success: true });
        }
    );
});

// API endpoint pro získání statistik videa
app.get('/api/video/:id/stats', (req, res) => {
    const videoId = req.params.id;
    
    // Kontrola oprávnění - pouze vlastník videa nebo admin
    queryDB(`SELECT user_id FROM videos WHERE id = ?`, [videoId], (err, videoRows) => {
        if (err || videoRows.length === 0) {
            return res.status(404).json({ error: 'Video nenalezeno' });
        }
        
        const isOwner = req.user && req.user.id == videoRows[0][0];
        const isAdmin = req.user && hasPermission(req.user, PERMISSIONS.MANAGE_USERS);
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Nedostatečná oprávnění' });
        }
        
        // Získat statistiky
        queryDB(
            `SELECT 
                COUNT(*) as total_views,
                COUNT(DISTINCT user_id) as unique_viewers,
                COUNT(DISTINCT viewer_ip) as unique_ips,
                AVG(watch_duration) as avg_duration,
                COUNT(CASE WHEN completed = 1 THEN 1 END) as completed_views,
                MAX(viewed_at) as last_view
             FROM video_views 
             WHERE video_id = ?`,
            [videoId],
            (err, rows) => {
                if (err) {
                    writeLog(LOG_TYPES.ERROR, 'Chyba při načítání statistik videa', { error: err.message });
                    return res.status(500).json({ error: 'Chyba při načítání statistik' });
                }
                
                const stats = rows[0] || {};
                res.json({
                    totalViews: parseInt(stats[0]) || 0,
                    uniqueViewers: parseInt(stats[1]) || 0,
                    uniqueIps: parseInt(stats[2]) || 0,
                    averageDuration: Math.round(parseFloat(stats[3]) || 0),
                    completedViews: parseInt(stats[4]) || 0,
                    lastView: stats[5] || null
                });
            }
        );
    });
});

// API endpoint pro like/dislike komentáře
app.post('/api/comment/:id/like', requireLogin, (req, res) => {
    const commentId = req.params.id;
    const userId = req.user.id;
    const likeType = req.body.type; // 1 pro like, -1 pro dislike, 0 pro odebrání
    
    if (![1, -1, 0].includes(parseInt(likeType))) {
        return res.status(400).json({ error: 'Neplatný typ hodnocení' });
    }
    
    // Zkontrolovat, zda komentář existuje
    queryDB(`SELECT id FROM comments WHERE id = ?`, [commentId], (err, commentRows) => {
        if (err || commentRows.length === 0) {
            return res.status(404).json({ error: 'Komentář nenalezen' });
        }
        
        if (parseInt(likeType) === 0) {
            // Odebrání hodnocení
            queryDB(
                `DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?`,
                [commentId, userId],
                (err) => {
                    if (err) {
                        writeLog(LOG_TYPES.ERROR, 'Chyba při odebírání hodnocení komentáře', { error: err.message });
                        return res.status(500).json({ error: 'Chyba při odebírání hodnocení' });
                    }
                    
                    res.json({ success: true, action: 'removed' });
                }
            );
        } else {
            // Přidání nebo změna hodnocení
            queryDB(
                `INSERT OR REPLACE INTO comment_likes (comment_id, user_id, like_type) 
                 VALUES (?, ?, ?)`,
                [commentId, userId, parseInt(likeType)],
                (err) => {
                    if (err) {
                        writeLog(LOG_TYPES.ERROR, 'Chyba při hodnocení komentáře', { error: err.message });
                        return res.status(500).json({ error: 'Chyba při hodnocení komentáře' });
                    }
                    
                    writeLog(LOG_TYPES.INFO, 'Hodnocení komentáře', {
                        commentId: commentId,
                        userId: userId,
                        type: likeType === 1 ? 'like' : 'dislike'
                    });
                    
                    res.json({ success: true, action: likeType === 1 ? 'liked' : 'disliked' });
                }
            );
        }
    });
});

// API endpoint pro získání hodnocení komentáře
app.get('/api/comment/:id/likes', (req, res) => {
    const commentId = req.params.id;
    
    queryDB(
        `SELECT 
            SUM(CASE WHEN like_type = 1 THEN 1 ELSE 0 END) as likes,
            SUM(CASE WHEN like_type = -1 THEN 1 ELSE 0 END) as dislikes,
            (SELECT like_type FROM comment_likes WHERE comment_id = ? AND user_id = ?) as user_vote
         FROM comment_likes 
         WHERE comment_id = ?`,
        [commentId, req.user ? req.user.id : null, commentId],
        (err, rows) => {
            if (err) {
                writeLog(LOG_TYPES.ERROR, 'Chyba při načítání hodnocení komentáře', { error: err.message });
                return res.status(500).json({ error: 'Chyba při načítání hodnocení' });
            }
            
            const result = rows[0] || {};
            res.json({
                likes: parseInt(result[0]) || 0,
                dislikes: parseInt(result[1]) || 0,
                userVote: result[2] ? parseInt(result[2]) : null
            });
        }
    );
});

// ===== 404 HANDLER (MUSÍ BÝT AŽ NAKONEC) =====

// 404 handler - musí být až po všech route definicích
app.use((req, res) => {
    writeLog(LOG_TYPES.WARNING, `404 - Stránka nenalezena: ${req.url}`, { 
        method: req.method,
        ip: req.ip,
        user: req.user ? req.user.username : 'anonymous'
    });
    
    loadCategories((err, categories) => {
        if (err) categories = [];
        
        const content = `
            <div class="alert error">Stránka nenalezena!</div>
            <a href="/" class="button">Zpět domů</a>
        `;
        res.send(getMainLayout('Stránka nenalezena', content, req.user, categories));
    });
});

// ===== INICIALIZACE SERVERU =====

writeLog(LOG_TYPES.INFO, '🚀 Spouštění VideoPortal serveru s kompletním admin panelem...', { 
    port: PORT,
    nodeVersion: process.version,
    platform: process.platform 
});

initDatabase();
app.listen(PORT, () => {
    writeLog(LOG_TYPES.INFO, '✅ VideoPortal úspěšně spuštěn', { 
        port: PORT,
        url: `http://localhost:${PORT}`,
        features: ['Users', 'Comments', 'Ratings', 'User Management', 'Comment Editing', 'Categories', 'Roles & Permissions', 'Complete Admin Panel', 'Logging', 'Video Statistics', 'Comment Likes/Dislikes', 'View Tracking'],
        platform: process.platform 
    });
    
    console.log(`🚀 VideoPortal spuštěn na portu ${PORT}`);
    console.log(`🌐 Otevřete v prohlížeči: http://localhost:${PORT}`);
    console.log(`👥 Uživatelé: AKTIVNÍ`);
    console.log(`💬 Komentáře: AKTIVNÍ`);
    console.log(`⭐ Hodnocení: AKTIVNÍ`);
    console.log(`👤 Správa profilu: AKTIVNÍ`);
    console.log(`✏️ Úprava komentářů: AKTIVNÍ`);
    console.log(`🗂️ Kategorie videí: AKTIVNÍ`);
    console.log(`🎭 Role a oprávnění: AKTIVNÍ`);
    console.log(`🔧 Kompletní admin panel: AKTIVNÍ`);
    console.log(`📋 Logování: AKTIVNÍ`);
    console.log(`📊 Statistiky sledování: AKTIVNÍ`);
    console.log(`👍👎 Like/Dislike komentářů: AKTIVNÍ`);
    console.log(`👁️ Tracking zhlédnutí: AKTIVNÍ`);
    console.log(`📱 Termux prostředí: ${process.platform}`);
    console.log(`📝 Pro ukončení: Ctrl+C`);
});

function getMainLayout(title, content, user = null, categories = []) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${title} - VideoPortal</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: Arial, sans-serif; margin: 0; background: #f5f5f5; }
                .header { background: #007bff; color: white; padding: 15px; }
                .header-content { max-width: 1000px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
                .header h1 { margin: 0; }
                .header-nav { display: flex; flex-wrap: wrap; gap: 15px; }
                .header-nav a { color: white; text-decoration: none; }
                .header-nav a:hover { text-decoration: underline; }
                
                /* 🆕 ROLE BADGES */
                .role-badge { 
                    display: inline-block;
                    padding: 2px 6px; 
                    border-radius: 10px; 
                    font-size: 11px; 
                    font-weight: bold; 
                    margin-left: 5px;
                    color: white;
                }
                .role-badge.admin { background: #dc3545; }
                .role-badge.editor { background: #17a2b8; }
                .role-badge.moderator { background: #ffc107; color: #212529; }
                .role-badge.user { background: #28a745; }
                
                /* KATEGORIE NAVIGACE */
                .categories-nav { background: #f8f9fa; border-bottom: 1px solid #dee2e6; padding: 10px 0; }
                .categories-nav-content { max-width: 1000px; margin: 0 auto; }
                .categories-nav h3 { margin: 0 0 10px 0; color: #495057; font-size: 16px; }
                .categories-list { display: flex; flex-wrap: wrap; gap: 10px; }
                .category-link { 
                    display: inline-flex; 
                    align-items: center; 
                    gap: 5px; 
                    padding: 5px 12px; 
                    background: white; 
                    border: 1px solid #dee2e6; 
                    border-radius: 20px; 
                    text-decoration: none; 
                    color: #495057; 
                    font-size: 14px;
                    transition: all 0.2s ease;
                }
                .category-link:hover { 
                    background: #007bff; 
                    color: white; 
                    border-color: #007bff; 
                    transform: translateY(-1px);
                }
                .category-link.active { 
                    background: #007bff; 
                    color: white; 
                    border-color: #007bff; 
                }
                .category-count { 
                    background: rgba(0,0,0,0.2); 
                    padding: 1px 6px; 
                    border-radius: 10px; 
                    font-size: 12px; 
                    margin-left: 5px;
                }
                
                .container { max-width: 1000px; margin: 20px auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; text-decoration: none; display: inline-block; margin: 5px; }
                .button:hover { background: #0056b3; }
                .button.secondary { background: #6c757d; }
                .button.secondary:hover { background: #545b62; }
                .button.danger { background: #dc3545; }
                .button.danger:hover { background: #c82333; }
                .button.warning { background: #ffc107; color: #212529; }
                .button.warning:hover { background: #e0a800; }
                .button.success { background: #28a745; }
                .button.success:hover { background: #218838; }
                .form-group { margin: 15px 0; }
                .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
                .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
                .form-group input[type="file"] { padding: 3px; }
                .form-group input[type="color"] { width: 60px; height: 40px; }
                .alert { padding: 15px; margin: 15px 0; border-radius: 4px; }
                .alert.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
                .alert.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
                .alert.warning { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
                
                /* VIDEO ITEM S KATEGORIÍ */
                .video-item { 
                    margin: 15px 0; 
                    padding: 15px; 
                    border: 1px solid #ddd; 
                    border-radius: 5px; 
                    position: relative;
                }
                .video-category-badge { 
                    position: absolute; 
                    top: 10px; 
                    right: 10px; 
                    padding: 4px 8px; 
                    border-radius: 12px; 
                    font-size: 12px; 
                    color: white; 
                    font-weight: bold;
                }
                .video-title { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
                .video-meta { color: #666; font-size: 14px; margin-bottom: 10px; }
                .video-actions { 
                    margin-top: 10px; 
                    display: flex; 
                    flex-wrap: wrap; 
                    gap: 10px; 
                    align-items: center; 
                }
                .comment { margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; position: relative; }
                .comment-author { font-weight: bold; color: #007bff; }
                .comment-date { color: #666; font-size: 12px; }
                .comment-content { margin: 5px 0; }
                .comment-actions { margin-top: 10px; }
                .comment-edit-form { margin-top: 10px; padding: 10px; background: #e9ecef; border-radius: 5px; }
                
                /* Styly pro like/dislike komentářů */
                .comment-likes { 
                    margin: 10px 0; 
                    display: flex; 
                    align-items: center; 
                    gap: 10px; 
                }
                .like-btn, .dislike-btn {
                    background: none;
                    border: 1px solid #dee2e6;
                    padding: 5px 10px;
                    border-radius: 15px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .like-btn:hover {
                    background: #e3f2fd;
                    border-color: #2196f3;
                    color: #2196f3;
                }
                .dislike-btn:hover {
                    background: #ffebee;
                    border-color: #f44336;
                    color: #f44336;
                }
                .like-btn.active {
                    background: #2196f3;
                    color: white;
                    border-color: #2196f3;
                }
                .dislike-btn.active {
                    background: #f44336;
                    color: white;
                    border-color: #f44336;
                }
                .likes-display, .dislikes-display {
                    padding: 5px 10px;
                    margin-right: 10px;
                    color: #666;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .comment-video { color: #666; font-size: 14px; margin-bottom: 5px; }
                .user-info { font-size: 14px; color: #666; }
                video { width: 100%; max-width: 100%; }
                
                /* Styly pro hodnocení videí */
                .video-rating-section { margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef; }
                .video-rating { display: flex; align-items: center; gap: 15px; flex-wrap: wrap; }
                .rating-btn { 
                    background: #f8f9fa; 
                    border: 2px solid #dee2e6; 
                    border-radius: 25px; 
                    padding: 8px 16px; 
                    cursor: pointer; 
                    font-size: 16px; 
                    transition: all 0.3s ease; 
                    display: flex; 
                    align-items: center; 
                    gap: 5px; 
                }
                .rating-btn:hover { background: #e9ecef; transform: translateY(-2px); }
                .rating-btn.active { background: #007bff; color: white; border-color: #007bff; }
                .rating-btn.like-btn.active { background: #28a745; border-color: #28a745; }
                .rating-btn.dislike-btn.active { background: #dc3545; border-color: #dc3545; }
                .score { 
                    font-weight: bold; 
                    color: #495057; 
                    padding: 8px 12px; 
                    background: white; 
                    border-radius: 20px; 
                    border: 1px solid #dee2e6; 
                }
                .rating-display { color: #6c757d; font-size: 16px; }
                
                /* 🆕 STYLY PRO PROFILE A ADMIN MANAGEMENT */
                .profile-section { margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef; }
                .profile-info { display: grid; grid-template-columns: auto 1fr; gap: 10px 20px; margin-bottom: 20px; }
                .profile-label { font-weight: bold; color: #495057; }
                .profile-value { color: #6c757d; }
                .danger-zone { margin-top: 30px; padding: 20px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; }
                
                /* SETTINGS TABS */
                .settings-tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 20px; border-bottom: 1px solid #dee2e6; }
                .settings-tab { 
                    background: none; 
                    border: none; 
                    padding: 10px 20px; 
                    cursor: pointer; 
                    border-bottom: 2px solid transparent; 
                    color: #495057;
                    font-size: 14px;
                }
                .settings-tab:hover { background: #f8f9fa; }
                .settings-tab.active { border-bottom-color: #007bff; color: #007bff; font-weight: bold; }
                .settings-content { display: none; }
                .settings-content.active { display: block; }
                
                /* 🆕 ADMIN PANEL STYLY */
                .admin-tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 20px; border-bottom: 2px solid #dee2e6; }
                .admin-tab { 
                    background: none; 
                    border: none; 
                    padding: 12px 24px; 
                    cursor: pointer; 
                    border-bottom: 3px solid transparent; 
                    color: #495057;
                    font-size: 16px;
                    transition: all 0.2s ease;
                }
                .admin-tab:hover { background: #f8f9fa; }
                .admin-tab.active { 
                    border-bottom-color: #007bff; 
                    color: #007bff; 
                    font-weight: bold; 
                    background: #f8f9fa;
                }
                .admin-content { display: none; }
                .admin-content.active { display: block; }
                
                .admin-section { margin: 30px 0; padding: 20px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef; }
                .admin-section h4 { margin: 0 0 15px 0; color: #495057; }
                
                /* STATISTIKY DASHBOARD */
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
                .stat-card { 
                    background: white; 
                    padding: 20px; 
                    border-radius: 8px; 
                    border: 1px solid #dee2e6; 
                    text-align: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .stat-number { font-size: 2.5em; font-weight: bold; color: #007bff; margin-bottom: 5px; }
                .stat-label { color: #6c757d; font-size: 14px; }
                
                /* QUICK ACTIONS */
                .quick-actions { display: flex; flex-wrap: wrap; gap: 10px; }
                
                /* USERS MANAGEMENT */
                .users-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .users-table th, .users-table td { 
                    padding: 12px; 
                    text-align: left; 
                    border-bottom: 1px solid #dee2e6; 
                }
                .users-table th { background: #f8f9fa; font-weight: bold; color: #495057; }
                .users-table tr:hover { background: #f8f9fa; }
                
                .user-roles { display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0; }
                .user-role-badge { 
                    padding: 2px 8px; 
                    border-radius: 12px; 
                    font-size: 11px; 
                    font-weight: bold; 
                    color: white;
                }
                
                .role-management { margin-top: 10px; }
                .role-select { margin-right: 10px; }
                
                /* CATEGORIES MANAGEMENT */
                .categories-list { display: grid; gap: 15px; }
                .category-admin-item { 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    padding: 15px; 
                    background: white; 
                    border-radius: 8px; 
                    border: 1px solid #dee2e6;
                }
                .category-info { display: flex; align-items: center; gap: 10px; }
                .category-icon { font-size: 20px; }
                .category-name { font-weight: bold; color: #495057; }
                .category-id { color: #6c757d; font-size: 12px; }
                .category-actions { display: flex; gap: 5px; }
                
                /* LOGS */
                .logs-container { 
                    background: #1e1e1e; 
                    color: #ffffff; 
                    padding: 20px; 
                    border-radius: 8px; 
                    font-family: 'Courier New', monospace; 
                    font-size: 12px; 
                    max-height: 500px; 
                    overflow-y: auto;
                }
                .log-line { margin: 2px 0; padding: 2px 0; }
                .log-error { color: #ff6b6b; }
                .log-warning { color: #feca57; }
                .log-info { color: #48dbfb; }
                .log-success { color: #26de81; }
                
                .loading { text-align: center; padding: 40px; color: #6c757d; }
                
                /* RESPONSIVE */
                @media (max-width: 768px) {
                    .header-content { flex-direction: column; gap: 10px; }
                    .header-nav { justify-content: center; }
                    .categories-list { flex-direction: column; }
                    .video-category-badge { position: static; margin-bottom: 10px; }
                    .stats-grid { grid-template-columns: 1fr; }
                    .admin-tabs { flex-direction: column; }
                    .settings-tabs { flex-direction: column; }
                    .users-table { font-size: 12px; }
                    .category-admin-item { flex-direction: column; gap: 10px; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="header-content">
                    <h1>🎥 VideoPortal</h1>
                    <div class="header-nav">
                        <a href="/">🏠 Domů</a>
                        ${user ? `
                            <span>👤 ${user.username}${user.roles && user.roles.length > 0 ? user.roles.map(role => `<span class="role-badge ${role.name.toLowerCase()}" style="background-color: ${role.color};">${role.display_name}</span>`).join('') : ''}</span>
                            <a href="/profile">⚙️ Profil</a>
                            ${hasPermission(user, PERMISSIONS.VIEW_ADMIN_PANEL) ? '<a href="/admin">🔧 Admin</a>' : ''}
                            <a href="/logout">🚪 Odhlásit</a>
                        ` : `
                            <a href="/login">🔐 Přihlásit</a>
                            <a href="/register">📝 Registrovat</a>
                        `}
                    </div>
                </div>
            </div>
            
            ${categories && categories.length > 0 ? `
                <div class="categories-nav">
                    <div class="categories-nav-content">
                        <h3>🗂️ Kategorie</h3>
                        <div class="categories-list">
                            <a href="/" class="category-link ${!new URLSearchParams(global.location?.search || '').get('category') ? 'active' : ''}">
                                📋 Všechny kategorie
                            </a>
                            ${categories.map(cat => `
                                <a href="/?category=${cat.id}" class="category-link" style="border-color: ${cat.color};">
                                    ${cat.icon} ${cat.name}
                                </a>
                            `).join('')}
                        </div>
                    </div>
                </div>
            ` : ''}
            
            <div class="container">
                ${content}
            </div>
            
            <script>
                // Session management
                const sessionId = localStorage.getItem('sessionId');
                if (sessionId) {
                    // Přidat session ID do všech fetch requestů
                    const originalFetch = window.fetch;
                    window.fetch = function(url, options = {}) {
                        if (!options.headers) {
                            options.headers = {};
                        }
                        options.headers['X-Session-Id'] = sessionId;
                        return originalFetch(url, options);
                    };
                    
                    // Přidat do všech formulářů
                    document.addEventListener('DOMContentLoaded', function() {
                        const forms = document.querySelectorAll('form');
                        forms.forEach(form => {
                            if (!form.querySelector('input[name="sessionId"]')) {
                                const input = document.createElement('input');
                                input.type = 'hidden';
                                input.name = 'sessionId';
                                input.value = sessionId;
                                form.appendChild(input);
                            }
                        });
                    });
                }
                
                // ADMIN PANEL FUNCTIONS
                function showAdminTab(tabId) {
                    // Skrýt všechny tabs
                    document.querySelectorAll('.admin-content').forEach(content => {
                        content.classList.remove('active');
                    });
                    document.querySelectorAll('.admin-tab').forEach(tab => {
                        tab.classList.remove('active');
                    });
                    
                    // Zobrazit vybraný tab
                    document.getElementById(tabId).classList.add('active');
                    document.querySelector(\`[onclick="showAdminTab('\${tabId}')"]\`).classList.add('active');
                    
                    // Načíst obsah pro specifické taby
                    if (tabId === 'users') {
                        loadUsers();
                    } else if (tabId === 'logs') {
                        loadLogs();
                    }
                }
                
                // Načtení uživatelů pro admin panel
                async function loadUsers() {
                    const container = document.getElementById('users-content');
                    container.innerHTML = '<div class="loading">Načítání uživatelů...</div>';
                    
                    try {
                        const response = await fetch('/admin/api/users');
                        const data = await response.json();
                        
                        if (data.users) {
                            renderUsersTable(data.users, data.availableRoles);
                        } else {
                            container.innerHTML = '<div class="alert error">Chyba při načítání uživatelů</div>';
                        }
                    } catch (error) {
                        console.error('Error loading users:', error);
                        container.innerHTML = '<div class="alert error">Chyba při komunikaci se serverem</div>';
                    }
                }
                
                // Vykreslení tabulky uživatelů
                function renderUsersTable(users, availableRoles) {
                    const container = document.getElementById('users-content');
                    
                    let html = \`
                        <table class="users-table">
                            <thead>
                                <tr>
                                    <th>👤 Uživatel</th>
                                    <th>🎭 Role</th>
                                    <th>📅 Registrován</th>
                                    <th>⚙️ Akce</th>
                                </tr>
                            </thead>
                            <tbody>
                    \`;
                    
                    users.forEach(user => {
                        html += \`
                            <tr>
                                <td>
                                    <strong>\${user.username}</strong>
                                    <br><small>ID: \${user.id}</small>
                                </td>
                                <td>
                                    <div class="user-roles">
                                        \${user.roles.map((role, index) => 
                                            \`<span class="user-role-badge" style="background-color: \${user.role_colors[index]};">\${role}</span>\`
                                        ).join('')}
                                    </div>
                                    <div class="role-management">
                                        <select class="role-select" id="role-select-\${user.id}">
                                            <option value="">-- Přidat roli --</option>
                                            \${availableRoles.map(role => 
                                                \`<option value="\${role.id}" \${user.role_ids.includes(role.id) ? 'disabled' : ''}>\${role.display_name}</option>\`
                                            ).join('')}
                                        </select>
                                        <button class="button" onclick="assignRole(\${user.id})">➕ Přidat</button>
                                    </div>
                                    \${user.role_ids.length > 0 ? \`
                                        <div style="margin-top: 10px;">
                                            \${user.role_ids.map((roleId, index) => 
                                                \`<button class="button danger" style="font-size: 11px; padding: 2px 6px; margin: 1px;" 
                                                    onclick="removeRole(\${user.id}, \${roleId})">❌ \${user.roles[index]}</button>\`
                                            ).join('')}
                                        </div>
                                    \` : ''}
                                </td>
                                <td>\${new Date(user.created_at).toLocaleDateString('cs-CZ')}</td>
                                <td>
                                    <button class="button danger" onclick="deleteUser(\${user.id}, '\${user.username}')">🗑️ Smazat</button>
                                </td>
                            </tr>
                        \`;
                    });
                    
                    html += \`
                            </tbody>
                        </table>
                    \`;
                    
                    container.innerHTML = html;
                }
                
                // Přiřazení role uživateli
                async function assignRole(userId) {
                    const selectElement = document.getElementById(\`role-select-\${userId}\`);
                    const roleId = selectElement.value;
                    
                    if (!roleId) {
                        alert('Vyberte roli k přiřazení');
                        return;
                    }
                    
                    try {
                        const response = await fetch(\`/admin/user/\${userId}/assign-role\`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ roleId: parseInt(roleId) })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            loadUsers(); // Reload users table
                        } else {
                            alert('Chyba při přiřazování role: ' + (data.error || 'Neznámá chyba'));
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Chyba při komunikaci se serverem!');
                    }
                }

                function removeRole(userId, roleId) {
                    if (confirm('Opravdu chcete odebrat tuto roli?')) {
                        fetch('/admin/user/' + userId + '/remove-role', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ roleId: roleId })
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                loadUsers(); // Reload users table
                            } else {
                                alert('Chyba při odebírání role: ' + (data.error || 'Neznámá chyba'));
                            }
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            alert('Chyba při komunikaci se serverem!');
                        });
                    }
                }
                
                // Smazání uživatele
                async function deleteUser(userId, username) {
                    if (!confirm(\`Opravdu chcete smazat uživatele "\${username}"? Tato akce je nevratná!\`)) {
                        return;
                    }
                    
                    try {
                        const response = await fetch(\`/admin/user/\${userId}/delete\`, {
                            method: 'POST'
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            loadUsers(); // Reload users table
                        } else {
                            alert('Chyba při mazání uživatele: ' + (data.error || 'Neznámá chyba'));
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Chyba při komunikaci se serverem!');
                    }
                }
                
                // Načtení logů
                async function loadLogs() {
                    const container = document.getElementById('logs-content');
                    container.innerHTML = '<div class="loading">Načítání logů...</div>';
                    
                    try {
                        const response = await fetch('/admin/api/logs');
                        const data = await response.json();
                        
                        if (data.logs) {
                            const logsHtml = \`
                                <div class="logs-container">
                                    \${data.logs.map(log => {
                                        let logClass = '';
                                        if (log.includes('[ERROR]')) logClass = 'log-error';
                                        else if (log.includes('[WARNING]')) logClass = 'log-warning';
                                        else if (log.includes('[INFO]')) logClass = 'log-info';
                                        else logClass = 'log-success';
                                        
                                        return \`<div class="log-line \${logClass}">\${log}</div>\`;
                                    }).join('')}
                                </div>
                            \`;
                            container.innerHTML = logsHtml;
                        } else {
                            container.innerHTML = '<div class="alert warning">Žádné logy k zobrazení</div>';
                        }
                    } catch (error) {
                        console.error('Error loading logs:', error);
                        container.innerHTML = '<div class="alert error">Chyba při načítání logů</div>';
                    }
                }
                
                function deleteCategory(categoryId, categoryName) {
                    if (confirm(\`Opravdu chcete smazat kategorii "\${categoryName}"? Všechna videa v této kategorii zůstanou, ale kategorie bude odebrána.\`)) {
                        fetch('/admin/category/' + categoryId + '/delete', {
                            method: 'POST'
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                location.reload();
                            } else {
                                alert('Chyba při mazání kategorie: ' + (data.error || 'Neznámá chyba'));
                            }
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            alert('Chyba při komunikaci se serverem!');
                        });
                    }
                }
                
                // Funkce pro hodnocení videí
                async function rateVideo(videoId, rating) {
                    try {
                        const response = await fetch('/api/rate-video', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ videoId, rating })
                        });

                        const data = await response.json();
                        
                        if (data.success) {
                            // Aktualizovat UI
                            const likeBtn = document.querySelector(\`[onclick="rateVideo(\${videoId}, 1)"]\`);
                            const dislikeBtn = document.querySelector(\`[onclick="rateVideo(\${videoId}, -1)"]\`);
                            const scoreElement = document.querySelector('.score');
                            
                            // Resetovat styly tlačítek
                            likeBtn.classList.remove('active');
                            dislikeBtn.classList.remove('active');
                            
                            // Nastavit aktivní tlačítko
                            if (data.userRating === 1) {
                                likeBtn.classList.add('active');
                            } else if (data.userRating === -1) {
                                dislikeBtn.classList.add('active');
                            }
                            
                            // Aktualizovat počty
                            likeBtn.innerHTML = \`👍 \${data.likes}\`;
                            dislikeBtn.innerHTML = \`👎 \${data.dislikes}\`;
                            scoreElement.textContent = \`Skóre: \${data.score}\`;
                        } else {
                            alert('Chyba: ' + data.error);
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Chyba při hodnocení videa');
                    }
                }
                
                // FUNKCE PRO PROFIL TABS
                function showProfileTab(tabId) {
                    // Skrýt všechny tabs
                    document.querySelectorAll('.settings-content').forEach(content => {
                        content.classList.remove('active');
                    });
                    document.querySelectorAll('.settings-tab').forEach(tab => {
                        tab.classList.remove('active');
                    });
                    
                    // Zobrazit vybraný tab
                    document.getElementById(tabId).classList.add('active');
                    document.querySelector(\`[onclick="showProfileTab('\${tabId}')"]\`).classList.add('active');
                }
                
                // FUNKCE PRO SLEDOVÁNÍ VIDEÍ
                let viewTracked = false;
                let videoStartTime = Date.now();
                let currentVideoId = null;
                
                function initVideoTracking(videoId) {
                    currentVideoId = videoId;
                    const video = document.querySelector('video');
                    
                    if (video) {
                        // Zaznamenat začátek sledování po 5 sekundách
                        setTimeout(() => {
                            if (!viewTracked) {
                                trackVideoView(videoId, 5);
                                viewTracked = true;
                            }
                        }, 5000);
                        
                        // Sledovat dokončení videa
                        video.addEventListener('ended', () => {
                            const watchTime = Math.floor((Date.now() - videoStartTime) / 1000);
                            trackVideoView(videoId, watchTime, true);
                        });
                        
                        // Sledovat průběh
                        video.addEventListener('timeupdate', () => {
                            if (video.currentTime > video.duration * 0.8 && !video.dataset.completion_tracked) {
                                const watchTime = Math.floor((Date.now() - videoStartTime) / 1000);
                                trackVideoView(videoId, watchTime, true);
                                video.dataset.completion_tracked = 'true';
                            }
                        });
                    }
                }
                
                async function trackVideoView(videoId, duration, completed = false) {
                    try {
                        await fetch(\`/api/video/\${videoId}/view\`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                duration: duration,
                                completed: completed
                            })
                        });
                    } catch (error) {
                        console.error('Error tracking video view:', error);
                    }
                }
                
                // FUNKCE PRO LIKE/DISLIKE KOMENTÁŘŮ
                async function likeComment(commentId, type) {
                    try {
                        const response = await fetch(\`/api/comment/\${commentId}/like\`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ type: type })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            // Aktualizovat UI
                            await updateCommentLikes(commentId);
                        } else {
                            alert('Chyba při hodnocení: ' + (data.error || 'Neznámá chyba'));
                        }
                    } catch (error) {
                        console.error('Error liking comment:', error);
                        alert('Chyba při komunikaci se serverem!');
                    }
                }
                
                async function updateCommentLikes(commentId) {
                    try {
                        const response = await fetch(\`/api/comment/\${commentId}/likes\`);
                        const data = await response.json();
                        
                        // Aktualizovat počty
                        document.getElementById(\`likes-count-\${commentId}\`).textContent = data.likes || 0;
                        document.getElementById(\`dislikes-count-\${commentId}\`).textContent = data.dislikes || 0;
                        
                        // Aktualizovat vzhled tlačítek
                        const likeBtn = document.getElementById(\`like-btn-\${commentId}\`);
                        const dislikeBtn = document.getElementById(\`dislike-btn-\${commentId}\`);
                        
                        if (likeBtn && dislikeBtn) {
                            likeBtn.classList.remove('active');
                            dislikeBtn.classList.remove('active');
                            
                            if (data.userVote === 1) {
                                likeBtn.classList.add('active');
                            } else if (data.userVote === -1) {
                                dislikeBtn.classList.add('active');
                            }
                        }
                    } catch (error) {
                        console.error('Error updating comment likes:', error);
                    }
                }
                
                // Načíst like/dislike data při načtení stránky
                document.addEventListener('DOMContentLoaded', function() {
                    // Načíst like/dislike data pro všechny komentáře
                    const commentLikes = document.querySelectorAll('.comment-likes');
                    commentLikes.forEach(element => {
                        const commentId = element.id.replace('comment-likes-', '');
                        updateCommentLikes(commentId);
                    });
                    
                    // Inicializovat tracking videa pokud jsme na stránce videa
                    const videoElement = document.querySelector('video[data-video-id]');
                    if (videoElement) {
                        const videoId = videoElement.getAttribute('data-video-id');
                        initVideoTracking(videoId);
                        
                        // Načíst statistiky videa pokud existuje sekce pro ně
                        const statsSection = document.getElementById(\`video-stats-\${videoId}\`);
                        if (statsSection) {
                            loadVideoStats(videoId);
                        }
                    }
                });
                
                // FUNKCE PRO NAČÍTÁNÍ STATISTIK VIDEÍ
                async function loadVideoStats(videoId) {
                    try {
                        const response = await fetch(\`/api/video/\${videoId}/stats\`);
                        const stats = await response.json();
                        
                        const statsContainer = document.getElementById(\`video-stats-\${videoId}\`);
                        if (statsContainer) {
                            statsContainer.innerHTML = \`
                                <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                                    <div class="stat-item" style="text-align: center; padding: 10px; background: white; border-radius: 5px;">
                                        <div style="font-size: 24px; font-weight: bold; color: #007bff;">\${stats.totalViews}</div>
                                        <div style="font-size: 12px; color: #666;">Celkem zhlédnutí</div>
                                    </div>
                                    <div class="stat-item" style="text-align: center; padding: 10px; background: white; border-radius: 5px;">
                                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">\${stats.uniqueViewers}</div>
                                        <div style="font-size: 12px; color: #666;">Unikátní diváci</div>
                                    </div>
                                    <div class="stat-item" style="text-align: center; padding: 10px; background: white; border-radius: 5px;">
                                        <div style="font-size: 24px; font-weight: bold; color: #fd7e14;">\${Math.floor(stats.averageDuration / 60)}:\${(stats.averageDuration % 60).toString().padStart(2, '0')}</div>
                                        <div style="font-size: 12px; color: #666;">Průměrná doba</div>
                                    </div>
                                    <div class="stat-item" style="text-align: center; padding: 10px; background: white; border-radius: 5px;">
                                        <div style="font-size: 24px; font-weight: bold; color: #6f42c1;">\${stats.completedViews}</div>
                                        <div style="font-size: 12px; color: #666;">Dokončených</div>
                                    </div>
                                </div>
                                \${stats.lastView ? \`
                                    <div style="margin-top: 10px; font-size: 12px; color: #666; text-align: center;">
                                        Poslední zhlédnutí: \${new Date(stats.lastView).toLocaleString('cs-CZ')}
                                    </div>
                                \` : ''}
                            \`;
                        }
                    } catch (error) {
                        console.error('Error loading video stats:', error);
                        const statsContainer = document.getElementById(\`video-stats-\${videoId}\`);
                        if (statsContainer) {
                            statsContainer.innerHTML = '<div style="color: #dc3545;">❌ Chyba při načítání statistik</div>';
                        }
                    }
                }
                
                
                // FUNKCE PRO EDITACI KOMENTÁŘŮ
                function editComment(commentId) {
                    const contentDiv = document.getElementById('comment-content-' + commentId);
                    const editForm = document.getElementById('comment-edit-' + commentId);
                    
                    contentDiv.style.display = 'none';
                    editForm.style.display = 'block';
                }

                function cancelEdit(commentId) {
                    const contentDiv = document.getElementById('comment-content-' + commentId);
                    const editForm = document.getElementById('comment-edit-' + commentId);
                    
                    contentDiv.style.display = 'block';
                    editForm.style.display = 'none';
                }

                async function saveComment(commentId) {
                    const textarea = document.getElementById('comment-textarea-' + commentId);
                    const newContent = textarea.value.trim();
                    
                    if (!newContent) {
                        alert('Komentář nemůže být prázdný!');
                        return;
                    }
                    
                    try {
                        const response = await fetch('/api/comment/' + commentId + '/update', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ content: newContent })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            // Aktualizovat obsah komentáře
                            const contentDiv = document.getElementById('comment-content-' + commentId);
                            contentDiv.innerHTML = newContent + ' <em style="color: #888; font-size: 12px;"> (upraveno)</em>';
                            
                            // Skrýt editační formulář
                            cancelEdit(commentId);
                        } else {
                            alert('Chyba při úpravě komentáře: ' + (data.error || 'Neznámá chyba'));
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Chyba při komunikaci se serverem!');
                    }
                }
            </script>
        </body>
        </html>
    `;
}