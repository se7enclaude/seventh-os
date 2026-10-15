/* Seventh OS — l'interface : code d'accès, bibliothèque des applis, fiche, installer / ouvrir / mettre à jour / désinstaller. */
'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const A = window.S7Access, O = window.OSApps, N = window.S7Net;

const VERSION = ipcRenderer.sendSync('os:version');
const PATHS = ipcRenderer.sendSync('os:paths');
const $ = (s, el) => (el || document).querySelector(s);
const state = { apps: [], st: {}, latest: {}, err: {}, busy: {}, online: false, hub: null };

// ------------------------------------------------------------------ petits outils
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
// notes de version (Markdown simple des releases) -> éléments, sans jamais injecter de HTML
function inline(text) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map(p =>
    p.startsWith('**') ? h('b', {}, p.slice(2, -2)) : p.startsWith('`') ? h('code', {}, p.slice(1, -1)) : p);
}
function md(text) {
  const out = [];
  let list = null;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    const item = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) { if (!list) { list = h('ul', {}); out.push(list); } list.append(h('li', {}, inline(item[1]))); continue; }
    list = null;
    if (!l) continue;
    const head = l.match(/^#{1,6}\s+(.*)$/);
    out.push(head ? h('h5', {}, inline(head[1])) : h('p', {}, inline(l)));
  }
  return out;
}
const size = (n) => !n ? '' : n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' Go' : Math.round(n / 1e6) + ' Mo';
function toast(msg, err) {
  const t = h('div', { class: 'toast glass' + (err ? ' err' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), err ? 9000 : 5000);
}
// icône d'une appli : celle du dépôt (icons/<id>.png sur main) gagne sur celle livrée avec le hub,
// pour qu'un nouveau logo arrive sans nouvelle version de Seventh OS
function iconOf(app) {
  const cached = path.join(PATHS.data, 'icons', app.id + '.png');
  if (fs.existsSync(cached)) return 'data:image/png;base64,' + fs.readFileSync(cached).toString('base64');
  const local = path.join(PATHS.root, 'ui', 'icons', app.id + '.png');
  if (fs.existsSync(local)) return 'icons/' + app.id + '.png';
  return 'icons/seventh-os.png';
}
// revalidée à chaque lancement (ETag) : retéléchargée seulement si elle a changé sur main
async function fetchIcon(app) {
  const f = path.join(PATHS.data, 'icons', app.id + '.png');
  try { if (await N.fetchTo('https://raw.githubusercontent.com/se7enclaude/seventh-os/main/ui/icons/' + encodeURIComponent(app.id) + '.png', f, { etagFile: f + '.etag' })) render(); } catch (e) { /* icône en cache ou livrée */ }
}

// ------------------------------------------------------------------ code d'accès
function showLock() {
  $('#hub').hidden = true;
  $('#lock').hidden = false;
  setTimeout(() => $('#lock-code').focus(), 50);
}
$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#lock-code').value;
  if (!code.trim()) return;
  const b = $('#lock-form button');
  b.disabled = true;
  $('#lock-msg').textContent = 'Vérification…';
  try {
    const r = await A.unlock(PATHS.root, code);
    if (!r.ok) { $('#lock-msg').textContent = r.message; return; }
    $('#lock-msg').textContent = '';
    $('#lock').hidden = true;
    start();
  } catch (err) {
    $('#lock-msg').textContent = 'Impossible de vérifier le code : ' + err.message;
  } finally { b.disabled = false; }
});

