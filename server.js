// Trombinoscope HelloAsso - serveur local (aucune dépendance externe, Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const IS_PKG = typeof process.pkg !== 'undefined';
const APP_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

// Mac (.app lancée depuis le Finder) : on relance le serveur en tâche de fond et on rend la main aussitôt.
// Sinon macOS considère l'appli « déjà ouverte » et un nouveau double-clic ne fait rien
// (l'ancienne instance n'est alors jamais remplacée et le navigateur ne se rouvre pas).
if (IS_PKG && process.platform === 'darwin' && !process.env.TROMBI_DETACHED && process.execPath.includes('.app/Contents/MacOS/')) {
  require('child_process').spawn(process.execPath, process.argv.slice(1), {
    detached: true, stdio: 'ignore', env: { ...process.env, TROMBI_DETACHED: '1' }
  }).unref();
  process.exit(0);
}
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
try { fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 }); } catch {}
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
// fichiers de données lisibles uniquement par l'utilisateur (Mac/Linux ; sous Windows, %APPDATA% est déjà privé)
function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}  // fichier déjà existant créé par une ancienne version
}
function saveConfig(c) {
  writePrivate(CONFIG_PATH, JSON.stringify({ ...DEFAULT_CONFIG, ...c }, null, 2));
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

// En-têtes de sécurité envoyés avec chaque réponse
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',     // le navigateur ne « devine » pas le type d'un fichier
  'X-Frame-Options': 'DENY',               // l'outil ne peut pas être affiché dans une page d'un autre site
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const MAX_BODY = 1024 * 1024;  // 1 Mo : largement assez pour les réglages et les listes
const readBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > MAX_BODY) { reject(new Error('Requête trop volumineuse')); req.destroy(); } });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});
async function readJson(req) {
  const b = await readBody(req);
  try { return JSON.parse(b); } catch { throw new Error('Requête invalide'); }
}

// Protection contre les autres sites ouverts dans le navigateur :
// - l'hôte doit être 127.0.0.1 ou localhost (bloque le « DNS rebinding », qui permettrait à un site de lire les données) ;
// - aucune requête venant d'un autre site (en-têtes Origin / Sec-Fetch-Site) n'est acceptée ;
// - les appels /api/* doivent porter l'en-tête X-Trombi, qu'un autre site ne peut pas ajouter (règles CORS du navigateur).
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
function rejectReason(req, pathname) {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return 'Hôte non autorisé';
  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) return 'Origine non autorisée';
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'Requête d\'un autre site refusée';
  // /api/photo est chargé par des balises <img> (pas d'en-tête possible) et ne modifie rien
  if (pathname.startsWith('/api/') && pathname !== '/api/photo' && req.headers['x-trombi'] !== '1') return 'En-tête manquant';
  return null;
}

