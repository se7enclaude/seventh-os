/* Seventh OS — les applis : catalogue, version installée, dernière version, installer / ouvrir / désinstaller.
 *
 * Catalogue : apps.json du dépôt public se7enclaude/seventh-os (relu à chaque lancement), copie livrée en secours.
 * Deux sortes d'applis :
 *  - « inno » : installateur Inno Setup par utilisateur (se7en studio, se7en Download). Version installée et chemins lus
 *    dans HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<uninstallKey> ; installation et désinstallation
 *    sans fenêtre (/VERYSILENT) ; ce qui a été installé avant le hub est reconnu.
 *  - « portable » : un seul .exe (se7en DualSense), copié là où l'appli s'installe elle-même
 *    (%LOCALAPPDATA%\Programs\se7en DualSense), avec ses raccourcis ; version lue dans le .exe.
 * Dernière version : release « latest » du dépôt de l'appli (avec la clé débloquée par le code si le dépôt est privé) ;
 * son latest.json donne le fichier et son empreinte SHA-256 ; sinon l'empreinte est lue dans les notes (« SHA-256 : … »).
 * Désinstallation d'une appli portable : son dossier et ses raccourcis partent à la Corbeille (jamais effacés).
 * Appli portable renommée : « replaces » liste ses anciens emplacements ({ name, installDir, exe }). Une ancienne
 * installation compte comme cette appli (avec sa version) ; la mise à jour installe sous le nouveau nom
 * puis met l'ancienne à la Corbeille (ex. se7en Relais → se7en Vision). */
