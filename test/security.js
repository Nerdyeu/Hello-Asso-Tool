// Tests de sécurité du serveur local avec une fausse API HelloAsso.
// Usage : npm test
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const serverJs = path.resolve(__dirname, '..', 'server.js');
const MOCK = 4848, APP = 'http://127.0.0.1:3737';
const seenAuth = [];
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
// autre serveur (pas l'API) : ne doit jamais recevoir le jeton, même via une redirection de l'API
const OTHER = 4849, otherAuth = [];
const other = http.createServer((req, res) => { otherAuth.push(req.headers.authorization || ''); res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(JPG); });

const mock = http.createServer((req, res) => {
  seenAuth.push([req.url, req.headers.authorization || '']);
  if (req.url === '/oauth2/token') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'SECRET-TOKEN', expires_in: 1800 })); }
  if (req.url.startsWith('/v5/organizations/asso/items')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 1, type: 'Membership', amount: 10000, state: 'Processed', user: { firstName: 'Ana', lastName: 'Test' }, order: { date: '2026-01-01' },
      customFields: [{ name: 'Photo', type: 'File', answer: `http://127.0.0.1:${MOCK}/photo.png` }] }], pagination: {} }));
  }
  if (req.url === '/photo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  if (req.url === '/private.png') {   // photo protégée : exige le jeton
    if (req.headers.authorization !== 'Bearer SECRET-TOKEN') { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG);
  }
  if (req.url === '/octet.jpg') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(JPG); }
  if (req.url === '/fake.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end('<html><script>alert(1)</script></html>'); }
  if (req.url === '/semi.jpg') {   // sans jeton : page « non autorisé » en 200 ; avec jeton : la photo (étiquetée image/jpg)
    if (req.headers.authorization !== 'Bearer SECRET-TOKEN') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>connexion requise</html>'); }
    res.writeHead(200, { 'Content-Type': 'image/jpg' }); return res.end(JPG);
  }
  if (req.url === '/redir.jpg') {  // l'API redirige vers un autre serveur
    if (req.headers.authorization !== 'Bearer SECRET-TOKEN') { res.writeHead(401); return res.end(); }
    res.writeHead(302, { Location: `http://127.0.0.1:${OTHER}/x.jpg` }); return res.end();
  }
  if (req.url === '/evil.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<script>alert(1)</script>'); }
  res.writeHead(404); res.end();
});

