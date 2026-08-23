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
  <div id="toast-container" class="toast-container" aria-live="polite" aria-atomic="true"></div>
  <div id="modal-container"></div>
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

// Helper: pokud uživatel nemá oprávnění, vrátí 403 HTML stránku.
function deny(user, perm) {
  return { __deny: true, user };
}

// ===== Domů – seznam videí =====
router.get('/', (req, res) => {
  // Fáze 1.1 – přísný access filtr:
  //   - status='published' (NE pending/flagged/takedown)
  //   - visibility='public' (NE unlisted/private)
  // Unlisted videa jsou dostupná jen přímým odkazem, private jen autorovi/moderátorovi.
  const { rows: videos } = db.all(`
    SELECT v.id, v.title, v.description, v.upload_date, v.views, v.filename, v.s3_key,
           u.username AS author, c.name AS category
    FROM videos v
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN categories c ON c.id = v.category_id
    WHERE v.status = 'published' AND v.deleted_at IS NULL AND v.visibility = 'public'
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
        if (r.ok) { vp.toast('Přihlášení proběhlo úspěšně', 'success'); setTimeout(() => location.href = '/', 300); }
        else { vp.toast(j.error || 'Chyba přihlášení', 'error'); }
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
        if (r.ok) { vp.toast('Registrace proběhla', 'success'); setTimeout(() => location.href = '/', 300); }
        else { vp.toast(j.error || 'Chyba registrace', 'error'); }
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
        if (!file || !file.name) { vp.toast('Vyberte soubor.', 'error'); return; }
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
          vp.toast('Video bylo úspěšně nahráno', 'success');
          setTimeout(() => location.href = '/video/' + j2.video.id, 800);
        } catch (err) {
          log('Chyba: ' + err.message);
          vp.toast(err.message, 'error');
        }
      };
    </script>
  `;
  res.send(layout('Nahrát video', body, req.user));
});

// ===== Video detail (Fáze 1: inline akce pro komentáře a smazání videa) =====
router.get('/video/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { row: v } = db.get(`SELECT v.*, u.username AS author FROM videos v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ?`, [id]);
  if (!v) return res.status(404).send(layout('Nenalezeno', '<p>Video neexistuje.</p>', req.user));
  // Fáze 1.1 – přísný access guard (status + visibility). Vracíme 404, ne 403,
  // aby existence videa zůstala skrytá. Stejná logika jako v API controlleru.
  const canViewVideo = (() => {
    if (v.status !== 'published') {
      if (!req.user) return false;
      if (req.user.id === v.user_id) return true;
      if (req.user.permissions && req.user.permissions.includes(PERMISSIONS.MODERATE_VIDEOS)) return true;
      return false;
    }
    if (v.visibility === 'private') {
      if (!req.user) return false;
      if (req.user.id === v.user_id) return true;
      if (req.user.permissions && req.user.permissions.includes(PERMISSIONS.MODERATE_VIDEOS)) return true;
      return false;
    }
    return true; // public/unlisted + published → kdokoliv
  })();
  if (!canViewVideo) return res.status(404).send(layout('Nenalezeno', '<p>Video neexistuje.</p>', req.user));
  const playbackUrl = v.s3_key ? `/api/videos/${id}/playback` : `/uploads/${v.filename}`;

  // SSR agregace lajků / dislajků pro tohle video.
  const { row: ratingAgg } = db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN rating =  1 THEN 1 ELSE 0 END), 0) AS likes,
       COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) AS dislikes
     FROM ratings WHERE video_id = ?`,
    [id]
  );
  const userRating = req.user
    ? ((db.get(`SELECT rating FROM ratings WHERE video_id = ? AND user_id = ?`,
        [id, req.user.id]).row || {}).rating || 0)
    : 0;
  const canRate = !!req.user;

  // Fáze 1 – oprávnění pro nové akce.
  // currentUserId (číslo nebo null) se předá do frontendu, aby mohl skrýt
  // tlačítka "Upravit/Smazat" u cizích komentářů.
  const currentUserId = req.user ? req.user.id : null;
  const canModerateComments = !!(req.user && req.user.permissions.includes(PERMISSIONS.MODERATE_COMMENTS));
  const canEditVideo = !!(
    req.user &&
    (req.user.id === v.user_id || req.user.permissions.includes(PERMISSIONS.EDIT_ALL_VIDEOS))
  );
  const canDeleteVideo = !!(
    req.user &&
    (req.user.id === v.user_id || req.user.permissions.includes(PERMISSIONS.DELETE_ANY_CONTENT))
  );

  const body = `
    <h1>${escape(v.title)}
      ${canEditVideo ? ` <a class="secondary" style="font-size:0.7em; text-decoration:none;" href="/edit-video/${id}">✏️ Upravit</a>` : ''}
    </h1>
    <p class="muted">
      👤 ${escape(v.author || 'Anonym')} ·
      👁 <span id="view-count">${v.views || 0}</span> ·
      ${escape(v.status)} ·
      ${escape(v.visibility)}
    </p>
    ${v.description ? `<p>${escape(v.description)}</p>` : ''}

    <video id="player" controls src="${escape(playbackUrl)}" style="width: 100%; max-height: 480px;"></video>

    <div class="video-actions" style="margin: 10px 0;">
     <button id="btn-like" data-value="1" class="like-btn${userRating ===  1 ? ' active' : ''}${canRate ? '' : ' disabled'}">👍 <span id="like-count">${ratingAgg.likes || 0}</span></button>
     <button id="btn-dislike" data-value="-1" class="dislike-btn${userRating === -1 ? ' active' : ''}${canRate ? '' : ' disabled'}">👎 <span id="dislike-count">${ratingAgg.dislikes || 0}</span></button>
     <span id="rate-msg" class="muted" style="margin-left: 8px;"></span>
     <span style="flex:1;"></span>
     ${canDeleteVideo ? `<button id="btn-del-video" class="del" type="button">🗑 Smazat video</button>` : ''}
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
      // Konfigurace z SSR – Fáze 1: oprávnění pro inline akce.
      const CURRENT_USER_ID = ${JSON.stringify(currentUserId)};
      const CAN_MODERATE_COMMENTS = ${JSON.stringify(canModerateComments)};

      // 1. Zhlédnutí videa – backend endpoint je /api/videos/:id/view (jednotné číslo).
      const player = document.getElementById('player');
      if (player) {
        player.addEventListener('play', async () => {
          await vp.api.post('/api/videos/${id}/view', { duration: 0, completed: false });
        }, { once: true });
      }

      // 2. Hodnocení videa – tlačítka ⬆/⬇, toggle (klik na aktivní tlačítko = unlike).
      const btnLike = document.getElementById('btn-like');
      const btnDislike = document.getElementById('btn-dislike');
      const likeSpan = document.getElementById('like-count');
      const disSpan  = document.getElementById('dislike-count');
      const rateMsg  = document.getElementById('rate-msg');

      async function rateVideo(value) {
        if (!${canRate}) {
          window.location.href = '/login';
          return;
        }
        const wasActive = (value === 1 && btnLike.classList.contains('active'))
                      || (value === -1 && btnDislike.classList.contains('active'));
        const rating = wasActive ? 0 : value;
        btnLike.disabled = true;
        btnDislike.disabled = true;
        const res = await vp.api.post('/api/videos/${id}/rate', { rating });
        if (res.ok && res.data) {
          likeSpan.textContent = res.data.likes;
          disSpan.textContent  = res.data.dislikes;
          btnLike.classList.remove('active');
          btnDislike.classList.remove('active');
          if (!wasActive) {
            (value === 1 ? btnLike : btnDislike).classList.add('active');
          }
          vp.toast('Hodnocení uloženo', 'success', 1500);
        } else if (res.status === 401) {
          vp.toast('Pro hodnocení se musíte přihlásit.', 'warning');
        } else {
          vp.toastApiError(res, 'Chyba při ukládání hodnocení.');
        }
        btnLike.disabled = false;
        btnDislike.disabled = false;
      }
      btnLike.addEventListener('click', () => rateVideo(1));
      btnDislike.addEventListener('click', () => rateVideo(-1));

      // 2b. Fáze 1 – smazání videa autorem nebo adminem.
      const btnDelVideo = document.getElementById('btn-del-video');
      if (btnDelVideo) {
        btnDelVideo.addEventListener('click', async () => {
          const ok = await vp.confirm('Opravdu smazat toto video? Tato akce je nevratná (soft delete).', {
            title: 'Smazat video',
            confirmText: 'Smazat',
            danger: true,
          });
          if (!ok) return;
          btnDelVideo.disabled = true;
          const res = await vp.api.del('/api/videos/${id}');
          if (res.ok) {
            vp.toast('Video bylo smazáno', 'success');
            setTimeout(() => location.href = '/', 500);
          } else {
            btnDelVideo.disabled = false;
            vp.toastApiError(res, 'Smazání videa selhalo.');
          }
        });
      }

      // 3. Načítání komentářů (dostupné pro všechny).
      //    Fáze 1: každý komentář dostane data-author-id, aby šlo v delegaci
      //    snadno poznat cizí vs. vlastní a zobrazit jen povolené akce.
      function renderComment(c) {
        const canLike = ${canRate};
        const liked  = c.user_like ===  1;
        const disliked = c.user_like === -1;
        const isOwn = CURRENT_USER_ID !== null && Number(c.user_id) === Number(CURRENT_USER_ID);
        const canEdit = isOwn || CAN_MODERATE_COMMENTS;
        const canDelete = isOwn || CAN_MODERATE_COMMENTS;
        const actions = [];
        actions.push('<button class="edit-btn secondary" data-edit="' + c.id + '" type="button">✏️ Upravit</button>');
        actions.push('<button class="del-btn del" data-rm="' + c.id + '" type="button">🗑 Smazat</button>');
        return '<div class="card" data-cid="' + c.id + '" data-author-id="' + vp.escapeHtml(String(c.user_id || '')) + '" style="margin-bottom: 8px;">' +
          '<div><b>' + vp.escapeHtml(c.author_username || 'Anonym') + '</b></div>' +
          '<div class="comment-body">' + vp.escapeHtml(c.content) + '</div>' +
          '<small class="muted">' + vp.formatDate(c.created_at) + (c.updated_at ? ' (upraveno)' : '') + '</small>' +
          '<div class="comment-actions" style="margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap;">' +
            (canLike
              ? '<button class="like-btn'    + (liked     ? ' active' : '') + '" data-cid="' + c.id + '" data-value="1">👍 <span data-likes>'    + (c.likes    || 0) + '</span></button>' +
                '<button class="dislike-btn' + (disliked  ? ' active' : '') + '" data-cid="' + c.id + '" data-value="-1">👎 <span data-dislikes>' + (c.dislikes || 0) + '</span></button>'
              : '<span class="muted">👍 ' + (c.likes    || 0) + ' / 👎 ' + (c.dislikes || 0) + '</span>') +
            (canEdit || canDelete
              ? '<span style="flex:1;"></span>' +
                (canEdit   ? '<button class="edit-btn secondary" data-edit="' + c.id + '" type="button">✏️ Upravit</button>' : '') +
                (canDelete ? '<button class="del-btn del" data-rm="' + c.id + '" type="button">🗑 Smazat</button>' : '')
              : ''
            ) +
          '</div>' +
        '</div>';
      }

      async function loadComments() {
        const { data } = await vp.api.get('/api/videos/${id}/comments');
        const comments = (data && data.comments) || [];
        document.getElementById('comments').innerHTML = comments.length
          ? comments.map(renderComment).join('')
          : '<p class="muted">Žádné komentáře.</p>';
      }

      // 4. Delegace klikání – lajky/dislajky, edit i delete komentářů.
      const commentsEl = document.getElementById('comments');
      commentsEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-cid], button[data-edit], button[data-rm]');
        if (!btn) return;

        // 4a. Like / dislike
        if (btn.dataset.cid !== undefined) {
          if (!${canRate}) { window.location.href = '/login'; return; }
          btn.disabled = true;
          const cid = btn.dataset.cid;
          const value = parseInt(btn.dataset.value, 10);
          const wasActive = btn.classList.contains('active');
          const payload = wasActive ? 0 : value;
          const res = await vp.api.post('/api/comments/' + cid + '/like', { value: payload });
          if (res.ok && res.data) {
            const card = btn.closest('[data-cid]');
            const likeBtn    = card.querySelector('.like-btn span');
            const dislikeBtn = card.querySelector('.dislike-btn span');
            if (likeBtn)    likeBtn.textContent    = res.data.likes    || 0;
            if (dislikeBtn) dislikeBtn.textContent = res.data.dislikes || 0;
            card.querySelectorAll('button[data-cid]').forEach(b => b.classList.remove('active'));
            if (!wasActive) btn.classList.add('active');
          } else {
            vp.toastApiError(res, 'Hodnocení komentáře selhalo.');
          }
          btn.disabled = false;
          return;
        }

        // 4b. Inline edit komentáře
        if (btn.dataset.edit !== undefined) {
          const card = btn.closest('[data-cid]');
          const cid = btn.dataset.edit;
          const body = card.querySelector('.comment-body');
          if (card.dataset.editing === '1') return; // už se edituje
          const original = body.textContent;
          card.dataset.editing = '1';
          body.innerHTML = '' +
            '<textarea class="edit-area" rows="3" style="width:100%;"></textarea>' +
            '<div class="row" style="margin-top:6px;">' +
              '<button class="save-btn" data-save="' + cid + '" type="button">Uložit</button>' +
              '<button class="cancel-btn secondary" type="button">Zrušit</button>' +
            '</div>';
          const ta = body.querySelector('.edit-area');
          ta.value = original;
          ta.focus();
          const finish = (revert) => {
            if (revert) body.textContent = original;
            card.dataset.editing = '';
          };
          body.querySelector('.cancel-btn').onclick = () => finish(true);
          body.querySelector('.save-btn').onclick = async () => {
            const newContent = ta.value.trim();
            if (!newContent) { vp.toast('Komentář nesmí být prázdný.', 'warning'); return; }
            const saveBtn = body.querySelector('.save-btn');
            saveBtn.disabled = true;
            const res = await vp.api.put('/api/comments/' + cid, { content: newContent });
            if (res.ok) {
              vp.toast('Komentář upraven', 'success', 1500);
              card.dataset.editing = '';
              loadComments();
            } else {
              vp.toastApiError(res, 'Úprava komentáře selhala.');
              saveBtn.disabled = false;
            }
          };
          return;
        }

        // 4c. Smazání komentáře
        if (btn.dataset.rm !== undefined) {
          const cid = btn.dataset.rm;
          const ok = await vp.confirm('Opravdu smazat tento komentář?', {
            title: 'Smazat komentář',
            confirmText: 'Smazat',
            danger: true,
          });
          if (!ok) return;
          btn.disabled = true;
          const res = await vp.api.del('/api/comments/' + cid);
          if (res.ok) {
            vp.toast('Komentář smazán', 'success', 1500);
            const card = btn.closest('[data-cid]');
            if (card) card.remove();
          } else {
            btn.disabled = false;
            vp.toastApiError(res, 'Smazání komentáře selhalo.');
          }
        }
      });

      // 5. Obsluha formuláře pro nový komentář.
      const cform = document.getElementById('cform');
      if (cform) {
        cform.onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const content = (fd.get('content') || '').toString().trim();
          if (!content) { vp.toast('Komentář nesmí být prázdný.', 'warning'); return; }
          const { ok, data } = await vp.api.post('/api/comments', { video_id: ${id}, content });
          if (ok) {
            e.target.reset();
            vp.toast('Komentář přidán', 'success', 1500);
            loadComments();
          } else {
            vp.toastApiError({ data }, 'Odeslání komentáře selhalo.');
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
            <td>
              <a class="secondary" style="text-decoration:none; padding:4px 8px; font-size:0.9em; border-radius:6px; border:1px solid var(--border);" href="/edit-video/${v.id}">Upravit</a>
              <button data-del="${v.id}" class="del" type="button">Smazat</button>
            </td></tr>`
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
        if (r.ok) { vp.toast('Heslo změněno', 'success'); e.target.reset(); }
        else { vp.toast(j.error || 'Chyba', 'error'); }
      };
      document.querySelectorAll('button.del[data-del]').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.del;
        const ok = await vp.confirm('Opravdu smazat toto video?', { title: 'Smazat video', confirmText: 'Smazat', danger: true });
        if (!ok) return;
        btn.disabled = true;
        const r = await vp.api.del('/api/videos/' + id);
        if (r.ok) {
          vp.toast('Video smazáno', 'success');
          const tr = btn.closest('tr');
          if (tr) tr.remove();
        } else {
          btn.disabled = false;
          vp.toastApiError(r, 'Smazání videa selhalo.');
        }
      });
    </script>
  `;
  res.send(layout('Profil', body, req.user));
});

