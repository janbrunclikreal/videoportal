'use strict';

const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { PERMISSIONS } = require('../modules/auth/seed');

// ===== Layout =====
function layout(title, body, user = null) {
  const navUser = user
    ? `<span class="user">👤 ${escape(user.username)}</span>
       <a href="/profile">Profil</a>
       <form action="/api/auth/logout" method="post" class="logout-form">
         <button class="link" type="submit">Odhlásit</button>
       </form>`
    : `<a href="/login">Přihlásit</a><a href="/register">Registrace</a>`;

  const adminLink =
    user && user.permissions && user.permissions.includes(PERMISSIONS.VIEW_ADMIN_PANEL)
      ? `<a href="/admin">Admin</a>`
      : '';

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/style.css">
  <title>${escape(title)} – VideoPortal v2</title>
  <script src="/app.js"></script>
</head>
<body class="app">
  <header>
    <span class="brand">🎬 VideoPortal <span class="ver">v2</span></span>
    <a href="/">Domů</a>
    ${user && user.permissions && user.permissions.includes(PERMISSIONS.UPLOAD_VIDEOS) ? '<a href="/upload">Nahrát</a>' : ''}
    ${adminLink}
    <span class="spacer"></span>
    ${navUser}
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function escape(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== Domů – seznam videí =====
router.get('/', (req, res) => {
  const { rows: videos } = db.all(`
    SELECT v.id, v.title, v.description, v.upload_date, v.views, v.filename, v.s3_key,
           u.username AS author, c.name AS category
    FROM videos v
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN categories c ON c.id = v.category_id
    WHERE v.status = 'published' AND v.deleted_at IS NULL
    ORDER BY v.upload_date DESC
    LIMIT 50
  `);
  const { rows: cats } = db.all(`SELECT * FROM categories ORDER BY name`);
  const body = `
    <h1>📺 Nejnovější videa</h1>
    <form method="get" action="/" class="row">
      <input name="q" placeholder="Hledat…" value="${escape(req.query.q || '')}">
      <select name="cat">
        <option value="">Všechny kategorie</option>
        ${cats
          .map((c) => `<option value="${c.id}">${escape(c.icon)} ${escape(c.name)}</option>`)
          .join('')}
      </select>
      <button>Hledat</button>
    </form>
    <div class="mt-4">
      ${
        videos.length === 0
          ? '<p class="muted">Zatím žádná videa.</p>'
          : videos
              .map(
                (v) => `
        <div class="card">
          <h3><a href="/video/${v.id}">${escape(v.title)}</a></h3>
          <div class="muted">👤 ${escape(v.author || 'Anonym')} · ${escape(v.category || 'Nezařazeno')} · 👁 ${v.views} zhlédnutí</div>
          <p>${escape(v.description || '')}</p>
        </div>`
              )
              .join('')
      }
    </div>
  `;
  res.send(layout('Domů', body, req.user));
});

// ===== Login =====
router.get('/login', (req, res) => {
  const body = `
    <h1>Přihlášení</h1>
    <form id="loginForm" class="card narrow">
      <p><label>Uživatel<br><input name="username" required></label></p>
      <p><label>Heslo<br><input name="password" type="password" required></label></p>
      <p><button>Přihlásit</button></p>
      <p id="msg" class="muted"></p>
    </form>
    <script>
      document.getElementById('loginForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await fetch('/api/auth/login', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
          credentials: 'include'
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { location.href = '/'; }
        else { document.getElementById('msg').textContent = j.error || 'Chyba přihlášení'; }
      };
    </script>
  `;
  res.send(layout('Přihlášení', body, req.user));
});

// ===== Register =====
router.get('/register', (req, res) => {
  const body = `
    <h1>Registrace</h1>
    <form id="regForm" class="card narrow">
      <p><label>Uživatel<br><input name="username" required></label></p>
      <p><label>Heslo<br><input name="password" type="password" required minlength="4"></label></p>
      <p><button>Registrovat</button></p>
      <p id="msg" class="muted"></p>
    </form>
    <script>
      document.getElementById('regForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await fetch('/api/auth/register', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
          credentials: 'include'
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { location.href = '/'; }
        else { document.getElementById('msg').textContent = j.error || 'Chyba registrace'; }
      };
    </script>
  `;
  res.send(layout('Registrace', body, req.user));
});

// ===== Upload formulář (S3 presigned flow) =====
router.get('/upload', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (!req.user.permissions.includes(PERMISSIONS.UPLOAD_VIDEOS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění nahrávat videa.</p>', req.user));
  }
  const { rows: cats } = db.all(`SELECT * FROM categories ORDER BY name`);
  const body = `
    <h1>📤 Nahrát video (S3 presigned upload)</h1>
    <p class="muted">Tento formulář používá dvoufázový S3 upload: nejdřív získáte presigned URL, pak do ní soubor přímo nahrajete, a nakonec potvrdíte upload.</p>
    <form id="uploadForm" class="card">
      <p><label>Název<br><input name="title" required></label></p>
      <p><label>Popis<br><textarea name="description" rows="3"></textarea></label></p>
      <p><label>Kategorie<br>
        <select name="category_id">
          <option value="">-- bez kategorie --</option>
          ${cats.map((c) => `<option value="${c.id}">${escape(c.icon)} ${escape(c.name)}</option>`).join('')}
        </select>
      </label></p>
      <p><label>Viditelnost<br>
        <select name="visibility">
          <option value="public">🌍 Veřejné</option>
          <option value="unlisted">🔗 Neveřejné přes link</option>
          <option value="private">🔒 Soukromé</option>
        </select>
      </label></p>
      <p><label>Soubor videa<br><input name="file" type="file" accept="video/*" required></label></p>
      <p><label><input type="checkbox" name="consent" required> Potvrzuji, že jsem vlastníkem autorských práv a mám souhlas zachycených osob.</label></p>
      <p><button>Nahrát</button></p>
      <pre id="log"></pre>
    </form>
    <script>
      const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
      document.getElementById('uploadForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const file = fd.get('file');
        if (!file || !file.name) { log('Vyberte soubor.'); return; }
        try {
          log('1/3 Žádám presigned URL…');
          const r1 = await fetch('/api/videos/upload-request', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              title: fd.get('title'),
              description: fd.get('description'),
              category_id: fd.get('category_id') || null,
              visibility: fd.get('visibility'),
              consent_obtained: !!fd.get('consent'),
              tos_version: 'v1.0',
              filename: file.name,
              content_type: file.type || 'application/octet-stream'
            })
          });
          const j1 = await r1.json();
          if (!r1.ok) throw new Error(j1.error || 'upload-request selhal');
          log('2/3 Uploaduji soubor do S3…');
          const put = await fetch(j1.uploadUrl, { method:'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
          if (!put.ok) throw new Error('S3 PUT selhal: ' + put.status);
          log('3/3 Potvrzuji upload…');
          const r2 = await fetch('/api/videos/' + j1.videoId + '/confirm', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ tos_version: 'v1.0' })
          });
          const j2 = await r2.json();
          if (!r2.ok) throw new Error(j2.error || 'confirm selhal');
          log('Hotovo! videoId=' + j2.video.id);
          setTimeout(() => location.href = '/video/' + j2.video.id, 800);
        } catch (err) { log('Chyba: ' + err.message); }
      };
    </script>
  `;
  res.send(layout('Nahrát video', body, req.user));
});

// ===== Video detail =====
router.get('/video/:id', (req, res) => {
const id = parseInt(req.params.id, 10);
  const { row: v } = db.get(`SELECT v.*, u.username AS author FROM videos v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ?`, [id]);
  if (!v) return res.status(404).send(layout('Nenalezeno', '<p>Video neexistuje.</p>', req.user));
  const playbackUrl = v.s3_key ? `/api/videos/${id}/playback` : `/uploads/${v.filename}`;

  const body = `
    <h1>${escape(v.title)}</h1>
    <p class="muted">
      👤 ${escape(v.author || 'Anonym')} · 
      👁 <span id="view-count">${v.views || 0}</span> · 
      ${v.status} · 
      ${escape(v.visibility)}
    </p>
    ${v.description ? `<p>${escape(v.description)}</p>` : ''}
    
    <video id="player" controls src="${escape(playbackUrl)}" style="width: 100%; max-height: 480px;"></video>
    
    <div class="video-actions" style="margin: 10px 0;">
     <button id="btn-like" onclick="rateVideo(1)">👍 <span id="like-count">0</span></button>
     <button id="btn-dislike" onclick="rateVideo(-1)">👎 <span id="dislike-count">0</span></button>
    </div>

    <h3>💬 Komentáře</h3>
    <div id="comments" class="card"><em class="muted">Načítám…</em></div>
    
    ${
      req.user
        ? `<form id="cform" class="card" style="margin-top: 15px;">
             <textarea name="content" rows="3" placeholder="Váš komentář…" required style="width: 100%;"></textarea>
             <p><button type="submit">Odeslat</button></p>
           </form>`
        : '<p class="muted">Pro komentování se <a href="/login">přihlaste</a>.</p>'
    }

    <script>
      // 1. Zhlédnutí videa při spuštění
      const player = document.getElementById('player');
      if (player) {
        player.addEventListener('play', async () => {
          await vp.api.post('/api/videos/${id}/views', { duration: 0, completed: false });
        }, { once: true });
      }

      // 2. Hodnocení videa
      async function rateVideo(rating) {
      const res = await vp.api.post('/api/videos/${id}/rate', { rating });
      if (res.ok && res.data) {
        document.getElementById('like-count').textContent = res.data.likes;
        document.getElementById('dislike-count').textContent = res.data.dislikes;
     } else if (res.status === 401) {
        alert('Pro hodnocení se musíte přihlásit.');
     } else {
       alert('Chyba při ukládání hodnocení.');
     }
}
      // 3. Načítání komentářů (dostupné pro všechny)
      async function loadComments() {
        const { data } = await vp.api.get('/api/videos/${id}/comments');
        const out = (data?.comments || []).map(c => 
          '<div class="card" style="margin-bottom: 8px;">' +
            '<b>' + vp.escapeHtml(c.author_username || 'Anonym') + '</b>' +
            '<div>' + vp.escapeHtml(c.content) + '</div>' +
            '<small class="muted">' + new Date(c.created_at).toLocaleString() + ' · 👍 ' + (c.likes || 0) + ' 👎 ' + (c.dislikes || 0) + '</small>' +
          '</div>'
        ).join('') || '<p class="muted">Žádné komentáře.</p>';
        
        document.getElementById('comments').innerHTML = out;
      }

      // 4. Obsluha formuláře pro nový komentář
      const cform = document.getElementById('cform');
      if (cform) {
        cform.onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const { ok } = await vp.api.post('/api/comments', { video_id: ${id}, content: fd.get('content') });
          if (ok) { 
            e.target.reset(); 
            loadComments(); 
          }
        };
      }

      loadComments();
    </script>
  `;
  res.send(layout(v.title, body, req.user));
});

// ===== Profile =====
router.get('/profile', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const { rows: myVideos } = db.all(`SELECT id, title, upload_date, status FROM videos WHERE user_id = ? AND deleted_at IS NULL ORDER BY upload_date DESC`, [req.user.id]);
  const body = `
    <h1>👤 ${escape(req.user.username)}</h1>
    <p class="muted">Role: ${req.user.roles.map((r) => escape(r.display_name)).join(', ') || '—'}</p>
    <h3>Změna hesla</h3>
    <form id="pwdForm" class="card">
      <p><label>Současné heslo<br><input name="current" type="password" required></label></p>
      <p><label>Nové heslo<br><input name="next" type="password" required minlength="4"></label></p>
      <p><button>Změnit heslo</button> <span id="pwdmsg" class="muted"></span></p>
    </form>
    <h3>Moje videa</h3>
    ${
      myVideos.length === 0
        ? '<p class="muted">Zatím žádná videa. <a href="/upload">Nahrát první</a>.</p>'
        : `<table><tr><th>Název</th><th>Datum</th><th>Status</th><th></th></tr>
        ${myVideos
          .map(
            (v) => `<tr><td><a href="/video/${v.id}">${escape(v.title)}</a></td>
            <td>${new Date(v.upload_date).toLocaleString()}</td>
            <td>${escape(v.status)}</td>
            <td><button data-del="${v.id}" class="del">Smazat</button></td></tr>`
          )
          .join('')}
        </table>`
    }
    <script>
      document.getElementById('pwdForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await fetch('/api/users/me/password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ currentPassword: fd.get('current'), newPassword: fd.get('next') }) });
        const j = await r.json().catch(() => ({}));
        document.getElementById('pwdmsg').textContent = r.ok ? '✓ Hotovo' : (j.error || 'Chyba');
      };
      document.querySelectorAll('button.del').forEach(btn => btn.onclick = async () => {
        if (!confirm('Opravdu smazat?')) return;
        const r = await fetch('/api/videos/' + btn.dataset.del, { method:'DELETE' });
        if (r.ok) location.reload();
      });
    </script>
  `;
  res.send(layout('Profil', body, req.user));
});

// ===== Admin dashboard =====
router.get('/admin', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.VIEW_ADMIN_PANEL)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  const { rows: counts } = db.all(`
    SELECT 'users' AS t, COUNT(*) AS c FROM users
    UNION ALL SELECT 'videos', COUNT(*) FROM videos WHERE deleted_at IS NULL
    UNION ALL SELECT 'comments', COUNT(*) FROM comments WHERE deleted_at IS NULL
    UNION ALL SELECT 'categories', COUNT(*) FROM categories
  `);
  const stats = Object.fromEntries(counts.map((r) => [r.t, r.c]));
  const body = `
    <h1>🛠 Admin dashboard</h1>
    <div class="card">
      <h3>Statistiky</h3>
      <p>👤 Uživatelé: ${stats.users || 0}</p>
      <p>🎬 Videa: ${stats.videos || 0}</p>
      <p>💬 Komentáře: ${stats.comments || 0}</p>
      <p>📁 Kategorie: ${stats.categories || 0}</p>
    </div>
    <div class="card">
      <h3>Akce</h3>
      <p><a href="/admin/users">Správa uživatelů</a></p>
      <p><a href="/admin/categories">Správa kategorií</a></p>
      <p><a href="/admin/logs">Systémové logy</a></p>
    </div>
  `;
  res.send(layout('Admin', body, req.user));
});

