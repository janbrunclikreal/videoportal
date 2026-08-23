Tady je aktualizovaná verze **`SPEC.md`** reflektující reálný aktuální stav architektury po refaktoringu v2, včetně vyřešených modulů, přesného kontraktu endpointů (včetně opravených bugů), SSR šablon a plánu dalších fází:

```markdown
# Technická specifikace: VideoPortal v2 (Modulární architektura & Audit stavu)

Tento dokument definuje závaznou technickou architekturu, rozhraní, bezpečnostní pravidla a aktuální implementační stav projektu VideoPortal v2.

---

## 1. Technologický stack & Základní pravidla

* **Běhové prostředí:** Node.js (v20+ LTS Alpine), Express.js.
* **Architektura:** Striktní **Modulární monolit** (Modular Monolith) s oddělenými vrstvami (`routes` -> `controller` -> `service` -> `db`).
* **Storage:** S3-kompatibilní Object Storage (MinIO / Cloudflare R2 / AWS S3) přes `@aws-sdk/client-s3` a `@aws-sdk/s3-request-presigner`. Přehrávání řešeno přes `GET /api/videos/:id/playback` (302 Redirect na presigned GET URL s podporou HTTP 206 Partial Content / Range requestů). Fallback na lokální `/uploads/` pro starší data.
* **Databáze:** SQLite přes `better-sqlite3` (WAL mode, synchronous=NORMAL, Foreign Keys ON, prepared statements). Auto-migrace přes `database/init.js`.
* **Bezpečnost:** Helmet.js, bcrypt (10 rounds), CORS s credentials, HTTP-only cookies, Rate Limiting (login, register), striktní RBAC middleware.

---

## 2. Adresářová struktura

```text
videoportal/
├── src/
│   ├── config/              # env.js, db.js (better-sqlite3 pool), s3.js, constants.js
│   ├── middleware/          # auth.middleware.js, rbac.middleware.js, error.middleware.js, rate-limit.js
│   ├── modules/
│   │   ├── auth/            # auth.routes.js, auth.controller.js, auth.service.js
│   │   ├── users/           # users.routes.js, users.controller.js, users.service.js
│   │   ├── videos/          # videos.routes.js, videos.controller.js, videos.service.js
│   │   ├── comments/        # comments.routes.js, comments.controller.js, comments.service.js
│   │   ├── storage/         # storage.service.js (Presigned PUT/GET, HeadObject, DeleteObject)
│   │   ├── legal/           # legal.routes.js, legal.controller.js, legal.service.js (GDPR/DSA)
│   │   ├── categories/      # categories.routes.js, categories.controller.js, categories.service.js
│   │   └── system/          # system.routes.js, system.controller.js, system.service.js (Stats/Logs)
│   ├── views/               # views.routes.js (Server-Side Rendered layouty a HTML pohledy)
│   └── app.js               # Bootstrap Express serveru, mount modulárních rout
├── database/                # schema.sql, init.js (migrace, seed výchozích dat)
├── public/                  # app.js (window.vp helper), style.css, favicon.ico
├── tests/                   # Integrační a unit testy (ve fázi přípravy)
├── .env.example
├── SPEC.md
└── package.json

```

---

## 3. RBAC & Právní soulad (GDPR, DSA)

### A. Role a Oprávnění

* **Role:** `admin`, `editor`, `moderator`, `user`.
* **Oprávnění:** 12 granulárních oprávnění (`videos:create`, `videos:edit`, `videos:delete`, `videos:takedown`, `comments:create`, `comments:moderate`, `users:manage`, `categories:manage`, `logs:view` atd.).
* **Registrace:** Řízena proměnnou `ALLOW_PUBLIC_REGISTRATION`. Pokud je `false`, účty spravuje výhradně administrátor.

### B. Právní audit & Moderace

* Evidence souhlasů: Tabulka `consent_log`, záznam `consent_obtained` (boolean) a `tos_version` (varchar) u každého nahraného videa.
* DSA stavy videí: `status` (`pending`, `published`, `flagged`, `takedown`, `deleted`).
* Soft delete: `deleted_at TIMESTAMP NULL` u videí i komentářů pro zachování auditní stopy.

---

## 4. Klíčové API kontrakty

### A. Videa & Přehrávání

* `POST /api/videos/upload-request` – Vytvoří záznam (`pending`) a vrátí S3 Presigned PUT URL.
* `POST /api/videos/:id/confirm` – Ověří existenci souboru v S3 přes `HeadObject` a přepne status na `published`.
* `GET /api/videos/:id/playback` – HTTP 302 redirect na S3 Presigned GET URL.
* `POST /api/videos/:id/view` – Trackování zhlédnutí videa (jednotné číslo).
* `POST /api/videos/:id/rate` – Payload: `{ rating: 1 | -1 | 0 }`. Hodnota `0` slouží jako unlike/reset hodnocení. Vrací `{ likes, dislikes }`.

### B. Komentáře

* `GET /api/videos/:videoId/comments` – Seznam komentářů včetně agregovaných lajků a `user_like`.
* `POST /api/comments` – Payload: `{ video_id, content }`.
* `POST /api/comments/:id/like` – Payload: `{ value: 1 | -1 | 0 }`. Vrací `{ ok, likes, dislikes, user_like }`.
* `PUT /api/comments/:id` & `DELETE /api/comments/:id` – Úprava a soft delete komentářů.

---

## 5. Implementační Roadmapa & Fáze

### Fáze 1: Dokončení Admin UI & Správy obsahu (AKTUÁLNÍ CÍL)

* [ ] `/admin/videos` – Správa videí, změna stavu (`published`, `flagged`, `takedown`), mazání.
* [ ] `/admin/users` – Frontend rozhraní pro správu uživatelů a přiřazování rolí.
* [ ] `/admin/categories` – Frontend rozhraní pro CRUD operací nad kategoriemi.
* [ ] `/admin/logs` – Prohlížeč systémových logů.
* [ ] `/edit-video/:id` – Uživatelská editace metadat videa (title, description, visibility).
* [ ] Inline akce u komentářů – Tlačítka pro úpravu a smazání vlastního komentáře.
* [ ] UI notifikace – Náhrada nativních `alert()` za toast notifikace.

### Fáze 2: Stabilita & Bezpečnostní hardening

* [ ] Persistent Session Store (přechod z in-memory Map na SQLite tabulku `sessions`).
* [ ] Databázové indexy (`comments.video_id`, `ratings.video_id`, `ratings.user_id`).
* [ ] Inkrementální migrace (odstranění destruktivního `dropAllTables`).
* [ ] Rate limiting pro rating a komentáře.
* [ ] Zapnutí a konfigurace CSP v Helmet.

### Fáze 3: Testování & Automatizace

* [ ] Integrační testy pro Auth, RBAC a Upload flow (Supertest / Node Test Runner).
* [ ] CI/CD pipeline (GitHub Actions).

```

Můžeš tento obsah rovnou zapsat do `SPEC.md` v repozitáři, ať má projekt aktuální dokumentaci odpovídající realitě.

```