(function (root) {
  'use strict';
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const cp = require('child_process');
  const N = () => root.S7Net;
  const A = () => root.S7Access;

  const CATALOG_URL = 'https://raw.githubusercontent.com/se7enclaude/seventh-os/main/apps.json';
  const DIR = path.join(process.env.APPDATA || os.homedir(), 'Seventh OS');
  const DL = path.join(DIR, 'telechargements');
  const UNINSTALL = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\';
  const INNO_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/CLOSEAPPLICATIONS'];

  const expand = (p) => String(p || '').replace(/%([^%]+)%/g, (m, k) => process.env[k] || m);
  const vnum = (v) => String(v || '0').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).slice(0, 4).map(Number);
  function newer(a, b) {
    const x = vnum(a), y = vnum(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
    return false;
  }
  const clean = (v) => vnum(v).slice(0, 3).join('.') || null; // affichage : 0.5.0 (le .exe dit 0.5.0.2)

  function run(file, args, opts) {
    return new Promise((resolve) => {
      let out = '';
      let p;
      try { p = cp.spawn(file, args || [], Object.assign({ windowsHide: true }, opts || {})); } catch (e) { resolve({ code: -1, out: String(e.message) }); return; }
      if (p.stdout) p.stdout.on('data', d => { out += d; });
      if (p.stderr) p.stderr.on('data', d => { out += d; });
      p.on('error', e => resolve({ code: -1, out: String(e.message) }));
      p.on('close', code => resolve({ code, out }));
    });
  }
  const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  // ---------------------------------------------------------------- catalogue
  async function catalog(bundledFile) {
    try {
      const t = await Promise.race([N().text(CATALOG_URL + '?t=' + Date.now()), new Promise((_, rej) => setTimeout(() => rej(new Error('délai')), 8000))]);
      const c = JSON.parse(t);
      if (c && Array.isArray(c.apps)) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'apps.json'), t, 'utf8'); return { apps: c.apps, online: true }; }
    } catch (e) { /* hors ligne : dernière copie, puis celle livrée */ }
    for (const f of [path.join(DIR, 'apps.json'), bundledFile]) {
      try { return { apps: JSON.parse(fs.readFileSync(f, 'utf8')).apps, online: false }; } catch (e) { /* suivant */ }
    }
    return { apps: [], online: false };
  }

  // ---------------------------------------------------------------- installé ?
  async function regKey(key) {
    for (const hive of ['HKCU', 'HKLM']) {
      const r = await run('reg.exe', ['query', hive + '\\' + UNINSTALL + key]);
      if (r.code !== 0) continue;
      const v = {};
      r.out.split(/\r?\n/).forEach(l => { const m = l.match(/^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/); if (m) v[m[1]] = m[2].trim(); });
      return v;
    }
    return null;
  }
  async function exeVersion(file) {
    const r = await ps('(Get-Item -LiteralPath ' + q(file) + ').VersionInfo | ForEach-Object { if ($_.ProductVersion) { $_.ProductVersion } else { $_.FileVersion } }');
    return r.code === 0 ? clean(r.out.trim()) : null;
  }
  function portableExe(app) { return path.join(expand(app.installDir), app.exe); }

  // Les anciens noms d'une appli portable renommée, sous forme d'applis à part entière (même nettoyage).
  function formerApps(app) {
    if (app.kind !== 'portable' || !Array.isArray(app.replaces)) return [];
    return app.replaces.filter(r => r && r.installDir && r.exe).map(r => Object.assign({}, app, {
      name: r.name || app.name, installDir: r.installDir, exe: r.exe,
      shortcuts: r.shortcuts || app.shortcuts, cleanup: 'cleanup' in r ? r.cleanup : app.cleanup, replaces: undefined,
    }));
  }
  const formerInstalled = (app) => formerApps(app).filter(old => fs.existsSync(portableExe(old)));

  // -> { installed: bool, version, exe }
  async function installed(app) {
    if (app.kind === 'inno') {
      const v = await regKey(app.uninstallKey);
      if (!v) return { installed: false };
      const dir = (v.InstallLocation || '').replace(/"/g, '').replace(/\\$/, '');
      return { installed: true, version: clean(v.DisplayVersion), exe: dir ? path.join(dir, app.exe) : null, uninstall: v.UninstallString || null };
    }
    const exe = portableExe(app);
    if (fs.existsSync(exe)) return { installed: true, version: await exeVersion(exe), exe };
    const old = formerInstalled(app)[0];
    if (old) { const oldExe = portableExe(old); return { installed: true, version: await exeVersion(oldExe), exe: oldExe, formerName: old.name }; }
    return { installed: false };
  }

  // ---------------------------------------------------------------- dernière version
  function tokenFor(app) {
    if (!app.private) return null;
    const l = A().licence();
    if (!l || !l.token) { const e = new Error('code d\'accès nécessaire'); e.why = 'locked'; throw e; }
    return l.token;
  }
  async function getFile(app, asset, file, opts) {
    const token = tokenFor(app);
    if (token) return N().download(token, asset.url, file, opts);
    return N().fetchTo(asset.browser_download_url, file, opts);
  }

  // -> { version, notes, published, asset, size, sha256 }
  async function latest(app) {
    const token = tokenFor(app);
    const rel = await N().api(token, '/repos/' + app.repo + '/releases/latest');
    const assets = rel.assets || [];
    let version = clean(rel.tag_name), notes = rel.body || '', want = null, sha256 = null;
    if (app.manifest) {
      const ma = assets.find(a => a.name === app.manifest);
      if (ma) {
        const f = path.join(DL, app.id + '-' + app.manifest);
        await getFile(app, ma, f, { size: ma.size });
        const m = JSON.parse(fs.readFileSync(f, 'utf8'));
        const e = m[app.manifestKey] || {};
        version = clean(m.version) || version;
        if (m.notes && !notes) notes = m.notes;
        want = e.name || null;
        sha256 = e.sha256 || null;
      }
    } else {
      want = app.asset;
      const m = String(rel.body || '').match(/SHA-?256\s*:\s*([0-9a-f]{64})/i);
      sha256 = m ? m[1].toLowerCase() : null;
    }
    const asset = assets.find(a => a.name === want) || null;
    return { version, notes, published: rel.published_at, tag: rel.tag_name, asset, size: asset ? asset.size : null, sha256 };
  }

  // ---------------------------------------------------------------- actions
  // onStep({ phase: 'download' | 'install' | 'uninstall', done, total })
  async function install(app, info, onStep) {
    if (!info || !info.asset) throw new Error('aucun fichier à installer dans la dernière publication de ' + app.name);
    const file = path.join(DL, info.asset.name);
    await getFile(app, info.asset, file, { size: info.asset.size, sha256: info.sha256 || undefined, onProgress: (d, t) => onStep && onStep({ phase: 'download', done: d, total: t }) });
    onStep && onStep({ phase: 'install' });
    if (app.kind === 'inno') {
      const r = await run(file, INNO_ARGS.concat(['/LOG=' + path.join(DIR, app.id + '-install.log')]));
      if (r.code !== 0) throw new Error('installation de ' + app.name + ' interrompue (code ' + r.code + ')');
    } else {
      const exe = portableExe(app);
      await run('taskkill.exe', ['/IM', app.exe, '/F']); // une copie ouverte bloquerait le remplacement
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      const stillRunning = await replaceExe(file, exe);
      await shortcuts(app, exe, true);
      try { fs.unlinkSync(file); } catch (e) { /* gardé */ }
      // Renommée : l'ancienne version (dossier, raccourcis, données) part à la Corbeille.
      const leftovers = [];
      for (const old of formerInstalled(app)) {
        try { await uninstall(old); } catch (e) { leftovers.push(old.name); }
      }
      const st = await installed(app);
      st.restartNeeded = stillRunning;
      if (leftovers.length) st.formerLeft = leftovers;
      return st;
    }
    try { fs.unlinkSync(file); } catch (e) { /* gardé */ }
    return installed(app);
  }

  async function isRunning(exeName) {
    const r = await run('tasklist.exe', ['/FI', 'IMAGENAME eq ' + exeName, '/NH']);
    return r.out.toLowerCase().includes(exeName.toLowerCase());
  }

  // Remplace un .exe portable, même s'il tourne encore : une appli lancée en administrateur (se7en DualSense)
  // ne peut pas être fermée d'ici. Un exécutable en cours ne peut pas être écrasé, mais il peut être renommé :
  // l'ancien est mis de côté (.old, supprimé dès qu'il est libéré), le nouveau prend sa place.
  // Renvoie true si l'ancienne version tourne toujours (à relancer pour passer à la nouvelle).
  async function replaceExe(src, dest) {
    const dir = path.dirname(dest);
    // Restes d'une mise à jour précédente
    for (const f of fs.readdirSync(dir)) {
      if (/\.old$/i.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* encore ouvert */ } }
    }
    for (let i = 0; i < 8; i++) {
      try { fs.copyFileSync(src, dest); return false; } catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e; }
      await new Promise(r => setTimeout(r, 400)); // le temps que la copie fermée libère le fichier
    }
    const old = dest + '.' + Date.now() + '.old';
    fs.renameSync(dest, old);
    try {
      fs.copyFileSync(src, dest);
    } catch (e) {
      try { fs.renameSync(old, dest); } catch (err) { /* rien */ }
      throw e;
    }
    try { fs.unlinkSync(old); } catch (e) { /* encore ouvert : supprimé à la prochaine installation */ }
    return isRunning(path.basename(dest));
  }

  function shortcutPaths(app) {
    const name = app.exe.replace(/\.exe$/i, '') + '.lnk';
    const out = [];
    if ((app.shortcuts || []).includes('programs')) out.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', name));
    if ((app.shortcuts || []).includes('desktop')) out.push(path.join(os.homedir(), 'Desktop', name));
    return out;
  }
  async function shortcuts(app, exe) {
    const lines = shortcutPaths(app).map(lnk => '$s = $w.CreateShortcut(' + q(lnk) + '); $s.TargetPath = ' + q(exe) + '; $s.WorkingDirectory = ' + q(path.dirname(exe)) + '; $s.Save()');
    if (!lines.length) return;
    const r = await ps('$w = New-Object -ComObject WScript.Shell; ' + lines.join('; '));
    if (r.code !== 0) throw new Error('raccourcis impossibles : ' + r.out.trim().slice(0, 200));
  }
  // vers la Corbeille (jamais effacé définitivement)
  async function recycle(paths) {
    const items = paths.filter(p => fs.existsSync(p));
    if (!items.length) return;
    const cmds = items.map(p => (fs.statSync(p).isDirectory()
      ? '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(' + q(p) + ', "OnlyErrorDialogs", "SendToRecycleBin")'
      : '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(' + q(p) + ', "OnlyErrorDialogs", "SendToRecycleBin")'));
    const r = await ps('Add-Type -AssemblyName Microsoft.VisualBasic; ' + cmds.join('; '));
    if (r.code !== 0) throw new Error('mise à la Corbeille impossible : ' + r.out.slice(0, 200));
  }

  async function uninstall(app, onStep) {
    onStep && onStep({ phase: 'uninstall' });
    if (app.kind === 'inno') {
      const st = await installed(app);
      if (!st.installed || !st.uninstall) return st;
      const exe = st.uninstall.replace(/^"([^"]+)".*$/, '$1').replace(/\s+\/.*$/, '');
      await run(exe, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
      // le désinstalleur d'Inno se relance depuis un dossier temporaire : on attend que l'appli ait disparu du registre
      for (let i = 0; i < 120; i++) {
        if (!(await regKey(app.uninstallKey))) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      // Seule l'ancienne version (avant renommage) est là : c'est elle qu'on retire.
      if (!fs.existsSync(portableExe(app)) && formerInstalled(app).length) {
        for (const old of formerInstalled(app)) await uninstall(old, onStep);
        return installed(app);
      }
      const st = await installed(app);
      await run('taskkill.exe', ['/IM', app.exe, '/F']);
      if (await isRunning(app.exe)) {
        await new Promise(r => setTimeout(r, 800));
        if (await isRunning(app.exe))
          throw new Error(app.name + ' est ouverte en administrateur : quitte-la (icône près de l\'horloge › Quitter) puis réessaie');
      }
      // Nettoyage propre par l'appli elle-même avant de la supprimer (ex. se7en DualSense : manette démasquée,
      // démarrage avec Windows retiré). Seulement si la version installée connaît cette commande.
      if (app.cleanup && st.installed && st.exe && fs.existsSync(st.exe) && !newer(app.cleanup.minVersion || '0', st.version || '0')) {
        onStep && onStep({ phase: 'uninstall', detail: 'nettoyage' });
        await Promise.race([run(st.exe, app.cleanup.args || []), new Promise(r => setTimeout(r, 90000))]);
      }
      await recycle([expand(app.installDir)].concat(shortcutPaths(app)));
    }
    return installed(app);
  }

  async function open(app) {
    const st = await installed(app);
    if (!st.installed || !st.exe || !fs.existsSync(st.exe)) throw new Error(app.name + ' introuvable sur ce PC');
    const p = cp.spawn(st.exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(st.exe) });
    p.unref();
  }

  // ---------------------------------------------------------------- Seventh OS lui-même
  const HUB = 'se7enclaude/seventh-os';
  async function hubUpdate(current) {
    const m = JSON.parse(await N().text('https://github.com/' + HUB + '/releases/latest/download/latest.json?t=' + Date.now()));
    return { latest: m, newer: newer(m.version, current) };
  }
  async function downloadHub(m, onProgress) {
    const u = m.update;
    const file = path.join(DL, u.name);
    await N().fetchTo('https://github.com/' + HUB + '/releases/download/v' + m.version + '/' + encodeURIComponent(u.name), file, { size: u.size, sha256: u.sha256, onProgress });
    return file;
  }
  const HUB_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', '/RELAUNCH=1'];

  const api = { DIR, catalog, installed, latest, install, uninstall, open, newer, hubUpdate, downloadHub, HUB_ARGS, expand, shortcuts, shortcutPaths };
  root.OSApps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