router.get('/admin/users', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.MANAGE_USERS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  const { rows: users } = db.all(`
    SELECT u.id, u.username, u.created_at, GROUP_CONCAT(r.display_name) AS roles
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id ORDER BY u.created_at DESC
  `);
  const { rows: roles } = db.all(`SELECT * FROM roles ORDER BY id`);
  const body = `
    <h1>👥 Uživatelé</h1>
    <form id="newu" class="card row">
      <input name="username" placeholder="Uživatel" required>
      <input name="password" type="password" placeholder="Heslo" required minlength="4">
      <button>Přidat</button>
    </form>
    <table>
      <tr><th>ID</th><th>Uživatel</th><th>Role</th><th>Akce</th></tr>
      ${users
        .map(
          (u) => `<tr>
        <td>${u.id}</td>
        <td>${escape(u.username)}</td>
        <td>${escape(u.roles || '—')}</td>
        <td>
          <select data-user="${u.id}">
            <option value="">+ přidat…</option>
            ${roles.map((r) => `<option value="${r.id}">${escape(r.display_name)}</option>`).join('')}
          </select>
          <button data-rm="${u.id}">Smazat</button>
        </td>
      </tr>`
        )
        .join('')}
    </table>
    <script>
      document.getElementById('newu').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await fetch('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) });
        if (r.ok) location.reload();
      };
      document.querySelectorAll('select[data-user]').forEach(sel => sel.onchange = async () => {
        if (!sel.value) return;
        const r = await fetch('/api/users/' + sel.dataset.user + '/role', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roleId: parseInt(sel.value) }) });
        if (r.ok) location.reload();
      });
      document.querySelectorAll('button[data-rm]').forEach(btn => btn.onclick = async () => {
        if (!confirm('Smazat uživatele?')) return;
        const r = await fetch('/api/users/' + btn.dataset.rm, { method:'DELETE' });
        if (r.ok) location.reload();
      });
    </script>
  `;
  res.send(layout('Uživatelé', body, req.user));
});