// Photos : uniquement depuis les serveurs HelloAsso, et le jeton d'accès n'est envoyé qu'à l'API HelloAsso elle-même
const API_URL = new URL(API);
const PHOTO_HOSTS = new Set(['stockagehelloassoprod.blob.core.windows.net']);  // stockage de fichiers de HelloAsso (noms exacts)
function photoUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  const helloasso = u.protocol === 'https:' && !u.port
    && (h === 'helloasso.com' || h.endsWith('.helloasso.com') || PHOTO_HOSTS.has(h));
  return helloasso || u.origin === API_URL.origin ? u : null;   // (2e cas : API de test via HELLOASSO_API)
}
const MAX_PHOTO = 15 * 1024 * 1024;
async function fetchPhoto(u, cfg) {
  let r = await fetch(u);
  if (!r.ok && u.origin === API_URL.origin) {
    // le jeton n'accompagne que l'appel direct à l'API ; une éventuelle redirection est suivie sans lui
    r = await fetch(u, { headers: { Authorization: 'Bearer ' + await getToken(cfg) }, redirect: 'manual' });
    const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (loc) {
      const next = new URL(loc, u);
      if (next.protocol !== 'https:' && next.origin !== u.origin) throw new Error('Redirection refusée');
      r = await fetch(next);
    }
  }
  return r;
}

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);
const isStr = v => typeof v === 'string' && v.length <= 500;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const refused = rejectReason(req, url.pathname);
    if (refused) return send(res, 403, { error: refused });

    if (url.pathname === '/api/config' && req.method === 'GET') {
      const c = loadConfig();
      return send(res, 200, { ...c, clientSecret: c.clientSecret ? '********' : '' });
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const incoming = await readJson(req);
      const old = loadConfig(), next = { ...old };
      for (const k of CONFIG_KEYS) if (isStr(incoming[k])) next[k] = incoming[k];  // seulement les réglages connus
      if (incoming.clientSecret === '********') next.clientSecret = old.clientSecret;
      saveConfig(next);
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
        const { add = [], remove = [] } = await readJson(req);
        if (!Array.isArray(add) || !Array.isArray(remove)) throw new Error('Requête invalide');
        for (const m of add) {
          if (m && isStr(m.key)) h[m.key] = { firstName: isStr(m.firstName) ? m.firstName : '', lastName: isStr(m.lastName) ? m.lastName : '' };
        }
        for (const k of remove) if (isStr(k)) delete h[k];
        writePrivate(f, JSON.stringify(h));
      }
      return send(res, 200, h);
    }
    if (url.pathname === '/api/quit' && req.method === 'POST') {  // bouton Quitter, ou nouveau lancement qui remplace l'ancien
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
        const ids = await readJson(req);
        if (!Array.isArray(ids)) throw new Error('Requête invalide');
        writePrivate(f, JSON.stringify([...new Set([...read(), ...ids.filter(isStr)])]));
        return send(res, 200, { ok: true });
      }
      return send(res, 200, read());
    }
    if (url.pathname === '/api/debug') {  // 1er item brut, pour diagnostiquer les champs
      const items = await fetchItems(loadConfig());
      return send(res, 200, { total: items.length, premier: items[0] || null });
    }
    if (url.pathname === '/api/photo') {
      const u = photoUrl(url.searchParams.get('u') || '');
      if (!u) return send(res, 400, { error: 'URL refusée' });
      const r = await fetchPhoto(u, loadConfig());
      if (!r.ok) return send(res, 502, { error: 'Photo inaccessible (' + r.status + ')' });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      // on ne renvoie que de vraies images (jamais de HTML ou de SVG, qui pourraient contenir du script)
      if (!/^image\/(jpeg|png|gif|webp|heic|heif|avif|bmp)$/.test(type)) return send(res, 415, { error: 'Ce fichier n\'est pas une photo' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_PHOTO) return send(res, 413, { error: 'Photo trop volumineuse' });
      return send(res, 200, buf, type, { 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Introuvable' });
    // fichiers statiques (uniquement dans le dossier public)
    const root = path.join(__dirname, 'public');
    let file;
    try { file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); } catch { return send(res, 400, 'Requête invalide', 'text/plain'); }
    const full = path.resolve(root, file);
    if (!full.startsWith(root + path.sep)) return send(res, 403, 'Interdit', 'text/plain');
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      return send(res, 200, fs.readFileSync(full), MIME[ext] || 'application/octet-stream', ext === '.html' ? { 'Content-Security-Policy': PAGE_CSP } : {});
    }
    send(res, 404, 'Introuvable', 'text/plain');
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

// Ferme l'appli quand l'onglet est fermé : plus aucun signal de la page depuis 30 minutes
// (ou page jamais ouverte). Délai large : Safari et la mise en veille suspendent les signaux.
const IDLE_MS = 30 * 60000, STARTED = Date.now();
let lastPing = 0;
setInterval(() => { if (Date.now() - (lastPing || STARTED) > IDLE_MS) process.exit(0); }, 30000).unref();

const APP_URL = `http://127.0.0.1:${PORT}`;  // 127.0.0.1 plutôt que localhost (évite un essai en IPv6 ::1)
let retried = false;
function start() {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Trombinoscope prêt : ${APP_URL}  (fermez cette fenêtre pour quitter)`);
    openBrowser(APP_URL);
  });
}
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  if (retried) { openBrowser(APP_URL); return process.exit(0); }
  retried = true;  // une ancienne instance tourne : on la ferme puis on prend sa place
  try { await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST', headers: { 'X-Trombi': '1' } }); } catch {}
  setTimeout(start, 800);
});
start();
