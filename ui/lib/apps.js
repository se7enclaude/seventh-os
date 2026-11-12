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
  // reg.exe écrit dans la page de codes de la console (OEM, 850 en français) : décodée en UTF-8, « Zoé » devenait
  // illisible (chemin introuvable, désinstallation impossible). On passe la console en UTF-8 (chcp 65001) juste
  // avant, dans le même cmd : la sortie est alors de l'UTF-8.
  function parseReg(out) {
    const v = {};
    String(out || '').split(/\r?\n/).forEach(l => { const m = l.match(/^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/); if (m) v[m[1]] = m[2].trim(); });
    return v;
  }
  // -> { nom: valeur } d'une clé, ou null si elle n'existe pas
  async function regValues(fullKey) {
    if (/["%\r\n]/.test(fullKey)) return null; // jamais dans une clé Uninstall ; casserait la ligne de cmd
    const r = await run('cmd.exe', ['/d', '/s', '/c', '"chcp 65001>nul & reg.exe query "' + fullKey + '""'], { windowsVerbatimArguments: true });
    return r.code === 0 ? parseReg(r.out) : null;
  }
  async function regKey(key) {
    for (const hive of ['HKCU', 'HKLM']) {
      const v = await regValues(hive + '\\' + UNINSTALL + key);
      if (v) return v;
    }
    return null;
  }
  // Version d'un .exe portable : un PowerShell à chaque fois, c'est lent ; gardée (versions.json) tant que
  // le fichier ne change pas (même date de modification, même taille).
  const VERSIONS = path.join(DIR, 'versions.json');
  let versions = null;
  async function exeVersion(file) {
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    if (!versions) { try { versions = JSON.parse(fs.readFileSync(VERSIONS, 'utf8')) || {}; } catch (e) { versions = {}; } }
    const k = file.toLowerCase(), c = versions[k];
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.version;
    const r = await ps('(Get-Item -LiteralPath ' + q(file) + ').VersionInfo | ForEach-Object { if ($_.ProductVersion) { $_.ProductVersion } else { $_.FileVersion } }');
    const version = r.code === 0 ? clean(r.out.trim()) : null;
    if (version) {
      versions[k] = { mtime: st.mtimeMs, size: st.size, version };
      try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(VERSIONS, JSON.stringify(versions), 'utf8'); } catch (e) { /* relue la prochaine fois */ }
    }
    return version;
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

  // Dépôt public : sans l'API GitHub (quota de 60 demandes / heure sans clé, vite épuisé quand on rouvre le hub).
  // L'étiquette vient de la redirection de /releases/latest ; latest.json, ou l'empreinte écrite dans la page de la
  // publication pour une appli portable, sont des fichiers publics.
  async function latestPublic(app) {
    const tag = await N().latestTag(app.repo);
    const base = 'https://github.com/' + app.repo + '/releases/download/' + encodeURIComponent(tag) + '/';
    const asset = (name, size) => ({ name, size: size || null, browser_download_url: base + encodeURIComponent(name) });
    if (app.manifest) {
      const m = JSON.parse(await N().text(base + encodeURIComponent(app.manifest)));
      const e = m[app.manifestKey] || {};
      const a = e.name ? asset(e.name, e.size) : null;
      if (a && !e.sha256) throw noHash(app, tag);
      return { version: clean(m.version) || clean(tag), notes: m.notes || '', published: m.published || null, tag, asset: a, size: a ? a.size : null, sha256: e.sha256 || null };
    }
    const page = await N().text('https://github.com/' + app.repo + '/releases/tag/' + encodeURIComponent(tag));
    const m = page.match(/SHA-?256\s*:\s*(?:<[^>]+>\s*)*([0-9a-f]{64})/i);
    if (!m) throw noHash(app, tag);
    return { version: clean(tag), notes: '', published: null, tag, asset: asset(app.asset), size: null, sha256: m[1].toLowerCase() };
  }

  // Publication sans empreinte SHA-256 : rien n'est installé (le fichier ne pourrait pas être vérifié).
  function noHash(app, tag) {
    const e = new Error('la publication ' + tag + ' de ' + app.name + ' ne donne pas d\'empreinte SHA-256 : installation bloquée par sécurité');
    e.why = 'nohash';
    return e;
  }
  // Empreinte calculée par GitHub pour le fichier (champ « digest » : « sha256:… »), si elle est là.
  const digestOf = (a) => { const m = a && String(a.digest || '').match(/^sha256:([0-9a-f]{64})$/i); return m ? m[1].toLowerCase() : null; };

  // -> { version, notes, published, asset, size, sha256 }
  async function latest(app) {
    if (!app.private) {
      // page de GitHub changée ou injoignable : l'API, comme avant. Mais une publication sans empreinte reste refusée.
      try { return await latestPublic(app); } catch (e) { if (e.why === 'nohash') throw e; }
    }
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
    if (!sha256) sha256 = digestOf(asset);
    return { version, notes, published: rel.published_at, tag: rel.tag_name, asset, size: asset ? asset.size : null, sha256 };
  }

  // ---------------------------------------------------------------- actions
  // onStep({ phase: 'download' | 'install' | 'uninstall', done, total })
  // opts.allowKill : l'utilisateur a accepté de fermer l'appli portable si elle est ouverte (jamais sans son accord).
  async function install(app, info, onStep, opts) {
    if (!info || !info.asset) throw new Error('aucun fichier à installer dans la dernière publication de ' + app.name);
    if (!/^[0-9a-f]{64}$/i.test(String(info.sha256 || ''))) throw new Error('la dernière publication de ' + app.name + ' ne donne pas d\'empreinte SHA-256 : installation bloquée par sécurité (le fichier ne peut pas être vérifié)');
    const o = opts || {};
    const file = path.join(DL, info.asset.name);
    await getFile(app, info.asset, file, { size: info.asset.size, sha256: info.sha256, onProgress: (d, t) => onStep && onStep({ phase: 'download', done: d, total: t }) });
    onStep && onStep({ phase: 'install' });
    if (app.kind === 'inno') {
      const r = await run(file, INNO_ARGS.concat(['/LOG=' + path.join(DIR, app.id + '-install.log')]));
      if (r.code !== 0) throw new Error('installation de ' + app.name + ' interrompue (code ' + r.code + ')');
    } else {
      const exe = portableExe(app);
      // une copie ouverte est mise de côté par replaceExe ; on ne la ferme que si l'utilisateur l'a accepté
      if (o.allowKill) await run('taskkill.exe', ['/IM', app.exe, '/F']);
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      const stillRunning = await replaceExe(file, exe);
      await shortcuts(app, exe, true);
      try { fs.unlinkSync(file); } catch (e) { /* gardé */ }
      // Renommée : l'ancienne version (dossier, raccourcis, données) part à la Corbeille.
      const leftovers = [];
      for (const old of formerInstalled(app)) {
        try { await uninstall(old, null, o); } catch (e) { leftovers.push(old.name); }
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
  // Appli portable ouverte (sous son nom actuel ou un ancien nom) ? Pour demander avant de la fermer.
  async function running(app) {
    if (app.kind !== 'portable') return false;
    for (const exe of [app.exe].concat(formerApps(app).map(f => f.exe))) if (await isRunning(exe)) return true;
    return false;
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

  // opts.allowKill : l'utilisateur a accepté de fermer l'appli portable si elle est ouverte.
  async function uninstall(app, onStep, opts) {
    const o = opts || {};
    onStep && onStep({ phase: 'uninstall' });
    if (app.kind === 'inno') {
      const st = await installed(app);
      if (!st.installed || !st.uninstall) return st;
      const exe = st.uninstall.replace(/^"([^"]+)".*$/, '$1').replace(/\s+\/.*$/, '');
      const r = await run(exe, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);
      if (r.code !== 0) throw new Error('désinstallation de ' + app.name + ' interrompue (code ' + r.code + ')');
      // le désinstalleur d'Inno se relance depuis un dossier temporaire : on attend que l'appli ait disparu du registre
      for (let i = 0; i < 120; i++) {
        if (!(await regKey(app.uninstallKey))) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      // Seule l'ancienne version (avant renommage) est là : c'est elle qu'on retire.
      if (!fs.existsSync(portableExe(app)) && formerInstalled(app).length) {
        for (const old of formerInstalled(app)) await uninstall(old, onStep, o);
        return installed(app);
      }
      const st = await installed(app);
      if (o.allowKill) await run('taskkill.exe', ['/IM', app.exe, '/F']);
      if (await isRunning(app.exe)) {
        if (!o.allowKill) throw new Error(app.name + ' est ouverte : quitte-la puis réessaie');
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
    if (!u || !/^[0-9a-f]{64}$/i.test(String(u.sha256 || ''))) throw new Error('la publication ne donne pas d\'empreinte SHA-256 : mise à jour bloquée par sécurité');
    const file = path.join(DL, u.name);
    await N().fetchTo('https://github.com/' + HUB + '/releases/download/v' + m.version + '/' + encodeURIComponent(u.name), file, { size: u.size, sha256: u.sha256, onProgress });
    return file;
  }
  // Téléchargements : les installeurs sont normalement effacés après usage, mais pas ceux du hub (il se ferme pour
  // s'installer) ni ceux d'une installation interrompue. Au démarrage, les .exe / .part de plus de 6 heures partent ;
  // les *-latest.json (petits, relus à chaque vérification) restent.
  async function purgeDownloads(maxAgeMs) {
    const limit = Date.now() - (maxAgeMs || 6 * 3600 * 1000);
    let names = [];
    try { names = await fs.promises.readdir(DL); } catch (e) { return 0; }
    let n = 0;
    for (const name of names) {
      if (!/\.(exe|part)$/i.test(name)) continue;
      const f = path.join(DL, name);
      try {
        const st = await fs.promises.stat(f);
        if (st.isFile() && st.mtimeMs < limit) { await fs.promises.unlink(f); n++; }
      } catch (e) { /* encore ouvert ou déjà parti */ }
    }
    return n;
  }
  const HUB_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', '/RELAUNCH=1'];

  const api = { DIR, DL, catalog, installed, latest, install, uninstall, open, running, newer, hubUpdate, downloadHub, purgeDownloads, HUB_ARGS, expand, shortcuts, shortcutPaths, parseReg, regValues };
  root.OSApps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
