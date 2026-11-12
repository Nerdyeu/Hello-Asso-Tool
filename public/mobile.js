// Trombinoscope HelloAsso - appli Android (Capacitor).
// Sur ordinateur, ce fichier ne fait rien : la page parle au serveur local (server.js).
// Dans l'appli Android, il n'y a pas de serveur : ce fichier répond lui-même aux appels /api/* de la page,
// en appelant HelloAsso par le réseau natif d'Android (pas de blocage CORS) et en stockant les données
// dans la mémoire privée de l'appli.
(function () {
  'use strict';
  const Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;

  const core = window.TrombiCore;
  const Http = Cap.Plugins.CapacitorHttp;
  const Printer = Cap.registerPlugin('TrombiPrint');

  // ---------- réseau ----------
  const header = (headers, name) => {
    for (const k in headers || {}) if (k.toLowerCase() === name) return String(headers[k]);
    return '';
  };
  // adaptateur « façon fetch » pour core.createClient
  async function http(url, { method = 'GET', headers = {}, body } = {}) {
    const r = await Http.request({ url, method, headers, data: body, responseType: 'text' });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data),
    };
  }
  const client = core.createClient({ http });

  // ---------- stockage (mémoire privée de l'appli, effacée seulement avec l'appli) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('trombi.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { localStorage.setItem('trombi.' + k, JSON.stringify(v)); },
  };
  const loadConfig = () => ({ ...core.DEFAULT_CONFIG, ...store.get('config', {}) });

  // ---------- photos ----------
  // le jeton n'accompagne que l'appel direct à l'API HelloAsso ; une redirection est suivie sans lui
  async function getPhoto(raw) {
    const u = core.photoUrl(raw);
    if (!u) throw new Error('URL refusée');
    const get = (url, headers = {}, disableRedirects = false) =>
      Http.request({ url: String(url), method: 'GET', headers, responseType: 'blob', disableRedirects });
    let r = await get(u);
    if ((r.status < 200 || r.status >= 300) && client.isApiUrl(u)) {
      r = await get(u, { Authorization: 'Bearer ' + await client.getToken(loadConfig()) }, true);
      const loc = r.status >= 300 && r.status < 400 && header(r.headers, 'location');
      if (loc) {
        const next = new URL(loc, u);
        if (next.protocol !== 'https:') throw new Error('Redirection refusée');
        r = await get(next);
      }
    }
    if (r.status < 200 || r.status >= 300) throw new Error('Photo inaccessible (' + r.status + ')');
    const type = header(r.headers, 'content-type').split(';')[0].trim().toLowerCase();
    if (!core.PHOTO_TYPE.test(type)) throw new Error('Ce fichier n\'est pas une photo');
    const b64 = String(r.data || '').replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length * 0.75 > core.MAX_PHOTO) throw new Error('Photo invalide');
    return `data:${type};base64,${b64}`;
  }
  const photos = new Map();      // URL HelloAsso -> data: (cache le temps de la session)
  const pending = new Map();
  function loadPhoto(raw) {
    if (photos.has(raw)) return Promise.resolve(photos.get(raw));
    if (!pending.has(raw)) {
      pending.set(raw, getPhoto(raw).then(d => { photos.set(raw, d); return d; }, () => null).finally(() => pending.delete(raw)));
    }
    return pending.get(raw);
  }
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  // ---------- les « routes » /api/* de server.js, côté appli ----------
  const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fail = (status, msg) => new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
  const parse = b => { try { return JSON.parse(b || 'null'); } catch { throw new Error('Requête invalide'); } };

  async function api(url, opts = {}) {
    const path = new URL(url, location.href).pathname;
    const method = (opts.method || 'GET').toUpperCase();
    try {
      switch (path) {
        case '/api/config':
          if (method === 'POST') { store.set('config', core.mergeConfig(loadConfig(), parse(opts.body))); client.resetToken(); return ok({ ok: true }); }
          return ok(core.publicConfig(loadConfig()));
        case '/api/members': return ok(await client.members(loadConfig()));
        case '/api/test': return ok(await client.test(loadConfig()));
        case '/api/debug': return ok(await client.debug(loadConfig()));
        case '/api/ping': return ok({ ok: true });
        case '/api/hidden': {
          const h = store.get('hidden', {});
          if (method === 'POST') {
            const { add = [], remove = [] } = parse(opts.body) || {};
            if (!Array.isArray(add) || !Array.isArray(remove)) throw new Error('Requête invalide');
            for (const m of add) if (m && core.isStr(m.key)) h[m.key] = { firstName: core.isStr(m.firstName) ? m.firstName : '', lastName: core.isStr(m.lastName) ? m.lastName : '' };
            for (const k of remove) if (core.isStr(k)) delete h[k];
            store.set('hidden', h);
          }
          return ok(h);
        }
        case '/api/printed': {
          const list = store.get('printed', []);
          if (method === 'POST') {
            const ids = parse(opts.body);
            if (!Array.isArray(ids)) throw new Error('Requête invalide');
            store.set('printed', [...new Set([...list, ...ids.filter(core.isStr)])]);
            return ok({ ok: true });
          }
          return ok(list);
        }
        default: return fail(404, 'Introuvable');
      }
    } catch (e) {
      return fail(500, e.message || String(e));
    }
  }

  window.TrombiMobile = {
    api,
    // image affichée tout de suite (photo déjà chargée, ou image vide en attendant)
    photoSrc: raw => photos.get(raw) || BLANK,
    // charge les photos des <img data-photo> d'une zone, 4 à la fois
    async hydrate(rootEl) {
      const imgs = [...rootEl.querySelectorAll('img[data-photo]')].filter(i => !photos.has(i.dataset.photo));
      const run = async () => {
        for (let img; (img = imgs.shift());) {
          const d = await loadPhoto(img.dataset.photo);
          if (d) document.querySelectorAll('img[data-photo]').forEach(i => { if (i.dataset.photo === img.dataset.photo) i.src = d; });
        }
      };
      await Promise.all([run(), run(), run(), run()]);
    },
    // ouvre la fenêtre d'impression d'Android (imprimante ou « Enregistrer au format PDF »)
    print: name => Printer.print({ name: String(name || 'Trombinoscope').slice(0, 80) }),
  };
})();
