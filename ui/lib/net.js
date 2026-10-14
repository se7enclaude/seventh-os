/* Seventh OS — GitHub (repris de se7en studio) : dépôts privés avec la clé débloquée par le code, publics sans clé.
 *   S7Net.api(token, '/repos/o/r/releases/latest')          -> JSON (erreur .status sur 401 / 404…)
 *   S7Net.text(url)                                          -> texte (URL publique : enveloppe du gist)
 *   S7Net.download(token, assetApiUrl, file, { size, sha256, onProgress, signal })
 *       fichier d'une release : l'API répond par une redirection vers une adresse signée, suivie SANS la clé ;
 *       reprise (Range) d'un .part interrompu ; empreinte SHA-256 vérifiée avant de renommer.
 * Node (https) plutôt que fetch : flux direct vers le disque (morceaux de 1,9 Go) et en-têtes maîtrisés. */
(function (root) {
  'use strict';
  const req = root.cep_node ? root.cep_node.require : (typeof require === 'function' ? require : (typeof root.require === 'function' ? root.require : null));
  if (!req) return; // navigateur (simulation) : pas de Node
  const https = req('https');
  const fs = req('fs');
  const path = req('path');
  const crypto = req('crypto');
  const UA = 'seventh-os';

  function request(url, headers, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      const r = https.get(url, { headers: Object.assign({ 'User-Agent': UA }, headers || {}), timeout: o.timeout || 30000 }, resolve);
      r.on('timeout', () => r.destroy(new Error('le serveur ne répond pas (délai dépassé)')));
      r.on('error', reject);
      if (o.signal) o.signal.onabort = () => r.destroy(new Error('arrêté'));
    });
  }

  function body(res) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
  }

  function httpError(res, text, what) {
    const e = new Error((what || 'GitHub') + ' : erreur ' + res.statusCode + (text ? ' (' + String(text).slice(0, 160) + ')' : ''));
    e.status = res.statusCode;
    e.expires = res.headers['github-authentication-token-expiration'] || null;
    return e;
  }

  // token null : dépôt public, sans clé
  async function api(token, p) {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) h.Authorization = 'Bearer ' + token;
    const res = await request('https://api.github.com' + p, h);
    const text = await body(res);
    if (res.statusCode !== 200) throw httpError(res, text);
    const data = JSON.parse(text);
    Object.defineProperty(data, '_expires', { value: res.headers['github-authentication-token-expiration'] || null });
    return data;
  }

  async function text(url) {
    let u = url;
    for (let i = 0; i < 5; i++) {
      const res = await request(u, {});
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); u = new URL(res.headers.location, u).toString(); continue; }
      const t = await body(res);
      if (res.statusCode !== 200) throw httpError(res, t, 'téléchargement');
      return t;
    }
    throw new Error('trop de redirections');
  }

  function sha256File(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      fs.createReadStream(file, { highWaterMark: 1 << 20 }).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
  }

  // Fichier public (browser_download_url d'un dépôt public) : redirections suivies, progression, empreinte vérifiée.
  async function fetchTo(url, file, opts) {
    const o = opts || {};
    const part = file + '.part';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let u = url, res = null;
    for (let i = 0; i < 6; i++) {
      res = await request(u, { Accept: 'application/octet-stream' }, Object.assign({ timeout: 60000 }, o));
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); u = new URL(res.headers.location, u).toString(); continue; }
      break;
    }
    if (res.statusCode !== 200) throw httpError(res, await body(res), 'téléchargement');
    const total = o.size || Number(res.headers['content-length'] || 0);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part);
      let done = 0, last = 0;
      res.on('data', c => {
        done += c.length;
        const now = Date.now();
        if (o.onProgress && (now - last > 250 || done === total)) { last = now; o.onProgress(done, total); }
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
    if (o.size && fs.statSync(part).size !== o.size) { fs.unlinkSync(part); throw new Error('téléchargement incomplet : ' + path.basename(file) + '. Relance.'); }
    if (o.sha256) {
      const got = await sha256File(part);
      if (got.toLowerCase() !== String(o.sha256).toLowerCase()) { fs.unlinkSync(part); throw new Error('fichier abîmé pendant le téléchargement (empreinte différente) : ' + path.basename(file) + '. Relance.'); }
    }
    try { fs.unlinkSync(file); } catch (e) { /* absent */ }
    fs.renameSync(part, file);
    return file;
  }

  async function download(token, assetUrl, file, opts) {
    const o = opts || {};
    const part = file + '.part';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let have = 0;
    try { have = fs.statSync(part).size; } catch (e) { /* nouveau */ }
    if (o.size && have > o.size) { fs.unlinkSync(part); have = 0; }
    if (!(o.size && have === o.size)) {
      // 1) l'API (avec la clé) renvoie l'adresse signée du fichier
      const res = await request(assetUrl, { Accept: 'application/octet-stream', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, o);
      let res2 = res;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // 2) l'adresse signée, sans la clé, en reprenant où on s'était arrêté
        res2 = await request(res.headers.location, have ? { Range: 'bytes=' + have + '-' } : {}, Object.assign({ timeout: 60000 }, o));
      } else if (res.statusCode !== 200) {
        throw httpError(res, await body(res));
      } else if (have) { have = 0; }
      if (res2.statusCode === 200) have = 0; // le serveur a ignoré la reprise : on repart de zéro
      else if (res2.statusCode !== 206) throw httpError(res2, await body(res2), 'téléchargement');
      const total = o.size || (have + Number(res2.headers['content-length'] || 0));
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        let done = have;
        let last = 0;
        res2.on('data', c => {
          done += c.length;
          const now = Date.now();
          if (o.onProgress && (now - last > 250 || done === total)) { last = now; o.onProgress(done, total); }
        });
        res2.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        res2.pipe(out);
      });
    }
    if (o.sha256) {
      const got = await sha256File(part);
      if (got.toLowerCase() !== String(o.sha256).toLowerCase()) { fs.unlinkSync(part); throw new Error('fichier abîmé pendant le téléchargement (empreinte différente) : ' + path.basename(file) + '. Relance : il sera retéléchargé.'); }
    }
    try { fs.unlinkSync(file); } catch (e) { /* absent */ }
    fs.renameSync(part, file);
    return file;
  }

  const api_ = { api, text, download, fetchTo, sha256File };
  root.S7Net = api_;
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
})(typeof window !== 'undefined' ? window : globalThis);
