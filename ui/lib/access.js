/* Seventh OS — accès (repris de se7en studio : même mot de passe, même enveloppe) : le code d'accès débloque la clé GitHub (lecture seule) du dépôt privé.
 *
 * Enveloppe (data/access.json, copiée aussi dans un gist public pour les changements de code) :
 *   { v: 1, repo: 'proprio/depot', gist: 'url brute de l'enveloppe', iter, salt, iv, tag, ct }   (base64)
 *   clé AES-256-GCM = PBKDF2-SHA256(code normalisé, salt, iter) ; ct = la clé GitHub chiffrée. Un mauvais code fait
 *   échouer l'authentification GCM : on sait qu'il est faux sans rien envoyer à personne.
 * Licence (%APPDATA%\Seventh OS\licence.json) : la clé débloquée, protégée par Windows (DPAPI, compte courant) :
 *   copiée sur un autre PC ou un autre compte, elle est illisible. Le code n'est demandé qu'au premier démarrage.
 * Tests / outils : S7Access.seal(code, token, repo) fabrique une enveloppe (utilisé par tools/set-code.js). */
(function (root) {
  'use strict';
  const req = root.cep_node ? root.cep_node.require : (typeof require === 'function' ? require : (typeof root.require === 'function' ? root.require : null));
  if (!req) return; // navigateur (simulation) : pas de Node
  const fs = req('fs');
  const path = req('path');
  const os = req('os');
  const crypto = req('crypto');
  const cp = req('child_process');
  const proc = root.process || (root.cep_node && root.cep_node.process) || process;

  const DIR = path.join(proc.env.APPDATA || os.homedir(), 'Seventh OS');
  const LICENCE = path.join(DIR, 'licence.json');
  const ITER = 200000;
  const NO_KEY = '-'; // enveloppe sans clé GitHub (tools/set-code.js sans clé) : seul le code est vérifié

  // « s7-k4f9 2qxm… » -> « S7K4F92QXM… » : tirets, espaces et casse ne comptent pas
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function seal(code, token, repo, extra) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(normCode(code), salt, ITER, 32, 'sha256');
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(String(token), 'utf8'), c.final()]);
    return Object.assign({ v: 1, repo, iter: ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }, extra || {});
  }

  // -> la clé GitHub, ou null si le code est faux
  function open(env, code) {
    try {
      const key = crypto.pbkdf2Sync(normCode(code), Buffer.from(env.salt, 'base64'), env.iter || ITER, 32, 'sha256');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
      d.setAuthTag(Buffer.from(env.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8');
    } catch (e) {
      return null;
    }
  }

  // DPAPI par PowerShell (Windows) : le secret passe par l'entrée standard, jamais sur la ligne de commande
  function dpapi(mode, input) {
    const ps = mode === 'protect'
      ? '$s=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s), $null, "CurrentUser"))'
      : '$s=[Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s), $null, "CurrentUser"))';
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { input, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    if (r.status !== 0) throw new Error('protection Windows indisponible : ' + String(r.stderr || r.error || '').slice(0, 200));
    return String(r.stdout).trim();
  }

  let cached = null;
  function licence() {
    if (cached) return cached;
    try {
      const l = JSON.parse(fs.readFileSync(LICENCE, 'utf8'));
      const token = dpapi('unprotect', l.token);
      if (!token) return null;
      // « - » : code juste, mais pas encore de clé GitHub dans l'app (mises à jour pas encore branchées)
      cached = { repo: l.repo, token: token === NO_KEY ? null : token, since: l.since };
      return cached;
    } catch (e) {
      return null;
    }
  }

  function saveLicence(repo, token) {
    fs.mkdirSync(DIR, { recursive: true });
    const l = { v: 1, repo, token: dpapi('protect', token), since: new Date().toISOString() };
    fs.writeFileSync(LICENCE + '.tmp', JSON.stringify(l, null, 1), 'utf8');
    fs.renameSync(LICENCE + '.tmp', LICENCE);
    cached = { repo, token: token === NO_KEY ? null : token, since: l.since };
    return cached;
  }

  function forget() {
    cached = null;
    try { fs.unlinkSync(LICENCE); } catch (e) { /* absent */ }
  }

  // Enveloppe livrée avec l'app (null : app non configurée, ex. copie de développement sans code)
  function bundled(extDir) {
    try { return JSON.parse(fs.readFileSync(path.join(extDir, 'data', 'access.json'), 'utf8')); } catch (e) { return null; }
  }

  /* Débloque avec le code. Essaie l'enveloppe livrée, puis celle du gist (code changé depuis l'installation).
   * Vérifie la clé auprès de GitHub quand c'est possible ; hors ligne, un code juste suffit.
   * -> { ok: true } | { ok: false, why: 'code' | 'revoked' | 'config', message } */
  async function unlock(extDir, code) {
    const env0 = bundled(extDir);
    if (!env0) return { ok: false, why: 'config', message: 'Cette copie de Seventh OS n\'a pas de clé d\'accès (data/access.json).' };
    let token = open(env0, code);
    let env = env0;
    if (!token && env0.gist) {
      try { const e2 = JSON.parse(await root.S7Net.text(env0.gist + (env0.gist.includes('?') ? '&' : '?') + 't=' + Date.now())); token = open(e2, code); env = e2; } catch (e) { /* hors ligne */ }
    }
    if (!token) return { ok: false, why: 'code', message: 'Mot de passe incorrect.' };
    if (token === NO_KEY) { saveLicence(env.repo, NO_KEY); return { ok: true }; }
    try {
      await root.S7Net.api(token, '/repos/' + env.repo);
    } catch (e) {
      if (e.status === 401 || e.status === 403 || e.status === 404) return { ok: false, why: 'revoked', message: 'Ce mot de passe n\'ouvre plus l\'accès : demande le nouveau.' };
      // hors ligne ou GitHub indisponible : le code est juste, on garde la clé
    }
    saveLicence(env.repo, token);
    return { ok: true };
  }

  const api = { DIR, LICENCE, normCode, seal, open, licence, saveLicence, forget, bundled, unlock };
  root.S7Access = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
