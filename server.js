// Trombinoscope HelloAsso - serveur local (aucune dépendance externe, Node >= 18)
// La logique HelloAsso (lecture des adhésions, filtres, doublons) est dans public/core.js, partagée avec l'appli Android.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const core = require('./public/core.js');

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
const API = process.env.HELLOASSO_API || core.DEFAULT_API;  // surchargeable pour les tests
const client = core.createClient({ http: (url, opts) => fetch(url, opts), api: API });

function loadConfig() {
  try { return { ...core.DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...core.DEFAULT_CONFIG }; }
}
// fichiers de données lisibles uniquement par l'utilisateur (Mac/Linux ; sous Windows, %APPDATA% est déjà privé)
function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}  // fichier déjà existant créé par une ancienne version
}
const saveConfig = c => writePrivate(CONFIG_PATH, JSON.stringify(c, null, 2));

// ---------- Serveur HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

// En-têtes de sécurité envoyés avec chaque réponse
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',     // le navigateur ne « devine » pas le type d'un fichier
  'X-Frame-Options': 'DENY',               // l'outil ne peut pas être affiché dans une page d'un autre site
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
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

// Photos : téléchargement, puis vérification que c'est bien une image (d'après son contenu)
async function getImage(u, headers = {}, redirect = 'follow') {
  const r = await fetch(u, { headers, redirect });
  const info = { status: r.status, contentType: r.headers.get('content-type') || '' };
  if (r.status >= 300 && r.status < 400) return { ...info, location: r.headers.get('location') };
  if (!r.ok) return info;
  if (Number(r.headers.get('content-length') || 0) > core.MAX_PHOTO) return { ...info, tooBig: true };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > core.MAX_PHOTO) return { ...info, tooBig: true };
  return { ...info, buf, type: core.photoType(buf, info.contentType) };
}
// 1er essai sans jeton (photo publique). Sinon, nouvel essai avec le jeton, comme en v1.3.0, mais uniquement vers
// les serveurs de HelloAsso (core.tokenAllowed) : chaque redirection est suivie à la main et le jeton n'est
// transmis à l'étape suivante que si elle est elle aussi chez HelloAsso.
async function fetchPhoto(u, cfg) {
  const res = await getImage(u);
  if (res.type || !client.tokenAllowed(u)) return res;
  const auth = { Authorization: 'Bearer ' + await client.getToken(cfg) };
  let url = u;
  for (let i = 0; i < 5; i++) {
    const r = await getImage(url, client.tokenAllowed(url) ? auth : {}, 'manual');
    if (!r.location) return r;
    const next = new URL(r.location, url);
    if (next.protocol !== 'https:' && next.origin !== url.origin) throw new Error('Redirection refusée');
    url = next;
  }
  throw new Error('Trop de redirections');
}
const photoProblem = res => res.tooBig ? 'Photo trop volumineuse'
  : res.status < 200 || res.status >= 300 ? `Photo inaccessible (HTTP ${res.status})`
  : !res.type ? `Ce fichier n'est pas une image reconnue (type annoncé : ${res.contentType || 'aucun'})` : null;

// test de la 1re photo, pour le bouton Diagnostic
async function photoReport(cfg, raw) {
  if (!raw) return 'Aucune photo trouvée dans les adhésions (vérifiez « Nom du champ photo »)';
  const u = core.photoUrl(raw, API);
  if (!u) return { adresse: raw, resultat: 'Adresse refusée (serveur non HelloAsso ou non https)' };
  try {
    const res = await fetchPhoto(u, cfg);
    return { adresse: raw, http: res.status, typeAnnonce: res.contentType, typeReel: res.type || null, resultat: photoProblem(res) || 'OK' };
  } catch (e) { return { adresse: raw, resultat: 'Erreur : ' + e.message }; }
}

const isStr = core.isStr;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const refused = rejectReason(req, url.pathname);
    if (refused) return send(res, 403, { error: refused });

    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, core.publicConfig(loadConfig()));
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      saveConfig(core.mergeConfig(loadConfig(), await readJson(req)));  // seulement les réglages connus
      client.resetToken();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/members') {
      return send(res, 200, await client.members(loadConfig()));
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
      return send(res, 200, await client.test(loadConfig()));
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
      const cfg = loadConfig(), d = await client.debug(cfg);
      return send(res, 200, { testPhoto: await photoReport(cfg, d.exemplesPhoto[0]), ...d });
    }
    if (url.pathname === '/api/photo') {
      const u = core.photoUrl(url.searchParams.get('u') || '', API);
      if (!u) return send(res, 400, { error: 'URL refusée' });
      const r = await fetchPhoto(u, loadConfig());
      const problem = photoProblem(r);
      if (problem) return send(res, r.tooBig ? 413 : r.status >= 200 && r.status < 300 ? 415 : 502, { error: problem });
      // le type envoyé à la page est celui reconnu dans le contenu, jamais celui annoncé par le serveur distant
      return send(res, 200, r.buf, r.type, { 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" });
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
