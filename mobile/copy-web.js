// Prépare mobile/www à partir de ../public (la même page que l'appli ordinateur) :
// - ajoute capacitor.js (pont avec Android) avant les autres scripts ;
// - ajoute une politique de sécurité (CSP) : la page ne peut charger que ses propres fichiers.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'public');
const out = path.join(__dirname, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.copyFileSync(require.resolve('@capacitor/core/dist/capacitor.js'), path.join(out, 'capacitor.js'));

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";
const file = path.join(out, 'index.html');
let html = fs.readFileSync(file, 'utf8');
const marker = '<script src="core.js"></script>';
if (!html.includes(marker)) throw new Error('index.html : balise core.js introuvable');
html = html
  .replace(marker, '<script src="capacitor.js"></script>\n' + marker)
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
fs.writeFileSync(file, html);
console.log('www prêt :', fs.readdirSync(out).join(', '));
