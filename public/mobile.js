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
  // téléchargement natif, puis vérification que c'est bien une image (d'après son contenu)
  async function getImage(url, headers = {}, disableRedirects = false) {
    const r = await Http.request({ url: String(url), method: 'GET', headers, responseType: 'blob', disableRedirects });
    const info = { status: r.status, contentType: header(r.headers, 'content-type') };
    if (r.status >= 300 && r.status < 400) return { ...info, location: header(r.headers, 'location') };
    if (r.status < 200 || r.status >= 300) return info;
    const b64 = String(r.data || '').replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return info;
    if (b64.length * 0.75 > core.MAX_PHOTO) return { ...info, tooBig: true };
    const head = Uint8Array.from(atob(b64.slice(0, 64)), c => c.charCodeAt(0));
    return { ...info, b64, type: core.photoType(head, info.contentType) };
  }
  // 1er essai sans jeton ; sinon avec le jeton, uniquement vers les serveurs de HelloAsso (core.tokenAllowed),
  // en suivant chaque redirection à la main (le jeton n'est transmis que si l'étape suivante est chez HelloAsso)
  async function fetchPhoto(u) {
    const res = await getImage(u);
    if (res.type || !client.tokenAllowed(u)) return res;
    const auth = { Authorization: 'Bearer ' + await client.getToken(loadConfig()) };
    let url = u;
    for (let i = 0; i < 5; i++) {
      const r = await getImage(url, client.tokenAllowed(url) ? auth : {}, true);
      if (!r.location) return r;
      const next = new URL(r.location, url);
      if (next.protocol !== 'https:') throw new Error('Redirection refusée');
      url = next;
    }
    throw new Error('Trop de redirections');
  }
  const photoProblem = res => res.tooBig ? 'Photo trop volumineuse'
    : res.status < 200 || res.status >= 300 ? `Photo inaccessible (HTTP ${res.status})`
    : !res.type ? `Ce fichier n'est pas une image reconnue (type annoncé : ${res.contentType || 'aucun'})` : null;
  async function getPhoto(raw) {
    const u = core.photoUrl(raw);
    if (!u) throw new Error('URL refusée');
    const res = await fetchPhoto(u);
    const problem = photoProblem(res);
    if (problem) throw new Error(problem);
    return `data:${res.type};base64,${res.b64}`;   // type reconnu dans le contenu, jamais celui annoncé
  }
  // test de la 1re photo, pour le bouton Diagnostic
  async function photoReport(raw) {
    if (!raw) return 'Aucune photo trouvée dans les adhésions (vérifiez « Nom du champ photo »)';
    const u = core.photoUrl(raw);
    if (!u) return { adresse: raw, resultat: 'Adresse refusée (serveur non HelloAsso ou non https)' };
    try {
      const res = await fetchPhoto(u);
      return { adresse: raw, http: res.status, typeAnnonce: res.contentType, typeReel: res.type || null, resultat: photoProblem(res) || 'OK' };
    } catch (e) { return { adresse: raw, resultat: 'Erreur : ' + (e.message || e) }; }
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
        case '/api/debug': {
          const d = await client.debug(loadConfig());
          return ok({ testPhoto: await photoReport(d.exemplesPhoto[0]), ...d });
        }
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
          document.querySelectorAll('img[data-photo]').forEach(i => {
            if (i.dataset.photo !== img.dataset.photo) return;
            if (d) i.src = d; else if (window.photoFailed) window.photoFailed(i);   // « ? » si la photo est inaccessible
          });
        }
      };
      await Promise.all([run(), run(), run(), run()]);
    },
    // ouvre la fenêtre d'impression d'Android (imprimante ou « Enregistrer au format PDF »)
    print: name => Printer.print({ name: String(name || 'Trombinoscope').slice(0, 80) }),
  };
})();
