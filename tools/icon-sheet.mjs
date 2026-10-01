#!/usr/bin/env node
// Renders a contact sheet (icon + file name) of a folder of .svg icons to PNG, with the vendored resvg and font.
// Usage: node tools/icon-sheet.mjs [icons-dir] [out.png]      default: the generic profile's icons -> examples/generic/icon-sheet.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), SKILL = path.join(ROOT, '.apm', 'skills', 'diagram');
const dir = path.resolve(process.argv[2] ?? path.join(SKILL, 'profiles', 'generic', 'icons'));
const out = path.resolve(process.argv[3] ?? path.join(SKILL, 'examples', 'generic', 'icon-sheet.png'));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();
const COLS = 7, CELL_W = 130, CELL_H = 110, ICON = 56, PAD = 24;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cells = files.map((f, i) => {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8'), vb = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 64 64';
  const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const x = PAD + (i % COLS) * CELL_W, y = PAD + Math.floor(i / COLS) * CELL_H;
  return `<svg x="${x + (CELL_W - ICON) / 2}" y="${y}" width="${ICON}" height="${ICON}" viewBox="${vb}">${body}</svg><text x="${x + CELL_W / 2}" y="${y + ICON + 20}" text-anchor="middle" font-size="14" fill="#000">${esc(f.replace(/\.svg$/, ''))}</text>`;
});
const W = PAD * 2 + COLS * CELL_W, H = PAD * 2 + Math.ceil(files.length / COLS) * CELL_H;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Liberation Sans"><rect width="${W}" height="${H}" fill="#fff"/>${cells.join('')}</svg>`;

const vendor = path.join(SKILL, 'vendor');
const m = await import(pathToFileURL(path.join(vendor, 'resvg-wasm', 'index.mjs')).href);
await m.initWasm(fs.readFileSync(path.join(vendor, 'resvg-wasm', 'index_bg.wasm')));
const fonts = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf'].map((f) => new Uint8Array(fs.readFileSync(path.join(vendor, 'fonts', f))));
const r = new m.Resvg(svg, { background: '#ffffff', fitTo: { mode: 'zoom', value: 2 }, font: { fontBuffers: fonts, defaultFontFamily: 'Liberation Sans' } });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, r.render().asPng());
console.log(`${out}: ${files.length} icons from ${dir}`);