// ============================================================
// Admin sekce (Fáze 1 – kompletní Admin UI)
// ============================================================

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
  // Fáze 1 – nové akce: správa videí, logy (odkaz na /admin/logs je už v akcích).
  const body = `
    <h1>🛠 Admin dashboard</h1>
    <div class="card">
      <h3>Statistiky</h3>
      <p>👤 Uživatelé: <b>${stats.users || 0}</b></p>
      <p>🎬 Videa (živá): <b>${stats.videos || 0}</b></p>
      <p>💬 Komentáře: <b>${stats.comments || 0}</b></p>
      <p>📁 Kategorie: <b>${stats.categories || 0}</b></p>
    </div>
    <div class="card">
      <h3>Akce</h3>
      <p><a href="/admin/videos">🎬 Správa videí</a></p>
      <p><a href="/admin/users">👥 Správa uživatelů</a></p>
      <p><a href="/admin/categories">📁 Správa kategorií</a></p>
      <p><a href="/admin/logs">📜 Systémové logy</a></p>
    </div>
  `;
  res.send(layout('Admin', body, req.user));
});


// ===== /admin/videos – Fáze 1: tabulka, změna stavu, smazání =====
router.get('/admin/videos', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.MODERATE_VIDEOS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  const body = `
    <h1>🎬 Správa videí</h1>
    <div class="filter-bar">
      <input id="f-q" type="text" placeholder="Hledat v názvu/popisu…">
      <select id="f-status">
        <option value="">Všechny stavy</option>
        <option value="published">published</option>
        <option value="flagged">flagged</option>
        <option value="takedown">takedown</option>
        <option value="pending">pending</option>
      </select>
      <label class="row" style="gap:4px; margin:0;">
        <input id="f-deleted" type="checkbox"> <span class="muted">Včetně smazaných</span>
      </label>
      <button id="f-apply" type="button">Filtrovat</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>ID</th><th>Název</th><th>Autor</th><th>Kategorie</th><th>Stav</th><th>Akce</th></tr>
        </thead>
        <tbody id="tbody"><tr><td colspan="6" class="muted">Načítám…</td></tr></tbody>
      </table>
    </div>
    <script>
      const tbody = document.getElementById('tbody');
      const fQ = document.getElementById('f-q');
      const fStatus = document.getElementById('f-status');
      const fDeleted = document.getElementById('f-deleted');
      document.getElementById('f-apply').addEventListener('click', load);
      fQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });

      function rowHtml(v) {
        return '<tr data-id="' + v.id + '">' +
          '<td>' + v.id + '</td>' +
          '<td><a href="/video/' + v.id + '">' + vp.escapeHtml(v.title || '(bez názvu)') + '</a></td>' +
          '<td>' + vp.escapeHtml(v.author_username || '—') + '</td>' +
          '<td>' + vp.escapeHtml((v.category_icon || '') + ' ' + (v.category_name || '—')) + '</td>' +
          '<td><span class="pill ' + vp.escapeHtml(v.status) + '">' + vp.escapeHtml(v.status) + '</span></td>' +
          '<td class="actions">' +
            '<select class="status-sel" data-id="' + v.id + '">' +
              '<option value="">— změnit stav —</option>' +
              ['published','flagged','takedown'].map(s => '<option value="' + s + '">' + s + '</option>').join('') +
            '</select> ' +
            '<button class="del" data-del="' + v.id + '" type="button">Smazat</button>' +
          '</td>' +
        '</tr>';
      }

      async function load() {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">Načítám…</td></tr>';
        const params = new URLSearchParams();
        if (fQ.value.trim()) params.set('q', fQ.value.trim());
        if (fStatus.value) params.set('status', fStatus.value);
        if (fDeleted.checked) params.set('includeDeleted', '1');
        const res = await vp.api.get('/api/videos/admin?' + params.toString());
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="6" class="danger">Načtení selhalo: ' + vp.escapeHtml((res.data && res.data.error) || 'chyba') + '</td></tr>';
          return;
        }
        const videos = (res.data && res.data.videos) || [];
        if (videos.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="muted">Žádná videa neodpovídají filtru.</td></tr>';
          return;
        }
        tbody.innerHTML = videos.map(rowHtml).join('');
      }

      // Delegace akcí v tabulce.
      tbody.addEventListener('change', async (e) => {
        const sel = e.target.closest('select.status-sel');
        if (!sel) return;
        const id = sel.dataset.id;
        const status = sel.value;
        if (!status) return;
        sel.disabled = true;
        const res = await vp.api.post('/api/videos/' + id + '/status', { status });
        sel.disabled = false;
        if (res.ok) {
          vp.toast('Stav videa změněn na ' + status, 'success');
          load();
        } else {
          sel.value = '';
          vp.toastApiError(res, 'Změna stavu selhala.');
        }
      });

      tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-del]');
        if (!btn) return;
        const id = btn.dataset.del;
        const ok = await vp.confirm('Opravdu smazat video id=' + id + '? Bude soft-delete.', {
          title: 'Smazat video', confirmText: 'Smazat', danger: true,
        });
        if (!ok) return;
        btn.disabled = true;
        const res = await vp.api.del('/api/videos/' + id);
        if (res.ok) {
          vp.toast('Video smazáno', 'success');
          load();
        } else {
          btn.disabled = false;
          vp.toastApiError(res, 'Smazání selhalo.');
        }
      });

      load();
    </script>
  `;
  res.send(layout('Správa videí', body, req.user));
});

