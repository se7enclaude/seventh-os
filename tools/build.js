#!/usr/bin/env node
/* Seventh OS — construit l'installateur Windows.
 *
 *   node tools/build.js        -> dist/release/SeventhOS-Setup-<version>.exe
 *
 * 1. dist/build/app : Electron (.electron, copie locale : node tools/extract-electron.js) renommé « Seventh OS.exe »
 *    + resources/app (main.js, package.json, apps.json, data/access.json, icône, ui) ;
 * 2. Inno Setup (installer.iss) -> l'installateur. Le même .exe sert de mise à jour (lancé en silencieux).
 * Version : package.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const B = path.join(OUT, 'build');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const ISCC = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe');
const mb = (n) => (n / 1e6).toFixed(1) + ' Mo';

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    return fs.readdirSync(src).reduce((n, f) => n + copy(path.join(src, f), path.join(dst, f)), 0);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return st.size;
}

fs.rmSync(B, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'release'), { recursive: true });

const APP = path.join(B, 'app');
const ELECTRON = path.join(ROOT, '.electron');
if (!fs.existsSync(path.join(ELECTRON, 'electron.exe'))) { console.error('Electron absent : node tools/extract-electron.js'); process.exit(1); }
copy(ELECTRON, APP);
fs.renameSync(path.join(APP, 'electron.exe'), path.join(APP, 'Seventh OS.exe'));
fs.rmSync(path.join(APP, 'resources', 'default_app.asar'), { force: true });
const ico = cp.spawnSync('python', [path.join(__dirname, 'set_exe_icon.py'), path.join(APP, 'Seventh OS.exe'), path.join(ROOT, 'build', 'icon.ico')], { stdio: 'inherit' });
if (ico.status !== 0) { console.error('Icône du .exe : échec'); process.exit(1); }

// le hub : tout sauf les outils de développement
const RES = path.join(APP, 'resources', 'app');
let size = 0;
for (const f of ['main.js', 'package.json', 'apps.json', 'data/access.json', 'build/icon.ico', 'ui']) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error('absent : ' + f); process.exit(1); }
  size += copy(src, path.join(RES, f));
}
// le catalogue livré doit être lisible, l'enveloppe d'accès complète
JSON.parse(fs.readFileSync(path.join(RES, 'apps.json'), 'utf8'));
if (!JSON.parse(fs.readFileSync(path.join(RES, 'data', 'access.json'), 'utf8')).ct) { console.error('data/access.json invalide'); process.exit(1); }
console.log('Hub : ' + mb(size) + ' + Electron');

if (!fs.existsSync(ISCC)) { console.error('Inno Setup absent : ' + ISCC); process.exit(1); }
const iss = cp.spawnSync(ISCC, ['/Q', '/DAppVersion=' + VERSION, '/DStage=' + B, '/O' + path.join(OUT, 'release'), path.join(ROOT, 'installer.iss')], { stdio: 'inherit' });
if (iss.status !== 0) { console.error('Échec d\'Inno Setup'); process.exit(1); }
const exe = path.join(OUT, 'release', 'SeventhOS-Setup-' + VERSION + '.exe');
console.log('Installateur : ' + exe + ' (' + mb(fs.statSync(exe).size) + ')');