// ------------------------------------------------------------------ données
async function refreshApp(app) {
  try { state.st[app.id] = await O.installed(app); } catch (e) { state.st[app.id] = { installed: false }; }
  render();
  try { state.latest[app.id] = await O.latest(app); delete state.err[app.id]; }
  catch (e) { state.err[app.id] = e.status === 401 || e.status === 403 ? 'accès refusé (code à refaire ?)' : (e.why === 'locked' ? 'code d\'accès nécessaire' : 'hors ligne'); }
  render();
}
async function load() {
  setStatus('wait', 'Connexion…');
  const c = await O.catalog(PATHS.catalog);
  state.apps = c.apps;
  state.online = c.online;
  render();
  await Promise.all(state.apps.map(a => refreshApp(a)));
  state.apps.forEach(fetchIcon);
  const n = Object.keys(state.err).length;
  setStatus(n === state.apps.length && n ? 'off' : 'ok', n === state.apps.length && n ? 'Hors ligne · versions installées seulement' : 'En ligne · ' + state.apps.length + ' applis');
  checkHub();
}
function setStatus(kind, txt) {
  const s = $('#status');
  s.className = 'status glass ' + kind;
  $('.txt', s).textContent = txt;
}

// ------------------------------------------------------------------ état d'une appli
function view(app) {
  const st = state.st[app.id], l = state.latest[app.id], busy = state.busy[app.id];
  const v = { st, l, busy, installed: !!(st && st.installed), update: false, chip: '', chipKind: '' };
  if (!st) { v.chip = 'Vérification…'; return v; }
  if (v.installed) {
    // Installée sous un ancien nom : toujours à mettre à jour (même version), pour passer au nouveau nom.
    v.update = !!(l && l.version && st.version && (O.newer(l.version, st.version) || (st.formerName && l.asset)));
    v.chip = v.update ? (st.formerName ? 'Nouveau nom · mise à jour ' + l.version : 'Mise à jour ' + l.version + ' disponible') : 'Installée · ' + (st.version || '?');
    v.chipKind = v.update ? 'up' : 'ok';
  } else {
    v.chip = l ? 'Pas installée · ' + l.version + (l.size ? ' · ' + size(l.size) : '') : (state.err[app.id] ? 'Pas installée · ' + state.err[app.id] : 'Pas installée');
    v.chipKind = state.err[app.id] && !l ? 'err' : '';
  }
  return v;
}
function busyBox(busy) {
  const pct = busy.total ? Math.round(busy.done / busy.total * 100) : null;
  const txt = busy.phase === 'download' ? 'Téléchargement' + (pct != null ? ' · ' + pct + ' % · ' + size(busy.done) + ' / ' + size(busy.total) : '…')
    : busy.phase === 'install' ? 'Installation…' : busy.phase === 'uninstall' ? 'Désinstallation…' : 'Préparation…';
  return h('div', {}, h('div', { class: 'progress' + (pct == null ? ' indet' : '') }, h('i', { style: pct != null ? 'width:' + pct + '%' : null })), h('div', { class: 'busy-txt' }, txt));
}
function mainButton(app, v) {
  if (v.busy) return null;
  if (v.installed && v.update) return h('button', { class: 'btn update', onclick: (e) => { e.stopPropagation(); doInstall(app); } }, 'Mettre à jour');
  if (v.installed) return h('button', { class: 'btn primary', onclick: (e) => { e.stopPropagation(); doOpen(app); } }, 'Ouvrir');
  return h('button', { class: 'btn primary', disabled: !(v.l && v.l.asset), onclick: (e) => { e.stopPropagation(); doInstall(app); } }, 'Installer');
}

// ------------------------------------------------------------------ rendu
function render() {
  const grid = $('#grid');
  grid.replaceChildren(...state.apps.map(app => {
    const v = view(app);
    return h('article', { class: 'card glass', onclick: () => openSheet(app) },
      h('div', { class: 'card-head' },
        h('img', { class: 'app-icon', src: iconOf(app), alt: '' }),
        h('div', {}, h('h3', {}, app.name), h('div', { class: 'sub' }, app.subtitle || ''))),
      h('p', { class: 'tag' }, app.tagline || ''),
      h('span', { class: 'chip ' + v.chipKind }, v.chip),
      v.busy ? busyBox(v.busy) : h('div', { class: 'card-foot' },
        h('button', { class: 'btn link', onclick: (e) => { e.stopPropagation(); openSheet(app); } }, 'Détails'),
        v.installed ? h('button', { class: 'btn link danger-link', title: 'Désinstaller ' + app.name, onclick: (e) => { e.stopPropagation(); askUninstall(app); } }, 'Désinstaller') : null,
        h('div', { class: 'grow' }),
        mainButton(app, v)));
  }));
  const ups = state.apps.filter(a => view(a).update && !state.busy[a.id]);
  const inst = state.apps.filter(a => view(a).installed).length;
  $('#hero-sub').textContent = inst + ' installée' + (inst > 1 ? 's' : '') + ' sur ' + state.apps.length + (ups.length ? ' · ' + ups.length + ' mise' + (ups.length > 1 ? 's' : '') + ' à jour disponible' + (ups.length > 1 ? 's' : '') : ' · tout est à jour');
  $('#update-all').hidden = ups.length < 2;
  $('#foot').textContent = 'Seventh OS ' + VERSION + (state.online ? '' : ' · liste des applis hors ligne');
  if (state.sheet) openSheet(state.sheet, true);
}

