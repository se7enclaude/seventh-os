// Extrait Electron (zip déjà présent dans le cache d'Electron de ce PC) dans .electron : rien n'est téléchargé.
const fs = require('fs');
const path = require('path');
const Z = require('./unzip.js');
const VER = process.argv[2] || '44.5.1';
const cache = path.join(process.env.LOCALAPPDATA, 'electron', 'Cache');
const zip = fs.readdirSync(cache).map(d => path.join(cache, d, 'electron-v' + VER + '-win32-x64.zip')).find(f => fs.existsSync(f));
if (!zip) { console.error('electron-v' + VER + '-win32-x64.zip introuvable dans ' + cache); process.exit(1); }
const dest = path.join(__dirname, '..', '.electron');
fs.rmSync(dest, { recursive: true, force: true });
Z.extract(zip, dest).then(r => console.log(r.files + ' fichiers -> ' + dest));
