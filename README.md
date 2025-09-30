# VideoPortal

Moderní webová aplikace pro sdílení videí s pokročilým systémem rolí a oprávnění.

## 🚀 Rychlý start

### 1. Instalace závislostí
```bash
npm install
```

### 2. Spuštění aplikace
```bash
npm start
```

### 3. Přihlášení
- **URL:** `http://localhost:8081`
- **URL pro administraci:** `http://localhost:8081/admin`
- **Administrátorské přihlášení:** `admin` / `admin123`

## 📋 Funkčnosti

### 🎥 Správa videí
- Nahrávání videí s popisem a kategoriemi
- Přehrávání videí s HTML5 přehrávačem
- Systém hodnocení (like/dislike)
- Sledování počtu zhlédnutí
- Kategorizace videí

### 💬 Systém komentářů
- Přidávání komentářů k videím
- Úprava vlastních komentářů
- Like/dislike komentářů
- Moderace komentářů

### 👤 Uživatelský systém
- Registrace a přihlašování
- Profilové stránky uživatelů
- Správa vlastních videí
- Pokročilý systém rolí a oprávnění

### 🛡️ Role a oprávnění

#### Admin
- Všechna oprávnění v systému
- Správa uživatelů (vytváření, mazání, přiřazování rolí)
- Přístup k admin panelu
- Správa kategorií videí

#### Editor
- Správa všech videí (editace, mazání)
- Správa kategorií videí
- Moderování komentářů

#### Moderator
- Moderování komentářů a videí
- Základní správa obsahu

#### User (běžný uživatel)
- Nahrávání vlastních videí
- Hodnocení videí a komentářů
- Úprava vlastního profilu

### 🔧 Administrátorský panel (`/admin`)
- **Dashboard** - Přehled statistik a aktivit
- **Správa uživatelů** - CRUD operace s uživateli
- **Správa kategorií** - CRUD operace s kategoriemi videí
- **Systémové logy** - Detailní logování všech akcí

## 🏗️ Technologie

- **Backend:** Node.js, Express.js
- **Database:** SQLite3
- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Security:** Helmet.js, bcrypt pro hash hesel
- **File Upload:** Multer pro nahrávání souborů
- **CORS:** Konfigurovatelné CORS pro API

## 📂 Struktura projektu

```
videoportal/
├── app.js                 # Hlavní aplikační soubor
├── package.json           # NPM konfigurace a závislosti
├── password-utils.js      # Utility pro práci s hesly
├── database/
│   └── videoportal.db    # SQLite databáze
├── logs/                 # Aplikační logy
└── README.md            # Tato dokumentace
```

## 🗃️ Databázové tabulky

- `users` - Uživatelé
- `roles` - Role v systému
- `permissions` - Oprávnění
- `role_permissions` - Propojení rolí a oprávnění
- `user_roles` - Propojení uživatelů a rolí
- `categories` - Kategorie videí
- `videos` - Metadata videí
- `comments` - Komentáře k videím
- `ratings` - Hodnocení videí
- `comment_likes` - Hodnocení komentářů
- `video_views` - Statistiky sledování

## 🔒 Bezpečnost

- **Helmet.js** - HTTP security headers
- **CORS** - Konfigurované pro bezpečné API požadavky
- **bcrypt** - Bezpečné hashování hesel
- **Session management** - Správa uživatelských relací
- **Detailní logování** - Všechny akce jsou zaznamenávány

## 📊 Statistiky a monitoring

- Tracking zhlédnutí videí
- Statistiky hodnocení
- Aktivita uživatelů
- Systémové logy s časovými razítky
- Přehled využití v admin panelu

## 🚀 Produkční nasazení

Pro produkční nasazení doporučujeme:

1. Použití environment proměnných pro konfiguraci
2. Nastavení robustnějšího databázového systému (PostgreSQL/MySQL)
3. Implementaci HTTPS
4. Konfigurace reverse proxy (Nginx)
5. Monitoring a alerting

## 📝 Changelog

### Aktuální verze (29.9.2025)
- Odstraněn reportovací systém
- Vyčištěna struktura projektu
- Vrácen standardní port 8080
- Aktualizována dokumentace

---

**Verze:** 1.0.0  
**Datum:** 29.9.2025  
**Autor:** MiniMax Agent  
**Licence:** MIT
