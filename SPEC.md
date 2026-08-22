```markdown
# Technická specifikace: VideoPortal v2 (Refaktoring na modulární architekturu)

Tento dokument definuje závaznou technickou architekturu, rozhraní a bezpečnostní pravidla pro novou verzi aplikace VideoPortal. Implementace probíhá od nuly.

---

## 1. Technologický stack & Základní pravidla

* **Běhové prostředí:** Node.js (LTS), Express.js (nebo Fastify).
* **Architektura:** Striktní **Modulární monolit** (Modular Monolith). Kód NESMÍ být v jednom obřím souboru.
* **Storage:** S3-kompatibilní Object Storage (Cloudflare R2 / AWS S3) s využitím `@aws-sdk/client-s3` a `@aws-sdk/s3-request-presigner`. Nahrávání probíhá výhradně přes Presigned URLs (žádné ukládání těžkých videí na lokální disk přes Multer).
* **Databáze:** Relační SQL s parametrizovanými dotazy / Connection poolem (připraveno pro SQLite/MySQL/Postgres). Žádné SQL injection zranitelnosti.
* **Bezpečnost:** Helmet.js, bcrypt pro hash hesel, CORS, striktní RBAC middleware, HTTP-only Secure Cookies / JWT session.

---

## 2. Požadovaná adresářová struktura

```text
videoportal/
├── src/
│   ├── config/              # Správa env proměnných, DB pool, S3 klient
│   ├── middleware/          # Auth guard, RBAC check, Error handler, Rate limit
│   ├── modules/
│   │   ├── auth/            # Registrace, přihlášení, správa hesel, sessions
│   │   ├── users/           # Uživatelské profily, správa rolí a oprávnění
│   │   ├── videos/          # Metadata videí, vyhledávání, kategorie, statistiky
│   │   ├── comments/        # Komentáře, stromové odpovědi, reakce (like/dislike)
│   │   ├── storage/         # Generování Presigned URLs, správa S3 objektů, mazání
│   │   └── legal/           # Evidence souhlasů (GDPR), verze ToS, moderace a hlášení obsahu (DSA)
│   └── app.js               # Bootstrap Express serveru, registrace modulárních rout
├── database/                # Inicializační skripty, migrace, seed databáze
├── public/                  # Statické soubory pro frontend (HTML, CSS, JS)
├── .env.example
├── SPEC.md
└── package.json

```

Každý modul v `src/modules/<nazev>/` musí obsahovat oddělené soubory:

* `*.routes.js` (Definice endpointů)
* `*.controller.js` (Validace vstupů, volání služeb a formátování HTTP odpovědí)
* `*.service.js` (Čistá byznys logika a databázové operace)

---

## 3. Klíčové funkční a regulatorní požadavky

### A. Řízení přístupu a uzavřený testovací režim

* Podpora proměnné prostředí `ALLOW_PUBLIC_REGISTRATION=false`. Pokud je `false`, registrace z veřejného formuláře je zakázána a nové účty může vytvářet pouze administrátor v `/admin`.
* Plná RBAC matice (Role: `admin`, `editor`, `moderator`, `user`).

### B. Právní soulad & Audit (GDPR, Autorská práva, DSA)

* Tabulka videí i auditu musí evidovat:
* `consent_obtained` (boolean) – potvrzení o vlastnictví autorských práv a souhlasu zachycených osob.
* `tos_version` (varchar) – verze podmínek, se kterými autor při nahrání souhlasil.
* `status` (`pending`, `published`, `flagged`, `takedown`, `deleted`).


* Soft delete pro videa a komentáře (`deleted_at TIMESTAMP NULL`) pro zachování auditní stopy.

### C. Zpracování médií (S3 Storage flow)

1. Klient požádá backend o upload URL (`POST /api/videos/upload-request`).
2. Backend ověří oprávnění uživatele, vytvoří záznam se statusem `pending` a vrátí jednorázovou Presigned URL pro S3.
3. Klient nahraje video přímo do S3/R2.
4. Klient potvrdí dokončení uploadu (`POST /api/videos/:id/confirm`).

---

## 4. Požadavek na spuštění implementace

Implementaci zahaj v následujícím pořadí:

1. Inicializace `package.json` a vytvoření adresářové struktury.
2. Vytvoření `src/config/` a `database/schema.sql` (včetně tabulek z README.md + nová pole pro S3 a legal).
3. Implementace základních modulů: `auth`, `storage` a `videos`.
