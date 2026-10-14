#!/usr/bin/env node
/* Seventh OS — publication sur le dépôt public se7enclaude/seventh-os, avec gh (connecté au compte du dépôt).
 *
 *   node tools/release.js publish "notes"   release « v<version> » (la « latest ») : SeventhOS-Setup-<v>.exe + latest.json
 *
 * latest.json : { version, notes, published, update: { name, sha256, size } } — lu par le hub pour se mettre à jour.
 * La liste des applis (apps.json) n'a pas besoin de nouvelle version : le hub la relit sur la branche main du dépôt.
 * Ordre : version dans package.json -> node tools/build.js -> publish ; pousser le code (apps.json compris). */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const REL = path.join(ROOT, 'dist', 'release');
const REPO = 'se7enclaude/seventh-os';
const GH = process.env.GH || [path.join(ROOT, '..', 'se7en - download', 'build', 'tools', 'gh', 'bin', 'gh.exe'), 'gh'].find(p => p === 'gh' || fs.existsSync(p));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function gh(args) {
  const r = cp.spawnSync(GH, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('gh ' + args.slice(0, 3).join(' ') + ' : ' + (r.stderr || r.stdout || '').trim());
  return r.stdout;
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const [cmd, notes] = process.argv.slice(2);
if (cmd === 'publish') {
  const exe = path.join(REL, 'SeventhOS-Setup-' + VERSION + '.exe');
  if (!fs.existsSync(exe)) throw new Error('installateur absent : node tools/build.js');
  const latest = { version: VERSION, notes: notes || '', published: new Date().toISOString().slice(0, 10), update: { name: path.basename(exe), sha256: sha256(exe), size: fs.statSync(exe).size } };
  const lj = path.join(REL, 'latest.json');
  fs.writeFileSync(lj, JSON.stringify(latest, null, 1) + '\n', 'utf8');
  const tag = 'v' + VERSION;
  let exists = true;
  try { gh(['release', 'view', tag, '-R', REPO, '--json', 'tagName']); } catch (e) { exists = false; }
  if (exists) {
    gh(['release', 'upload', tag, exe, lj, '-R', REPO, '--clobber']);
    console.log('Republié : ' + tag);
  } else {
    gh(['release', 'create', tag, exe, lj, '-R', REPO, '--title', 'Seventh OS ' + VERSION, '--notes', (notes || '') + '\n\nInstallation : lance ' + path.basename(exe) + ', puis entre ton code d\'accès.', '--latest']);
    console.log('Publié : ' + tag);
  }
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
}