// ===== /admin/users – Fáze 1: tabulka, nový uživatel, správa rolí, smazání =====
router.get('/admin/users', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.MANAGE_USERS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  // Data pro rozhraní – načteme vše z GET /api/users.
  const body = `
    <h1>👥 Správa uživatelů</h1>
    <p class="muted">Vytváření nových účtů, přiřazování a odebírání rolí, mazání účtů.</p>
    <form id="newu" class="card row">
      <input name="username" placeholder="Uživatel" required minlength="2">
      <input name="password" type="password" placeholder="Heslo (min 4)" required minlength="4">
      <button type="submit">Přidat</button>
      <span id="newu-msg" class="muted"></span>
    </form>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>ID</th><th>Uživatel</th><th>Role</th><th>Akce</th></tr>
        </thead>
        <tbody id="tbody"><tr><td colspan="4" class="muted">Načítám…</td></tr></tbody>
      </table>
    </div>
    <script>
      const tbody = document.getElementById('tbody');
      let rolesCache = [];
      let usersCache = [];

      function rolePill(r) {
        return '<span class="pill" style="margin-right:4px;">' + vp.escapeHtml(r) + '</span>';
      }

      function rowHtml(u) {
        const myId = ${JSON.stringify(req.user ? req.user.id : null)};
        const currentRoles = (u.role_names || []).slice();
        return '<tr data-id="' + u.id + '">' +
          '<td>' + u.id + (u.id === myId ? ' <small class="muted">(vy)</small>' : '') + '</td>' +
          '<td>' + vp.escapeHtml(u.username) + '</td>' +
          '<td><div class="inline-actions">' +
            currentRoles.map(r => rolePill(r) + '<button class="rm-role secondary" data-uid="' + u.id + '" data-role="' + vp.escapeHtml(r) + '" type="button" title="Odebrat">×</button>').join('') +
          '</div></td>' +
          '<td class="actions">' +
            '<select class="role-sel" data-uid="' + u.id + '">' +
              '<option value="">+ přidat…</option>' +
              rolesCache.map(r => '<option value="' + r.id + '">' + vp.escapeHtml(r.display_name) + '</option>').join('') +
            '</select> ' +
            (u.id !== myId
              ? '<button class="del" data-del="' + u.id + '" type="button">Smazat</button>'
              : '<span class="muted" title="Nemůžete smazat sám sebe">—</span>') +
          '</td>' +
        '</tr>';
      }

      async function load() {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">Načítám…</td></tr>';
        const res = await vp.api.get('/api/users');
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="4" class="danger">Načtení selhalo: ' + vp.escapeHtml((res.data && res.data.error) || 'chyba') + '</td></tr>';
          return;
        }
        usersCache = (res.data && res.data.users) || [];
        rolesCache = (res.data && res.data.roles) || [];
        if (usersCache.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="muted">Žádní uživatelé.</td></tr>';
          return;
        }
        tbody.innerHTML = usersCache.map(rowHtml).join('');
      }

      // Nový uživatel
      document.getElementById('newu').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        const res = await vp.api.post('/api/users', {
          username: (fd.get('username') || '').toString().trim(),
          password: (fd.get('password') || '').toString(),
        });
        btn.disabled = false;
        if (res.ok) {
          vp.toast('Uživatel vytvořen', 'success');
          e.target.reset();
          load();
        } else {
          vp.toastApiError(res, 'Vytvoření uživatele selhalo.');
        }
      });

      // Akce v tabulce – delegace.
      tbody.addEventListener('change', async (e) => {
        const sel = e.target.closest('select.role-sel');
        if (!sel) return;
        const uid = sel.dataset.uid;
        const roleId = parseInt(sel.value, 10);
        if (!roleId) return;
        sel.disabled = true;
        const res = await vp.api.post('/api/users/' + uid + '/role', { roleId });
        sel.disabled = false;
        if (res.ok) {
          vp.toast('Role přiřazena', 'success');
          sel.value = '';
          load();
        } else {
          sel.value = '';
          vp.toastApiError(res, 'Přiřazení role selhalo.');
        }
      });

      tbody.addEventListener('click', async (e) => {
        const rmRoleBtn = e.target.closest('button.rm-role');
        if (rmRoleBtn) {
          const uid = rmRoleBtn.dataset.uid;
          const roleName = rmRoleBtn.dataset.role;
          // Najdeme roleId podle názvu.
          const role = rolesCache.find(r => r.display_name === roleName);
          if (!role) { vp.toast('Role nenalezena', 'error'); return; }
          const ok = await vp.confirm('Odebrat roli „' + roleName + '“ uživateli?', {
            title: 'Odebrat roli', confirmText: 'Odebrat', danger: true,
          });
          if (!ok) return;
          rmRoleBtn.disabled = true;
          // Backend: DELETE /api/users/:userId/role přijímá roleId v těle.
          // Náš fetch wrapper neposílá body u DELETE, takže jdeme přes raw fetch.
          try {
            const raw = await fetch('/api/users/' + uid + '/role', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ roleId: role.id }),
            });
            if (raw.ok) {
              vp.toast('Role odebrána', 'success');
              load();
            } else {
              let err = 'Odebrání role selhalo';
              try { const j = await raw.json(); if (j.error) err = j.error; } catch (_) {}
              vp.toast(err, 'error');
              rmRoleBtn.disabled = false;
            }
          } catch (err) {
            vp.toast(err.message || 'Odebrání role selhalo', 'error');
            rmRoleBtn.disabled = false;
          }
          return;
        }

        const delBtn = e.target.closest('button[data-del]');
        if (delBtn) {
          const uid = delBtn.dataset.del;
          const ok = await vp.confirm('Opravdu smazat uživatele id=' + uid + '? Tato akce je nevratná.', {
            title: 'Smazat uživatele', confirmText: 'Smazat', danger: true,
          });
          if (!ok) return;
          delBtn.disabled = true;
          const res = await vp.api.del('/api/users/' + uid);
          if (res.ok) {
            vp.toast('Uživatel smazán', 'success');
            load();
          } else {
            delBtn.disabled = false;
            vp.toastApiError(res, 'Smazání selhalo.');
          }
        }
      });

      load();
    </script>
  `;
  res.send(layout('Uživatelé', body, req.user));
});