router.get('/admin/categories', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.MANAGE_CATEGORIES)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  const { rows: cats } = db.all(`SELECT * FROM categories ORDER BY name`);
  const body = `
    <h1>📁 Kategorie</h1>
    <form id="newc" class="card row">
      <input name="name" placeholder="Název" required>
      <input name="icon" placeholder="📁" maxlength="4" class="icon-input">
      <input name="color" placeholder="#007bff" class="color-input">
      <button>Přidat</button>
    </form>
    <table>
      <tr><th>Ikona</th><th>Název</th><th>Barva</th><th></th></tr>
      ${cats
        .map(
          (c) => `<tr>
        <td>${escape(c.icon)}</td>
        <td>${escape(c.name)}</td>
        <td>${escape(c.color)}</td>
        <td><button data-del="${c.id}">Smazat</button></td>
      </tr>`
        )
        .join('')}
    </table>
    <script>
      document.getElementById('newc').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await fetch('/api/categories', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: fd.get('name'), icon: fd.get('icon'), color: fd.get('color') }) });
        if (r.ok) location.reload();
      };
      document.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('Smazat?')) return;
        const r = await fetch('/api/categories/' + b.dataset.del, { method:'DELETE' });
        if (r.ok) location.reload();
      });
    </script>
  `;
  res.send(layout('Kategorie', body, req.user));
});