const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${info ? ' — ' + info : ''}`);
const H = { 'X-Trombi': '1' };
const get = (p, headers = H, method = 'GET', body) => fetch(APP + p, { method, headers, body });
// requête brute pour forcer un en-tête Host (fetch l'interdit)
const raw = (p, host) => new Promise(r => http.get({ host: '127.0.0.1', port: 3737, path: p, headers: { Host: host, 'X-Trombi': '1' } }, res => { res.resume(); r(res.statusCode); }));

(async () => {
  await new Promise(r => mock.listen(MOCK, '127.0.0.1', r));
  await new Promise(r => other.listen(OTHER, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trombi-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ clientId: 'id', clientSecret: 'sec', organizationSlug: 'asso' }));
  const child = spawn(process.execPath, ['-e', `require('child_process').exec=()=>{}; require(${JSON.stringify(serverJs)})`],
    { env: { ...process.env, TROMBI_DATA_DIR: dir, HELLOASSO_API: `http://127.0.0.1:${MOCK}` }, stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 1500));
  try {
    let r = await get('/api/members');
    const j = await r.json();
    check('page légitime : liste des adhérents', r.status === 200 && j.members.length === 1, `${r.status}`);
    check('sans en-tête X-Trombi : refusé', (await get('/api/members', {})).status === 403);
    check('Origin d\'un autre site : refusé', (await get('/api/members', { ...H, Origin: 'https://evil.example' })).status === 403);
    check('Sec-Fetch-Site cross-site : refusé', (await get('/api/photo?u=x', { 'Sec-Fetch-Site': 'cross-site' })).status === 403);
    check('Host étranger (DNS rebinding) : refusé', (await raw('/api/members', 'evil.example:3737')) === 403);
    check('Host étranger sur la page : refusé', (await raw('/', 'evil.example:3737')) === 403);
    check('/api/quit en GET : sans effet', (await get('/api/quit')).status === 404);
    const ph = (u, h = {}) => get('/api/photo?u=' + encodeURIComponent(u), h);
    check('photo hors HelloAsso : refusée', (await ph('https://evil.example/x.png')).status === 400);
    check('photo en http://xx.helloasso.com : refusée', (await ph('http://cdn.helloasso.com/x.png')).status === 400);
    check('photo avec identifiants dans l\'URL : refusée', (await ph('https://a:b@cdn.helloasso.com/x.png')).status === 400);
    r = await ph(`http://127.0.0.1:${MOCK}/photo.png`);
    check('photo légitime (API) : servie', r.status === 200 && r.headers.get('content-type') === 'image/png');
    r = await ph(`http://127.0.0.1:${MOCK}/private.png`);
    check('photo protégée : servie avec le jeton', r.status === 200);
    check('HTML déguisé en photo : refusé', (await ph(`http://127.0.0.1:${MOCK}/evil.html`)).status === 415);
    check('HTML étiqueté image/png : refusé', (await ph(`http://127.0.0.1:${MOCK}/fake.png`)).status === 415);
    r = await ph(`http://127.0.0.1:${MOCK}/octet.jpg`);
    check('JPEG étiqueté octet-stream : servi en image/jpeg', r.status === 200 && r.headers.get('content-type') === 'image/jpeg');
    r = await ph(`http://127.0.0.1:${MOCK}/semi.jpg`);
    check('page « non autorisé » en 200 : nouvel essai avec jeton', r.status === 200 && r.headers.get('content-type') === 'image/jpeg');
    await ph(`http://127.0.0.1:${MOCK}/redir.jpg`);
    check('redirection de l\'API : jeton jamais transmis à l\'autre serveur', otherAuth.every(a => !a), JSON.stringify(otherAuth));
    const dbg = await (await get('/api/debug')).json();
    check('Diagnostic : test de la 1re photo', !!dbg.testPhoto && dbg.testPhoto.resultat === 'OK' && dbg.avecPhoto === 1, JSON.stringify(dbg.testPhoto));
    check('traversée de dossier : refusée', [403, 404].includes((await get('/..%2fserver.js', {})).status));
    check('traversée encodée : refusée', [403, 404].includes((await get('/%2e%2e/%2e%2e/server.js', {})).status));
    await get('/api/config', H, 'POST', JSON.stringify({ clientSecret: '********', organizationSlug: 'asso', evil: 'x', since: { a: 1 } }));
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    check('réglages : clé inconnue ignorée, secret conservé', !('evil' in cfg) && cfg.clientSecret === 'sec' && cfg.since === '');
    check('réglages : secret masqué en lecture', (await (await get('/api/config')).json()).clientSecret === '********');
    check('JSON invalide : erreur propre', (await get('/api/hidden', H, 'POST', '{oops')).status === 500);
    check('corps énorme : refusé', await get('/api/printed', H, 'POST', 'x'.repeat(2 * 1024 * 1024)).then(x => x.status === 500, () => true));
    r = await get('/', {});
    check('page : en-têtes de sécurité', r.headers.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(r.headers.get('content-security-policy') || ''));
    const core = require(path.resolve(__dirname, '..', 'public', 'core.js'));
    const tok = s => core.tokenAllowed(new URL(s));
    check('jeton autorisé vers les serveurs HelloAsso', tok('https://api.helloasso.com/v5/x') && tok('https://www.helloasso.com/a.jpg') && tok('https://helloasso.com/a.jpg'));
    check('jeton refusé vers les faux domaines', !tok('https://helloasso.evil.com/a.jpg') && !tok('https://evilhelloasso.com/a.jpg')
      && !tok('https://helloasso.com.evil.com/a.jpg') && !tok('http://www.helloasso.com/a.jpg') && !tok('https://www.helloasso.com:8443/a.jpg')
      && !tok('https://stockagehelloassoprod.blob.core.windows.net/a.jpg'));
    check('SVG jamais accepté comme photo', core.photoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml') === null
      && core.photoType(Buffer.from('<html></html>'), 'image/png') === null && core.photoType(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'image/tiff') === 'image/tiff');
    const leaked = seenAuth.filter(([u, a]) => a && ['/photo.png', '/octet.jpg'].includes(u));
    check('photos publiques : téléchargées sans jeton', leaked.length === 0, JSON.stringify(leaked));
    check('/api/quit en POST : ferme l\'appli', (await get('/api/quit', H, 'POST')).status === 200);
  } finally {
    setTimeout(() => { child.kill(); mock.close(); other.close(); console.log(results.join('\n')); process.exit(results.some(l => l.startsWith('ÉCHEC')) ? 1 : 0); }, 500);
  }
})();