// ===== /admin/categories – Fáze 1: CRUD včetně přejmenování =====
router.get('/admin/categories', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.MANAGE_CATEGORIES)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  const body = `
    <h1>📁 Správa kategorií</h1>
    <p class="muted">Vytváření, přejmenování a mazání kategorií. Pole ikona a barva jsou nepovinná.</p>
    <form id="newc" class="card row">
      <input name="name" placeholder="Název" required>
      <input name="icon" placeholder="📁" maxlength="4" class="icon-input">
      <input name="color" placeholder="#007bff" class="color-input">
      <button type="submit">Přidat</button>
    </form>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Ikona</th><th>Název</th><th>Barva</th><th>Akce</th></tr>
        </thead>
        <tbody id="tbody"><tr><td colspan="4" class="muted">Načítám…</td></tr></tbody>
      </table>
    </div>
    <script>
      const tbody = document.getElementById('tbody');
      function rowHtml(c) {
        return '<tr data-id="' + c.id + '">' +
          '<td><input class="ic icon-input" data-id="' + c.id + '" data-field="icon" value="' + vp.escapeHtml(c.icon || '') + '"></td>' +
          '<td><input class="nm" data-id="' + c.id + '" data-field="name" value="' + vp.escapeHtml(c.name || '') + '" required></td>' +
          '<td><input class="cl color-input" data-id="' + c.id + '" data-field="color" value="' + vp.escapeHtml(c.color || '') + '"></td>' +
          '<td class="actions">' +
            '<button class="save secondary" data-save="' + c.id + '" type="button">Uložit</button> ' +
            '<button class="del" data-del="' + c.id + '" type="button">Smazat</button>' +
          '</td>' +
        '</tr>';
      }

      async function load() {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">Načítám…</td></tr>';
        const res = await vp.api.get('/api/categories');
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="4" class="danger">Načtení selhalo</td></tr>';
          return;
        }
        const cats = (res.data && res.data.categories) || [];
        if (cats.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="muted">Žádné kategorie.</td></tr>';
          return;
        }
        tbody.innerHTML = cats.map(rowHtml).join('');
      }

      document.getElementById('newc').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        const res = await vp.api.post('/api/categories', {
          name: (fd.get('name') || '').toString().trim(),
          icon: (fd.get('icon') || '').toString().trim() || undefined,
          color: (fd.get('color') || '').toString().trim() || undefined,
        });
        btn.disabled = false;
        if (res.ok) {
          vp.toast('Kategorie vytvořena', 'success');
          e.target.reset();
          load();
        } else {
          vp.toastApiError(res, 'Vytvoření kategorie selhalo.');
        }
      });

      tbody.addEventListener('click', async (e) => {
        const saveBtn = e.target.closest('button[data-save]');
        if (saveBtn) {
          const id = saveBtn.dataset.save;
          const tr = saveBtn.closest('tr');
          const name  = tr.querySelector('input.nm').value.trim();
          const icon  = tr.querySelector('input.ic').value.trim();
          const color = tr.querySelector('input.cl').value.trim();
          if (!name) { vp.toast('Název nesmí být prázdný.', 'warning'); return; }
          saveBtn.disabled = true;
          const res = await vp.api.put('/api/categories/' + id, { name, icon, color });
          saveBtn.disabled = false;
          if (res.ok) { vp.toast('Kategorie uložena', 'success'); }
          else { vp.toastApiError(res, 'Uložení selhalo.'); }
          return;
        }

        const delBtn = e.target.closest('button[data-del]');
        if (delBtn) {
          const id = delBtn.dataset.del;
          const ok = await vp.confirm('Opravdu smazat kategorii id=' + id + '?', {
            title: 'Smazat kategorii', confirmText: 'Smazat', danger: true,
          });
          if (!ok) return;
          delBtn.disabled = true;
          const res = await vp.api.del('/api/categories/' + id);
          if (res.ok) {
            vp.toast('Kategorie smazána', 'success');
            load();
          } else {
            delBtn.disabled = false;
            vp.toastApiError(res, 'Smazání selhalo.');
          }
        }
      });

      load();
    </script>
  `;
  res.send(layout('Kategorie', body, req.user));
});

