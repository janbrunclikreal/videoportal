/* VideoPortal v2 – frontend utilita.
   Poskytuje window.vp.fetch() wrapper, který vždy posílá session cookie
   a parsuje JSON. Interní HTML pohledy (views.routes.js) ho mohou použít
   místo raw fetch().

   Fáze 1: Přidány toasty, modální potvrzení a drobné UI helpery. */

(function () {
  'use strict';

  function buildHeaders(body, extra) {
    const headers = Object.assign({}, extra || {});
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    return headers;
  }

  async function request(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: buildHeaders(body),
    };
    if (body !== undefined) {
      opts.body = body instanceof FormData ? body : JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') !== -1) {
      try { data = await res.json(); } catch (_) { data = null; }
    } else {
      try { data = await res.text(); } catch (_) { data = null; }
    }
    return { ok: res.ok, status: res.status, data };
  }

  const api = {
    get:    (path)        => request('GET', path),
    post:   (path, body)  => request('POST', path, body || {}),
    put:    (path, body)  => request('PUT', path, body || {}),
    del:    (path)        => request('DELETE', path),
    health: () => request('GET', '/api/health'),
    me:     () => request('GET', '/api/users/me'),
    tos:    () => request('GET', '/api/legal/tos'),
    logout: async () => {
      await request('POST', '/api/auth/logout');
      window.location.href = '/';
    },
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ===== Toast notifikace =====
  // Nahrazují nativní alert() v celé app. Varianty: success, error, info, warning.
  // Použití: vp.toast('Uloženo', 'success');  vp.toast('Nelze smazat', 'error');
  function ensureToastContainer() {
    let el = document.getElementById('toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-container';
      el.className = 'toast-container';
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'true');
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, type = 'info', timeoutMs = 4000) {
    const container = ensureToastContainer();
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.setAttribute('role', 'status');
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    t.innerHTML =
      '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
      '<span class="toast-msg"></span>' +
      '<button class="toast-close" type="button" aria-label="Zavřít">×</button>';
    t.querySelector('.toast-msg').textContent = String(message);
    container.appendChild(t);
    // Animace vstupu
    requestAnimationFrame(() => t.classList.add('show'));
    const remove = () => {
      t.classList.remove('show');
      t.classList.add('hide');
      setTimeout(() => t.remove(), 250);
    };
    t.querySelector('.toast-close').addEventListener('click', remove);
    if (timeoutMs > 0) setTimeout(remove, timeoutMs);
    return remove;
  }

  // ===== Modální potvrzovací dialog =====
  // Nahrazuje nativní confirm(). Vrátí Promise<boolean>.
  //   const yes = await vp.confirm('Opravdu smazat?');
  function ensureModalContainer() {
    let el = document.getElementById('modal-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'modal-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function confirmModal(message, opts = {}) {
    const title = opts.title || 'Potvrzení akce';
    const confirmText = opts.confirmText || 'Potvrdit';
    const cancelText = opts.cancelText || 'Zrušit';
    const danger = !!opts.danger;

    return new Promise((resolve) => {
      const container = ensureModalContainer();
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<h3 class="modal-title"></h3>' +
          '<p class="modal-body"></p>' +
          '<div class="modal-actions">' +
            '<button class="modal-cancel secondary" type="button"></button>' +
            '<button class="modal-ok" type="button"></button>' +
          '</div>' +
        '</div>';
      overlay.querySelector('.modal-title').textContent = title;
      overlay.querySelector('.modal-body').textContent = message;
      const cancelBtn = overlay.querySelector('.modal-cancel');
      const okBtn = overlay.querySelector('.modal-ok');
      cancelBtn.textContent = cancelText;
      okBtn.textContent = confirmText;
      if (danger) okBtn.classList.add('del');
      container.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));

      const cleanup = (result) => {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 200);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const onKey = (e) => { if (e.key === 'Escape') cleanup(false); };
      cancelBtn.addEventListener('click', () => cleanup(false));
      okBtn.addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
      document.addEventListener('keydown', onKey);
      setTimeout(() => okBtn.focus(), 50);
    });
  }

  // ===== Formátování data =====
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('cs-CZ');
  }

  // ===== Helper: zobrazí API chybu jako toast =====
  function toastApiError(res, fallback = 'Akce selhala') {
    const msg = (res && res.data && (res.data.error || res.data.message)) || fallback;
    toast(msg, 'error');
  }

  // Odchycení submitu odhlašovacího formuláře
  document.addEventListener('DOMContentLoaded', () => {
    const logoutForm = document.querySelector('form.logout-form, form[action*="/api/auth/logout"]');
    if (logoutForm) {
      logoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api.post(logoutForm.getAttribute('action') || '/api/auth/logout');
        } catch (err) {
          console.error('Logout error:', err);
        } finally {
          window.location.href = '/';
        }
      });
    }
  });

  window.vp = {
    api,
    escapeHtml,
    toast,
    confirm: confirmModal,
    formatDate,
    toastApiError,
  };
})();
