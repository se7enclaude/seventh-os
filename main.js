/* Seventh OS — le hub (processus principal Electron) : une fenêtre qui charge ui/index.html avec Node actif.
 * Données : %APPDATA%\Seventh OS (licence, catalogue en cache, téléchargements, journal). */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const DATA = path.join(app.getPath('appData'), 'Seventh OS');
const STATE = path.join(DATA, 'app.json');
const LOG = path.join(DATA, 'crash.log');
app.setPath('userData', path.join(DATA, 'app'));
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return {}; } };
function writeState(patch) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(Object.assign(readState(), patch), null, 1), 'utf8'); } catch (e) { /* rien */ }
}
function log(msg) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 512 * 1024) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, new Date().toISOString() + ' [' + app.getVersion() + '] ' + msg + '\n');
  } catch (e) { /* rien */ }
}
process.on('uncaughtException', (e) => log('processus principal : ' + (e && e.stack || e)));

function createWindow() {
  const st = readState().window || {};
  win = new BrowserWindow({
    width: st.w || 1180, height: st.h || 760, x: st.x, y: st.y, minWidth: 860, minHeight: 600,
    title: 'Seventh OS', backgroundColor: '#16191B', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, spellcheck: false }
  });
  if (st.max) win.maximize();
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // vérification (tools/run.js --shot) : capture de la fenêtre une fois les applis chargées, puis fermeture
  if (process.env.OS_SHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try { fs.writeFileSync(process.env.OS_SHOT, (await win.webContents.capturePage()).toPNG()); } catch (e) { log('capture : ' + e.message); }
      app.quit();
    }, Number(process.env.OS_SHOT_DELAY || 9000)));
  }
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F12') win.webContents.toggleDevTools();
    if (i.control && i.key.toLowerCase() === 'r') win.webContents.reload();
  });
  win.webContents.on('render-process-gone', (e, d) => { log('interface arrêtée : ' + d.reason); if (d.reason !== 'clean-exit' && win) setTimeout(() => win && win.webContents.reload(), 600); });
  win.webContents.on('console-message', (e, a, b, c, d) => {
    const det = a && typeof a === 'object' ? a : { level: a, message: b, lineNumber: c, sourceId: d };
    if (det.level === 3 || det.level === 'error') log('erreur interface : ' + String(det.message).slice(0, 500) + ' (' + path.basename(String(det.sourceId || '')) + ':' + det.lineNumber + ')');
  });
  win.on('close', () => { const b = win.getNormalBounds(); writeState({ window: { x: b.x, y: b.y, w: b.width, h: b.height, max: win.isMaximized() } }); });
  win.on('closed', () => { win = null; });
}

ipcMain.on('os:version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.on('os:paths', (e) => { e.returnValue = { root: __dirname, catalog: path.join(__dirname, 'apps.json'), data: DATA }; });
ipcMain.on('os:open-external', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('os:show-folder', (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
// mise à jour de Seventh OS : l'installateur (silencieux) remplace le hub fermé puis le relance
ipcMain.on('os:quit-and-run', (e, o) => {
  try { cp.spawn(o.file, o.args || [], { detached: true, stdio: 'ignore' }).unref(); } catch (err) { dialog.showErrorBox('Seventh OS', 'Mise à jour impossible : ' + err.message); return; }
  setTimeout(() => app.quit(), 300);
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