router.get('/admin/logs', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.VIEW_SYSTEM_LOGS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  res.send(
    layout(
      'Logy',
      `<h1>📜 Systémové logy</h1>
       <p class="muted">Sledujte <code>logs/videoportal-YYYY-MM-DD.log</code> nebo použijte API <code>GET /api/system/logs</code>.</p>`,
      req.user
    )
  );
});

// ===== Edit-video (jednoduchý formulář) =====
router.get('/edit-video/:id', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const id = parseInt(req.params.id, 10);
  const { row: v } = db.get(`SELECT * FROM videos WHERE id = ?`, [id]);
  if (!v) return res.status(404).send(layout('Nenalezeno', '<p>Video neexistuje.</p>', req.user));
  if (v.user_id !== req.user.id && !req.user.permissions.includes(PERMISSIONS.EDIT_ALL_VIDEOS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  const { rows: cats } = db.all(`SELECT * FROM categories ORDER BY name`);
  const body = `
    <h1>✏️ Editace videa</h1>
    <form id="f" class="card">
      <p><label>Název<br><input name="title" value="${escape(v.title)}" required></label></p>
      <p><label>Popis<br><textarea name="description" rows="3">${escape(v.description || '')}</textarea></label></p>
      <p><label>Kategorie<br>
        <select name="category_id">
          <option value="">--</option>
          ${cats.map((c) => `<option value="${c.id}" ${c.id === v.category_id ? 'selected' : ''}>${escape(c.icon)} ${escape(c.name)}</option>`).join('')}
        </select>
      </label></p>
      <p><label>Viditelnost<br>
        <select name="visibility">
          ${['public', 'unlisted', 'private']
            .map((x) => `<option value="${x}" ${v.visibility === x ? 'selected' : ''}>${x}</option>`)
            .join('')}
        </select>
      </label></p>
      <p><button>Uložit</button> <a href="/video/${id}">Zpět</a></p>
    </form>
    <script>
      document.getElementById('f').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await fetch('/api/videos/${id}', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
          title: fd.get('title'),
          description: fd.get('description'),
          category_id: fd.get('category_id') || null,
          visibility: fd.get('visibility')
        }) });
        if (r.ok) location.href = '/video/${id}';
      };
    </script>
  `;
  res.send(layout('Editace', body, req.user));
});

module.exports = router;
