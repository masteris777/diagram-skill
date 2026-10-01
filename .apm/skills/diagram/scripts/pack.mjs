// Shared by the engine and the icon importers: UserError, zip/folder reading, SVG -> icon record.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class UserError extends Error { constructor(msg, code = 2) { super(Array.isArray(msg) ? msg.join('\n') : msg); this.code = code; } }

export function readZip(file) {                                     // minimal zip reader (stored/deflate) so bare machines need no unzip tool
  const buf = fs.readFileSync(file); let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new UserError(`${file} is not a zip file`, 3);
  const files = new Map(); let p = buf.readUInt32LE(e + 16);
  for (let i = 0, n = buf.readUInt16LE(e + 10); i < n && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (name.endsWith('.svg') && !name.startsWith('__MACOSX')) files.set(name, () => {
      const s = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28), d = buf.subarray(s, s + csize);
      return method === 0 ? d : zlib.inflateRawSync(d);
    });
  }
  return files;
}
export function walkSvg(root) {
  const files = new Map();
  (function rec(dir, rel) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (d.name.startsWith('.') || d.name === '__MACOSX') continue;
      const p = path.join(dir, d.name), r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) rec(p, r); else if (d.name.endsWith('.svg')) files.set(r, () => fs.readFileSync(p));
    }
  })(root, '');
  return files;
}
export const readPack = (src) => (fs.statSync(src).isDirectory() ? walkSvg(src) : readZip(src));   // Map: relative path -> () => Buffer
export function iconFromSvg(raw, k, c) {                                                       // k = service | resource | general | group, c = category label
  const vb = /viewBox="([^"]+)"/.exec(raw)?.[1];
  if (!vb) return null;
  const b = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/>\s+</g, '><').trim();
  return { k, c, vb, b };
}
