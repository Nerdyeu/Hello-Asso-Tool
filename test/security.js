// Tests de sécurité du serveur local avec une fausse API HelloAsso.
// Usage : npm test
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const serverJs = path.resolve(__dirname, '..', 'server.js');
const MOCK = 4848, APP = 'http://127.0.0.1:3737';
const seenAuth = [];
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

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
    check('photo d\'un faux domaine helloasso.evil.com : refusée', (await ph('https://helloasso.evil.com/x.png')).status === 400);
    check('photo evilhelloasso.com : refusée', (await ph('https://evilhelloasso.com/x.png')).status === 400);
    check('photo en http://xx.helloasso.com : refusée', (await ph('http://cdn.helloasso.com/x.png')).status === 400);
    check('photo avec identifiants dans l\'URL : refusée', (await ph('https://a:b@cdn.helloasso.com/x.png')).status === 400);
    r = await ph(`http://127.0.0.1:${MOCK}/photo.png`);
    check('photo légitime (API) : servie', r.status === 200 && r.headers.get('content-type') === 'image/png');
    r = await ph(`http://127.0.0.1:${MOCK}/private.png`);
    check('photo protégée : servie avec le jeton', r.status === 200);
    check('HTML déguisé en photo : refusé', (await ph(`http://127.0.0.1:${MOCK}/evil.html`)).status === 415);
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
    const leaked = seenAuth.filter(([u, a]) => a && u !== '/oauth2/token' && !u.startsWith('/v5/') && u !== '/private.png');
    check('jeton jamais envoyé ailleurs qu\'à l\'API', leaked.length === 0, JSON.stringify(leaked));
    check('/api/quit en POST : ferme l\'appli', (await get('/api/quit', H, 'POST')).status === 200);
  } finally {
    setTimeout(() => { child.kill(); mock.close(); console.log(results.join('\n')); process.exit(results.some(l => l.startsWith('ÉCHEC')) ? 1 : 0); }, 500);
  }
})();
