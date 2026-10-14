/* se7en studio — extraction des .zip (contenu téléchargé : code, sons, projets), sans programme externe.
 * Lit le répertoire central (zip64 compris), écrit chaque fichier en flux : méthodes « stocké » (0, nos paquets de
 * contenu, vidéos déjà compressées) et « deflate » (8). Noms en UTF-8 (drapeau 0x800) ou CP437 lus comme latin1.
 * Refuse tout chemin qui sortirait du dossier de destination.
 *   S7Unzip.extract(zip, destDir, { onProgress(doneBytes, totalBytes, name) }) -> Promise<{ files, bytes }>
 */
(function (root) {
  'use strict';
  const req = root.cep_node ? root.cep_node.require : (typeof require === 'function' ? require : (typeof root.require === 'function' ? root.require : null));
  if (!req) return; // navigateur (simulation) : pas de Node
  const fs = req('fs');
  const path = req('path');
  const zlib = req('zlib');

  function readAt(fd, pos, len) {
    const b = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const n = fs.readSync(fd, b, off, len - off, pos + off);
      if (!n) break;
      off += n;
    }
    return b.subarray(0, off);
  }
  const u64 = (b, o) => Number(b.readBigUInt64LE(o));

  // Fin du répertoire central (EOCD), puis sa version zip64 si les champs 32 bits sont saturés.
  function directory(fd, size) {
    const tail = readAt(fd, Math.max(0, size - 65557), Math.min(size, 65557));
    let i = tail.length - 22;
    while (i >= 0 && tail.readUInt32LE(i) !== 0x06054b50) i--;
    if (i < 0) throw new Error('fichier zip illisible (fin introuvable)');
    let count = tail.readUInt16LE(i + 10);
    let cdSize = tail.readUInt32LE(i + 12);
    let cdOff = tail.readUInt32LE(i + 16);
    if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
      const loc = i - 20;
      if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
        const eocd64 = readAt(fd, u64(tail, loc + 8), 56);
        if (eocd64.readUInt32LE(0) !== 0x06064b50) throw new Error('fichier zip64 illisible');
        count = u64(eocd64, 32);
        cdSize = u64(eocd64, 40);
        cdOff = u64(eocd64, 48);
      }
    }
    const cd = readAt(fd, cdOff, cdSize);
    const out = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('répertoire du zip abîmé');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      let lho = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1');
      // champ supplémentaire zip64 (0x0001) : tailles / position sur 64 bits, dans l'ordre, seulement celles saturées
      let x = p + 46 + nl;
      const xe = x + xl;
      while (x + 4 <= xe) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; }
          if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; }
          if (lho === 0xffffffff) { lho = u64(cd, q); q += 8; }
        }
        x += 4 + len;
      }
      out.push({ name, method, csize, usize, lho, dir: name.endsWith('/') });
      p = xe + cl;
    }
    return out;
  }

  function safeTarget(dest, name) {
    const t = path.resolve(dest, name.replace(/\\/g, '/'));
    const base = path.resolve(dest) + path.sep;
    if (!(t + (name.endsWith('/') ? path.sep : '')).startsWith(base) && t !== path.resolve(dest)) throw new Error('chemin refusé dans le zip : ' + name);
    return t;
  }

  function writeEntry(zipPath, fd, e, target, onBytes) {
    const h = readAt(fd, e.lho, 30);
    if (h.readUInt32LE(0) !== 0x04034b50) return Promise.reject(new Error('entrée abîmée : ' + e.name));
    const start = e.lho + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.s7part';
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      const fail = (err) => { out.destroy(); try { fs.unlinkSync(tmp); } catch (x) { /* rien */ } reject(err); };
      if (!e.csize) { out.end(); }
      else {
        const src = fs.createReadStream(zipPath, { start, end: start + e.csize - 1, highWaterMark: 1 << 20 });
        src.on('data', (c) => onBytes(c.length));
        src.on('error', fail);
        if (e.method === 0) src.pipe(out);
        else if (e.method === 8) { const inf = zlib.createInflateRaw(); inf.on('error', fail); src.pipe(inf).pipe(out); }
        else return fail(new Error('compression non gérée (' + e.method + ') : ' + e.name));
      }
      out.on('error', fail);
      out.on('finish', () => {
        try {
          try { fs.unlinkSync(target); } catch (x) { /* absent */ }
          fs.renameSync(tmp, target);
          resolve();
        } catch (err) { reject(err); }
      });
    });
  }

  async function extract(zipPath, dest, opts) {
    const o = opts || {};
    const fd = fs.openSync(zipPath, 'r');
    try {
      const entries = directory(fd, fs.fstatSync(fd).size);
      const total = entries.reduce((a, e) => a + e.csize, 0);
      let done = 0;
      let files = 0;
      for (const e of entries) {
        const target = safeTarget(dest, e.name);
        if (e.dir) { fs.mkdirSync(target, { recursive: true }); continue; }
        await writeEntry(zipPath, fd, e, target, (n) => { done += n; if (o.onProgress) o.onProgress(done, total, e.name); });
        files++;
      }
      return { files, bytes: total };
    } finally {
      fs.closeSync(fd);
    }
  }

  const api = { extract, list: (zipPath) => { const fd = fs.openSync(zipPath, 'r'); try { return directory(fd, fs.fstatSync(fd).size); } finally { fs.closeSync(fd); } } };
  root.S7Unzip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