// ===== /admin/logs – Fáze 1: živé logy v UI (ne jen odkaz na endpoint) =====
router.get('/admin/logs', (req, res) => {
  if (!req.user || !req.user.permissions.includes(PERMISSIONS.VIEW_SYSTEM_LOGS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  // Dnešní datum (cs-CZ) pro výchozí hodnotu filtru.
  const today = new Date().toISOString().split('T')[0];
  const body = `
    <h1>📜 Systémové logy</h1>
    <p class="muted">Živé logy z <code>GET /api/system/logs</code>. Zdrojový soubor: <code>logs/videoportal-YYYY-MM-DD.log</code>.</p>
    <div class="filter-bar">
      <label>Datum
        <input id="f-date" type="date" value="${today}">
      </label>
      <label>Limit
        <input id="f-limit" type="number" min="10" max="1000" value="200" style="width:90px;">
      </label>
      <button id="f-apply" type="button">Načíst</button>
      <button id="f-refresh" class="secondary" type="button">Obnovit</button>
      <label class="row" style="gap:4px; margin:0;">
        <input id="f-auto" type="checkbox"> <span class="muted">Auto-refresh každých 10s</span>
      </label>
      <span id="status" class="muted" style="margin-left:auto;"></span>
    </div>
    <div class="card" id="log-box" style="max-height: 70vh; overflow:auto; padding:0;">
      <em class="muted" style="padding:12px; display:block;">Načítám…</em>
    </div>
    <script>
      const logBox = document.getElementById('log-box');
      const fDate = document.getElementById('f-date');
      const fLimit = document.getElementById('f-limit');
      const fAuto = document.getElementById('f-auto');
      const statusEl = document.getElementById('status');

      // Formát řádku logu: [datum] [TYP] zpráva | Data: {…}
      function parseLine(line) {
        // Přijímáme jak náš serverový formát s hranatými závorkami, tak surové řádky.
        const m = line.match(/^\\[([^\\]]+)\\]\\s+\\[([A-Z]+)\\]\\s+(.*)$/);
        if (m) return { ts: m[1], type: m[2], msg: m[3] };
        return { ts: '', type: 'INFO', msg: line };
      }
      function escapeHtml(s) { return vp.escapeHtml(s); }
      function render(logs) {
        if (!logs || logs.length === 0) {
          logBox.innerHTML = '<em class="muted" style="padding:12px; display:block;">Žádné záznamy pro zvolený den.</em>';
          return;
        }
        logBox.innerHTML = logs.map(line => {
          const p = parseLine(line);
          return '<div class="log-line">' +
            '<span class="log-time">' + escapeHtml(p.ts) + '</span>' +
            '<span class="log-type log-type-' + escapeHtml(p.type) + '">' + escapeHtml(p.type) + '</span>' +
            '<span class="log-msg">' + escapeHtml(p.msg) + '</span>' +
          '</div>';
        }).join('');
      }

      async function load() {
        statusEl.textContent = 'Načítám…';
        const params = new URLSearchParams();
        if (fDate.value) params.set('date', fDate.value);
        const limit = parseInt(fLimit.value, 10);
        if (limit > 0) params.set('limit', String(Math.min(limit, 1000)));
        const res = await vp.api.get('/api/system/logs?' + params.toString());
        if (!res.ok) {
          logBox.innerHTML = '<em class="muted" style="padding:12px; display:block; color: var(--danger);">Načtení selhalo: ' + escapeHtml((res.data && res.data.error) || 'chyba') + '</em>';
          statusEl.textContent = '';
          return;
        }
        render((res.data && res.data.logs) || []);
        statusEl.textContent = 'Načteno ' + ((res.data && res.data.logs) || []).length + ' záznamů';
      }

      let autoTimer = null;
      function syncAuto() {
        if (fAuto.checked) {
          if (!autoTimer) autoTimer = setInterval(load, 10000);
        } else {
          if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
        }
      }
      fAuto.addEventListener('change', syncAuto);
      document.getElementById('f-apply').addEventListener('click', load);
      document.getElementById('f-refresh').addEventListener('click', load);

      load();
    </script>
  `;
  res.send(layout('Logy', body, req.user));
});

// ===== /edit-video/:id – Fáze 1: editace metadat + smazání autorem =====
router.get('/edit-video/:id', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const id = parseInt(req.params.id, 10);
  const { row: v } = db.get(`SELECT * FROM videos WHERE id = ?`, [id]);
  if (!v) return res.status(404).send(layout('Nenalezeno', '<p>Video neexistuje.</p>', req.user));
  if (v.user_id !== req.user.id && !req.user.permissions.includes(PERMISSIONS.EDIT_ALL_VIDEOS)) {
    return res.status(403).send(layout('Přístup odepřen', '<p class="danger">Nemáte oprávnění.</p>', req.user));
  }
  const { rows: cats } = db.all(`SELECT * FROM categories ORDER BY name`);
  const canDelete = v.user_id === req.user.id || req.user.permissions.includes(PERMISSIONS.DELETE_ANY_CONTENT);
  const body = `
    <h1>✏️ Editace videa</h1>
    <p class="muted"><a href="/video/${id}">← Zpět na detail videa</a></p>
    <form id="f" class="card">
      <p><label>Název<br><input name="title" value="${escape(v.title)}" required></label></p>
      <p><label>Popis<br><textarea name="description" rows="4">${escape(v.description || '')}</textarea></label></p>
      <p><label>Kategorie<br>
        <select name="category_id">
          <option value="">-- bez kategorie --</option>
          ${cats.map((c) => `<option value="${c.id}" ${c.id === v.category_id ? 'selected' : ''}>${escape(c.icon)} ${escape(c.name)}</option>`).join('')}
        </select>
      </label></p>
      <p><label>Viditelnost<br>
        <select name="visibility">
          <option value="public"   ${v.visibility === 'public'   ? 'selected' : ''}>🌍 public – veřejné</option>
          <option value="unlisted" ${v.visibility === 'unlisted' ? 'selected' : ''}>🔗 unlisted – přístup přes link</option>
          <option value="private"  ${v.visibility === 'private'  ? 'selected' : ''}>🔒 private – soukromé</option>
        </select>
      </label></p>
      <p>
        <button type="submit">Uložit změny</button>
        <a href="/video/${id}" class="secondary" style="text-decoration:none; padding:8px 14px; border-radius:6px; border:1px solid var(--border); display:inline-block; margin-left:6px;">Zrušit</a>
      </p>
    </form>
    ${canDelete ? `
      <div class="card" style="border-color: var(--danger);">
        <h3 style="color: var(--danger);">Nebezpečná zóna</h3>
        <p class="muted">Smazání videa je nevratné (soft delete – auditní stopa zůstává v databázi).</p>
        <button id="btn-del" class="del" type="button">🗑 Smazat toto video</button>
      </div>
    ` : ''}
    <script>
      document.getElementById('f').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        const res = await vp.api.put('/api/videos/${id}', {
          title: (fd.get('title') || '').toString().trim(),
          description: (fd.get('description') || '').toString(),
          category_id: fd.get('category_id') || null,
          visibility: fd.get('visibility') || 'public',
        });
        btn.disabled = false;
        if (res.ok) {
          vp.toast('Změny uloženy', 'success');
          setTimeout(() => location.href = '/video/${id}', 500);
        } else {
          vp.toastApiError(res, 'Uložení selhalo.');
        }
      };
      const delBtn = document.getElementById('btn-del');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const ok = await vp.confirm('Opravdu smazat toto video? (soft delete)', {
            title: 'Smazat video', confirmText: 'Smazat', danger: true,
          });
          if (!ok) return;
          delBtn.disabled = true;
          const res = await vp.api.del('/api/videos/${id}');
          if (res.ok) {
            vp.toast('Video smazáno', 'success');
            setTimeout(() => location.href = '/', 500);
          } else {
            delBtn.disabled = false;
            vp.toastApiError(res, 'Smazání selhalo.');
          }
        });
      }
    </script>
  `;
  res.send(layout('Editace', body, req.user));
});

module.exports = router;
