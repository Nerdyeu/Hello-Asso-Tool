// Trombinoscope HelloAsso - serveur local (aucune dépendance externe, Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const IS_PKG = typeof process.pkg !== 'undefined';
const APP_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;
// Les réglages sont stockés dans %APPDATA% : conservés même si l'exe est remplacé ou déplacé
const os = require('os');
const DATA_ROOT = process.platform === 'win32' ? (process.env.APPDATA || APP_DIR)
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
  : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
const DATA_DIR = process.env.TROMBI_DATA_DIR || path.join(DATA_ROOT, 'Trombinoscope-HelloAsso');  // variable : tests uniquement
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const PORT = 3737;
const API = process.env.HELLOASSO_API || 'https://api.helloasso.com';  // surchargeable pour les tests

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

function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(c) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...DEFAULT_CONFIG, ...c }, null, 2));
}

// ---------- OAuth2 ----------
let token = null, tokenExp = 0;
async function getToken(cfg) {
  if (token && Date.now() < tokenExp - 30000) return token;
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('Identifiants API manquants (onglet Réglages).');
  const r = await fetch(API + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' })
  });
  if (!r.ok) throw new Error('Authentification HelloAsso refusée (' + r.status + '). Vérifiez client_id / client_secret.');
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + (j.expires_in || 1800) * 1000;
  return token;
}

async function apiGet(cfg, url) {
  const t = await getToken(cfg);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 401) { token = null; }
  if (!r.ok) throw new Error('API HelloAsso ' + r.status + ' sur ' + url.replace(API, ''));
  return r.json();
}

// ---------- Récupération des adhérents ----------
async function fetchItems(cfg) {
  if (!cfg.organizationSlug) throw new Error('Slug de l\'organisation manquant (onglet Réglages).');
  const base = cfg.formType && cfg.formSlug
    ? `${API}/v5/organizations/${cfg.organizationSlug}/forms/${cfg.formType}/${cfg.formSlug}/items`
    : `${API}/v5/organizations/${cfg.organizationSlug}/items`;
  const all = [];
  let tokenPage = null;
  for (let i = 0; i < 200; i++) {
    const p = new URLSearchParams({ pageSize: '100', withDetails: 'true' });
    if (tokenPage) p.set('continuationToken', tokenPage);
    const j = await apiGet(cfg, base + '?' + p);
    all.push(...(j.data || []));
    tokenPage = j.pagination && j.pagination.continuationToken;
    if (!j.data || j.data.length === 0 || !tokenPage) break;
  }
  return all;
}

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
    campaign: campaignLabel(item)
  };
}

async function getMembers(cfg) {
  const items = await fetchItems(cfg);
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

// ---------- Serveur HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/config' && req.method === 'GET') {
      const c = loadConfig();
      return send(res, 200, { ...c, clientSecret: c.clientSecret ? '********' : '' });
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const incoming = JSON.parse(await readBody(req));
      const old = loadConfig();
      if (incoming.clientSecret === '********') incoming.clientSecret = old.clientSecret;
      saveConfig({ ...old, ...incoming });
      token = null;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/members') {
      return send(res, 200, await getMembers(loadConfig()));
    }
    if (url.pathname === '/api/ping') {  // la page signale qu'elle est ouverte ; sans signal, l'appli se ferme seule
      lastPing = Date.now();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/hidden') {  // adhérents retirés du trombinoscope (local uniquement, rien n'est supprimé chez HelloAsso)
      const f = path.join(DATA_DIR, 'hidden.json');
      let h = {};
      try { h = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      if (req.method === 'POST') {
        const { add = [], remove = [] } = JSON.parse(await readBody(req));
        for (const m of add) h[m.key] = { firstName: m.firstName, lastName: m.lastName };
        for (const k of remove) delete h[k];
        fs.writeFileSync(f, JSON.stringify(h));
      }
      return send(res, 200, h);
    }
    if (url.pathname === '/api/quit') {  // permet à un nouveau lancement de remplacer l'ancien
      send(res, 200, { ok: true });
      return setTimeout(() => process.exit(0), 200);
    }
    if (url.pathname === '/api/test') {  // vérifie identifiants + slug
      const cfg = loadConfig();
      const o = await apiGet(cfg, `${API}/v5/organizations/${encodeURIComponent(cfg.organizationSlug)}`);
      return send(res, 200, { ok: true, name: o.name || cfg.organizationSlug });
    }
    if (url.pathname === '/api/printed') {  // mémoire des adhérents déjà imprimés
      const f = path.join(DATA_DIR, 'printed.json');
      const read = () => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
      if (req.method === 'POST') {
        const ids = JSON.parse(await readBody(req));
        fs.writeFileSync(f, JSON.stringify([...new Set([...read(), ...ids])]));
        return send(res, 200, { ok: true });
      }
      return send(res, 200, read());
    }
    if (url.pathname === '/api/debug') {  // 1er item brut, pour diagnostiquer les champs
      const items = await fetchItems(loadConfig());
      return send(res, 200, { total: items.length, premier: items[0] || null });
    }
    if (url.pathname === '/api/photo') {
      const target = url.searchParams.get('u');
      if (!target || !/^https:\/\/[^/]*helloasso[^/]*\//i.test(target)) return send(res, 400, { error: 'URL refusée' });
      const cfg = loadConfig();
      let r = await fetch(target);
      if (!r.ok) r = await fetch(target, { headers: { Authorization: 'Bearer ' + await getToken(cfg) } });
      if (!r.ok) return send(res, 502, { error: 'Photo inaccessible (' + r.status + ')' });
      res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'max-age=3600' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    // fichiers statiques
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'Interdit', 'text/plain');
    if (fs.existsSync(full)) return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
    send(res, 404, 'Introuvable', 'text/plain');
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// Ferme l'appli quand l'onglet est fermé (plus de signal depuis 3 minutes)
let lastPing = 0;
setInterval(() => { if (lastPing && Date.now() - lastPing > 180000) process.exit(0); }, 15000).unref();

let retried = false;
function start() {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Trombinoscope prêt : http://localhost:${PORT}  (fermez cette fenêtre pour quitter)`);
    openBrowser(`http://localhost:${PORT}`);
  });
}
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  if (retried) { openBrowser(`http://localhost:${PORT}`); return process.exit(0); }
  retried = true;  // une ancienne instance tourne : on la ferme puis on prend sa place
  try { await fetch(`http://127.0.0.1:${PORT}/api/quit`); } catch {}
  setTimeout(start, 800);
});
start();
