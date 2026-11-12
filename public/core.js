// Trombinoscope HelloAsso - logique commune à l'appli ordinateur (server.js, Node) et à l'appli Android (mobile.js).
// Aucune dépendance : fonctionne dans Node (require) et dans la page (window.TrombiCore).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrombiCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_API = 'https://api.helloasso.com';

  const DEFAULT_CONFIG = {
    clientId: '',
    clientSecret: '',
    organizationSlug: '',
    formType: '',      // ex: Membership (vide = tous les formulaires de l'asso)
    formSlug: '',      // ex: adhesion-2025-2026 (vide = tous)
    photoField: '',    // nom du champ personnalisé contenant la photo (vide = détection auto)
    since: '',         // date AAAA-MM-JJ : ne garder que les adhésions depuis cette date
    amounts: '100, 110, 160, 170',   // montants payés (en €) à retenir ; vide = tous les montants
  };
  const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);
  const SECRET_MASK = '********';
  const isStr = v => typeof v === 'string' && v.length <= 500;

  // fusionne des réglages reçus avec les anciens : seules les clés connues, en texte ; le secret masqué est conservé
  function mergeConfig(old, incoming) {
    const next = { ...DEFAULT_CONFIG, ...old };
    for (const k of CONFIG_KEYS) if (incoming && isStr(incoming[k])) next[k] = incoming[k];
    if (incoming && incoming.clientSecret === SECRET_MASK) next.clientSecret = old.clientSecret || '';
    return next;
  }
  const publicConfig = c => ({ ...c, clientSecret: c.clientSecret ? SECRET_MASK : '' });

  // ---------- Photos ----------
  // Adresses acceptées : en https, sur un serveur HelloAsso (nom contenant « helloasso ») ou sur son stockage de fichiers.
  // La sécurité ne repose pas sur ce filtre : le jeton d'accès n'est envoyé qu'à l'API HelloAsso (voir isApiUrl),
  // et seules de vraies images, reconnues à leur contenu, sont renvoyées à la page.
  const PHOTO_HOSTS = ['stockagehelloassoprod.blob.core.windows.net'];
  function photoUrl(raw, api = DEFAULT_API) {
    let u;
    try { u = new URL(String(raw).trim()); } catch { return null; }
    if (u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    const helloasso = u.protocol === 'https:' && !u.port && (h.includes('helloasso') || PHOTO_HOSTS.includes(h));
    return helloasso || u.origin === new URL(api).origin ? u : null;   // (2e cas : API de test)
  }
  // type réel d'une image d'après ses premiers octets (l'étiquette envoyée par le serveur n'est pas fiable) ;
  // null si ce n'est pas une image connue (HTML, SVG, PDF… sont donc toujours refusés)
  function imageType(b) {
    if (!b || b.length < 12) return null;
    const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
    const str = (i, n) => String.fromCharCode(...Array.from(b.slice(i, i + n)));
    if (at(0, 0xFF, 0xD8, 0xFF)) return 'image/jpeg';
    if (at(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return 'image/png';
    if (str(0, 4) === 'GIF8') return 'image/gif';
    if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return 'image/webp';
    if (at(0, 0x42, 0x4D)) return 'image/bmp';
    if (str(4, 4) === 'ftyp') {
      const brand = str(8, 4);
      if (/^avi[fs]$/.test(brand)) return 'image/avif';
      if (/^(hei[cmsx]|hev[cmsx]|mif1|msf1)$/.test(brand)) return 'image/heic';
    }
    return null;
  }
  const MAX_PHOTO = 15 * 1024 * 1024;

  // ---------- Lecture des adhésions ----------
  const looksLikeUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

  function findPhoto(item, photoField) {
    const fields = item.customFields || [];
    if (photoField) {
      const f = fields.find(f => (f.name || '').toLowerCase().includes(photoField.toLowerCase()));
      return f && looksLikeUrl(f.answer) ? f.answer.trim() : null;
    }
    const f = fields.find(f => looksLikeUrl(f.answer) && (/file|fichier|photo/i.test(f.type || '') || /photo|image|portrait|selfie/i.test(f.name || '')))
      || fields.find(f => looksLikeUrl(f.answer));
    return f ? f.answer.trim() : null;
  }

  // minuscules, sans accents, tirets/espaces normalisés : sert à repérer les doublons de noms
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function campaignLabel(item) {
    const o = item.order || {};
    return o.formName || item.formName || o.formSlug || item.formSlug || item.name || '';
  }
  function toMember(item, cfg) {
    const u = item.user || {}, pay = item.payer || {};
    const first = (u.firstName || pay.firstName || '').trim();
    const last = (u.lastName || pay.lastName || '').trim();
    return {
      id: item.id,
      key: norm(first) + '|' + norm(last),
      firstName: first,
      lastName: last,
      date: (item.order && item.order.date) || null,
      photo: findPhoto(item, cfg.photoField),
    };
  }

  // transforme la liste brute HelloAsso en liste d'adhérents (filtres, doublons, tri)
  function buildMembers(items, cfg) {
    const alive = items.filter(i => i.state !== 'Canceled' && i.state !== 'Refunded' && i.state !== 'Refused' && i.type !== 'Donation');
    // formulaires présents sur HelloAsso (pour aider au diagnostic)
    const forms = {};
    for (const i of alive) { const l = campaignLabel(i) || '(sans nom)'; forms[l] = (forms[l] || 0) + 1; }
    // on ne garde que les adhésions (pas les dons ni les autres types d'articles)
    const kept = alive.filter(i => !i.type || i.type === 'Membership');
    // montant payé (HelloAsso donne les montants en centimes) : on ne garde que les montants demandés
    const wanted = String(cfg.amounts || '').split(/[;,\s]+/).map(Number).filter(n => n > 0);
    const euros = i => typeof i.amount === 'number' ? i.amount / 100 : null;
    const amounts = {};   // répartition des montants vus (pour aider à régler le filtre)
    for (const i of kept) { const e = euros(i); const k = e === null ? '(inconnu)' : e + ' €'; amounts[k] = (amounts[k] || 0) + 1; }
    const priced = wanted.length ? kept.filter(i => { const e = euros(i); return e !== null && wanted.some(w => Math.abs(w - e) < 0.005); }) : kept;
    let members = priced.map(i => toMember(i, cfg)).filter(m => m.firstName || m.lastName);
    if (cfg.since) members = members.filter(m => m.date && m.date.slice(0, 10) >= cfg.since);
    // doublons : une personne = une carte. Une adhésion AVEC photo l'emporte toujours sur une sans photo ;
    // à photo égale, la plus récente gagne.
    const better = (a, b) => (!!a.photo !== !!b.photo) ? !!a.photo : (a.date || '') > (b.date || '');
    const byKey = new Map();
    for (const m of members) {
      const prev = byKey.get(m.key);
      if (!prev || better(m, prev)) byKey.set(m.key, m);
    }
    const list = [...byKey.values()].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'));
    return { members: list, forms, amounts, total: alive.length, matched: kept.length, priced: priced.length };
  }

  // ---------- Client de l'API HelloAsso ----------
  // http(url, { method, headers, body }) doit renvoyer une promesse de { ok, status, json() } (comme fetch)
  function createClient({ http, api = DEFAULT_API }) {
    let token = null, tokenExp = 0;

    async function getToken(cfg) {
      if (token && Date.now() < tokenExp - 30000) return token;
      if (!cfg.clientId || !cfg.clientSecret) throw new Error('Identifiants API manquants (onglet Réglages).');
      const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' }).toString();
      const r = await http(api + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!r.ok) throw new Error('Authentification HelloAsso refusée (' + r.status + '). Vérifiez client_id / client_secret.');
      const j = await r.json();
      token = j.access_token;
      tokenExp = Date.now() + (j.expires_in || 1800) * 1000;
      return token;
    }

    async function apiGet(cfg, url) {
      const t = await getToken(cfg);
      const r = await http(url, { method: 'GET', headers: { Authorization: 'Bearer ' + t } });
      if (r.status === 401) token = null;
      if (!r.ok) throw new Error('API HelloAsso ' + r.status + ' sur ' + url.replace(api, ''));
      return r.json();
    }

    async function fetchItems(cfg) {
      if (!cfg.organizationSlug) throw new Error('Slug de l\'organisation manquant (onglet Réglages).');
      const e = encodeURIComponent, org = `${api}/v5/organizations/${e(cfg.organizationSlug)}`;
      const base = cfg.formType && cfg.formSlug ? `${org}/forms/${e(cfg.formType)}/${e(cfg.formSlug)}/items` : `${org}/items`;
      const all = [];
      let page = null;
      for (let i = 0; i < 200; i++) {
        const p = new URLSearchParams({ pageSize: '100', withDetails: 'true' });
        if (page) p.set('continuationToken', page);
        const j = await apiGet(cfg, base + '?' + p);
        all.push(...(j.data || []));
        page = j.pagination && j.pagination.continuationToken;
        if (!j.data || j.data.length === 0 || !page) break;
      }
      return all;
    }

    return {
      getToken,
      resetToken() { token = null; },
      async members(cfg) { return buildMembers(await fetchItems(cfg), cfg); },
      async test(cfg) {
        const o = await apiGet(cfg, `${api}/v5/organizations/${encodeURIComponent(cfg.organizationSlug)}`);
        return { ok: true, name: o.name || cfg.organizationSlug };
      },
      async debug(cfg) {
        const items = await fetchItems(cfg);
        const photos = items.map(i => findPhoto(i, cfg.photoField)).filter(Boolean);
        return { total: items.length, avecPhoto: photos.length, exemplesPhoto: photos.slice(0, 3), premier: items[0] || null };
      },
      // le jeton ne doit accompagner que les appels directs à l'API (jamais une photo hébergée ailleurs)
      isApiUrl: u => u.origin === new URL(api).origin,
    };
  }

  return { DEFAULT_API, DEFAULT_CONFIG, SECRET_MASK, isStr, mergeConfig, publicConfig, photoUrl, imageType, MAX_PHOTO, findPhoto, buildMembers, createClient };
});