function openSheet(app, keep) {
  state.sheet = app;
  const v = view(app), l = v.l;
  const card = $('#sheet-card');
  card.replaceChildren(
    h('button', { class: 'icon-btn glass close', title: 'Fermer', onclick: closeSheet }, '✕'),
    h('div', { class: 'card-head' },
      h('img', { class: 'app-icon', src: iconOf(app), alt: '' }),
      h('div', {}, h('h2', {}, app.name), h('div', { class: 'sub' }, app.subtitle || ''), h('div', { style: 'margin-top:8px' }, h('span', { class: 'chip ' + v.chipKind }, v.chip)))),
    h('div', { class: 'sec' }, (app.description || []).map(p => h('p', {}, p))),
    app.features && app.features.length ? h('div', { class: 'sec' }, h('h4', {}, 'Ce qu\'elle fait'), h('div', { class: 'feat' }, app.features.map(f => h('span', {}, f)))) : null,
    h('div', { class: 'sec' }, h('h4', {}, 'Infos'), h('dl', { class: 'meta' },
      h('dt', {}, 'Version installée'), h('dd', {}, v.installed ? (v.st.version || '?') : 'aucune'),
      h('dt', {}, 'Dernière version'), h('dd', {}, l ? l.version + (l.published ? ' · ' + new Date(l.published).toLocaleDateString('fr-FR') : '') + (l.size ? ' · ' + size(l.size) : '') : (state.err[app.id] || '…')),
      app.requires ? [h('dt', {}, 'Il faut'), h('dd', {}, app.requires)] : null,
      v.installed && v.st.exe ? [h('dt', {}, 'Emplacement'), h('dd', {}, h('button', { class: 'btn link', onclick: () => ipcRenderer.send('os:show-folder', v.st.exe) }, path.dirname(v.st.exe)))] : null)),
    l && l.notes ? h('div', { class: 'sec' }, h('h4', {}, 'Nouveautés ' + l.version), h('div', { class: 'notes' }, md(l.notes))) : null,
    v.busy ? h('div', { class: 'sec' }, busyBox(v.busy)) : h('div', { class: 'actions' },
      mainButton(app, v),
      v.installed && v.update ? h('button', { class: 'btn', onclick: () => doOpen(app) }, 'Ouvrir') : null,
      h('div', { class: 'grow' }),
      v.installed ? h('button', { class: 'btn ghost', onclick: () => askUninstall(app) }, 'Désinstaller') : null));
  if (!keep) $('#sheet').hidden = false;
}
function closeSheet() { state.sheet = null; $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#confirm').hidden) $('#confirm').hidden = true; else closeSheet(); } });

// ------------------------------------------------------------------ actions
async function doInstall(app) {
  const l = state.latest[app.id];
  if (!l || !l.asset) { toast('Rien à installer pour ' + app.name + ' (' + (state.err[app.id] || 'pas de fichier publié') + ').', true); return; }
  const wasInstalled = view(app).installed;
  const formerName = wasInstalled && state.st[app.id] && state.st[app.id].formerName;
  state.busy[app.id] = { phase: 'prep' };
  render();
  try {
    state.st[app.id] = await O.install(app, l, (s) => { state.busy[app.id] = Object.assign({}, state.busy[app.id], s); render(); });
    if (!state.st[app.id].installed) throw new Error('l\'installation n\'a pas abouti');
    toast((formerName ? formerName + ' devient ' + app.name + ' ' + (state.st[app.id].version || l.version) + ' : mise à jour faite.'
      : app.name + ' ' + (state.st[app.id].version || l.version) + (wasInstalled ? ' : mise à jour faite.' : ' est installée.'))
      + (state.st[app.id].formerLeft ? ' L\'ancienne version (' + state.st[app.id].formerLeft.join(', ') + ') est encore ouverte : ferme-la puis supprime son dossier.' : '')
      + (state.st[app.id].restartNeeded ? ' Elle est encore ouverte : quitte-la et relance-la pour passer à la nouvelle version.' : ''));
  } catch (e) {
    toast(app.name + ' : ' + e.message, true);
    try { state.st[app.id] = await O.installed(app); } catch (err) { /* rien */ }
  } finally { delete state.busy[app.id]; render(); }
}
async function doOpen(app) {
  try { await O.open(app); toast(app.name + ' s\'ouvre…'); } catch (e) { toast(e.message, true); }
}
function askUninstall(app) {
  $('#confirm-title').textContent = 'Désinstaller ' + app.name + ' ?';
  $('#confirm-text').textContent = (app.kind === 'portable' ? 'Son dossier et ses raccourcis vont à la Corbeille. ' : 'Le logiciel est retiré de ce PC. ') + (app.keeps || '') + ' Tu pourras la réinstaller ici quand tu veux.';
  $('#confirm').hidden = false;
  $('#confirm-ok').onclick = async () => {
    $('#confirm').hidden = true;
    state.busy[app.id] = { phase: 'uninstall' };
    render();
    try {
      state.st[app.id] = await O.uninstall(app, () => {});
      toast(state.st[app.id].installed ? app.name + ' : la désinstallation n\'a pas abouti.' : app.name + ' est désinstallée.', state.st[app.id].installed);
    } catch (e) { toast(app.name + ' : ' + e.message, true); }
    finally { delete state.busy[app.id]; render(); }
  };
}
$('#confirm').addEventListener('click', (e) => { if (e.target.hasAttribute('data-cancel')) $('#confirm').hidden = true; });
$('#refresh').addEventListener('click', () => load());
$('#update-all').addEventListener('click', async () => {
  for (const a of state.apps.filter(x => view(x).update)) await doInstall(a);
});

// ------------------------------------------------------------------ mise à jour de Seventh OS
async function checkHub() {
  try {
    const r = await O.hubUpdate(VERSION);
    if (!r.newer) return;
    const b = $('#hub-update');
    b.replaceChildren(h('img', { src: 'icons/seventh-os.png', style: 'width:34px;height:34px;border-radius:10px' }),
      h('div', { class: 'grow' }, h('b', {}, 'Seventh OS ' + r.latest.version + ' est disponible'), r.latest.notes ? ' · ' + r.latest.notes : ''),
      h('button', { class: 'btn update', onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Téléchargement…';
        try {
          const file = await O.downloadHub(r.latest, (d, t) => { e.target.textContent = 'Téléchargement · ' + Math.round(d / t * 100) + ' %'; });
          ipcRenderer.send('os:quit-and-run', { file, args: O.HUB_ARGS });
        } catch (err) { toast('Mise à jour de Seventh OS : ' + err.message, true); e.target.disabled = false; e.target.textContent = 'Installer'; }
      } }, 'Installer'));
    b.hidden = false;
  } catch (e) { /* pas encore publié ou hors ligne */ }
}

// ------------------------------------------------------------------ démarrage
function start() {
  $('#hub').hidden = false;
  load();
}
// développement (tools/run.js --dev) : sans code ; --sheet <id> : fiche ouverte (captures de vérification)
if (process.env.OS_DEV || A.licence()) start(); else showLock();
if (process.env.OS_SHEET) setTimeout(() => { const a = state.apps.find(x => x.id === process.env.OS_SHEET); if (a) openSheet(a); }, 6000);
