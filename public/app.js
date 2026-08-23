/* VideoPortal v2 – frontend utilita.
   Poskytuje window.vp.fetch() wrapper, který vždy posílá session cookie
   a parsuje JSON. Interní HTML pohledy (views.routes.js) ho mohou použít
   místo raw fetch(). */

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

  window.vp = { api, escapeHtml };
})();
