#!/usr/bin/env node
// Generates the generic icon set (.apm/skills/diagram/profiles/generic/icons/*.svg). The artwork is original to this project (MIT).
// Re-run after editing a glyph:  node tools/make-generic-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.apm', 'skills', 'diagram', 'profiles', 'generic', 'icons');
const COLOR = { compute: '#E8710A', data: '#2F6FDE', storage: '#2E9B4F', integration: '#D6336C', network: '#8C4FFF', security: '#D93A4C', ops: '#0D9488' };
const DARK = '#232F3E';
const dots = (...pts) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#fff" stroke="none"/>`).join('');

// [id, tile colour | null (= dark outline glyph, no tile), glyph markup in a 64 x 64 box]
const ICONS = [
  // people and devices: dark outline glyphs
  ['user', null, '<circle cx="32" cy="21" r="9"/><path d="M13 52c0-11 8.5-17 19-17s19 6 19 17"/>'],
  ['users', null, '<circle cx="24" cy="23" r="8"/><path d="M8 50c0-9 7-14.5 16-14.5S40 41 40 50"/><circle cx="43.5" cy="26" r="6.5"/><path d="M43 36.5c8 0 13 4.5 13 12.5"/>'],
  ['mobile', null, '<rect x="19" y="8" width="26" height="48" rx="5"/><path d="M28 48h8"/>'],
  ['laptop', null, '<rect x="14" y="14" width="36" height="25" rx="3"/><path d="M8 47h48l-4 5H12z"/>'],
  ['browser', null, `<rect x="8" y="12" width="48" height="40" rx="4"/><path d="M8 23h48"/>${['15', '20.5', '26'].map((x) => `<circle cx="${x}" cy="17.5" r="1.3" fill="${DARK}" stroke="none"/>`).join('')}`],
  // compute
  ['server', COLOR.compute, `<rect x="13" y="14" width="38" height="15" rx="3"/><rect x="13" y="35" width="38" height="15" rx="3"/><path d="M31 21.5h14M31 42.5h14"/>${dots([21, 21.5], [21, 42.5])}`],
  ['function', COLOR.compute, '<path d="M25 14c-5 0-6 2-6 6v5c0 3-2 5-5 7 3 2 5 4 5 7v5c0 4 1 6 6 6"/><path d="M39 14c5 0 6 2 6 6v5c0 3 2 5 5 7-3 2-5 4-5 7v5c0 4-1 6-6 6"/>'],
  ['container', COLOR.compute, '<rect x="11" y="19" width="42" height="27" rx="2.5"/><path d="M21 19v27M32 19v27M43 19v27"/>'],
  ['service', COLOR.compute, '<path d="M32 11l18 10v22L32 53 14 43V21z"/><path d="M14 21l18 10 18-10M32 31v22"/>'],
  ['timer', COLOR.compute, '<circle cx="32" cy="35" r="16"/><path d="M32 25v10l7 4M27 12h10M32 12v7"/>'],
  // data and storage
  ['database', COLOR.data, '<ellipse cx="32" cy="17" rx="16" ry="6"/><path d="M16 17v30c0 3.3 7.2 6 16 6s16-2.7 16-6V17"/><path d="M16 32c0 3.3 7.2 6 16 6s16-2.7 16-6"/>'],
  ['cache', COLOR.data, '<path d="M36 10L17 36h14l-3 18 19-26H33z"/>'],
  ['storage', COLOR.storage, '<ellipse cx="32" cy="19" rx="17" ry="6"/><path d="M15 19l4.5 28c.5 3.2 6.5 6 12.5 6s12-2.8 12.5-6L49 19"/>'],
  ['document', COLOR.storage, '<path d="M19 10h18l10 10v34H19z"/><path d="M37 10v10h10"/><path d="M26 32h14M26 39h14M26 46h8"/>'],
  // integration
  ['queue', COLOR.integration, '<rect x="9" y="22" width="13" height="18" rx="2.5"/><rect x="25.5" y="22" width="13" height="18" rx="2.5"/><rect x="42" y="22" width="13" height="18" rx="2.5"/><path d="M12 49h40M46 45l5 4-5 4"/>'],
  ['topic', COLOR.integration, '<circle cx="17" cy="32" r="4.5"/><circle cx="47" cy="16" r="4.5"/><circle cx="47" cy="32" r="4.5"/><circle cx="47" cy="48" r="4.5"/><path d="M21.5 32h21M21 29.5l22-11M21 34.5l22 11"/>'],
  ['mail', COLOR.integration, '<rect x="10" y="17" width="44" height="30" rx="3.5"/><path d="M11 20l21 15 21-15"/>'],
  ['api', COLOR.integration, '<path d="M23 20L11 32l12 12M41 20l12 12-12 12M36 15l-8 34"/>'],
  // network
  ['globe', COLOR.network, '<circle cx="32" cy="32" r="19"/><ellipse cx="32" cy="32" rx="8.5" ry="19"/><path d="M13 32h38M16 22h32M16 42h32"/>'],
  ['cloud', COLOR.network, '<path d="M22 46h22a9 9 0 0 0 1.5-17.9 12 12 0 0 0-23.2-2.3A10.5 10.5 0 0 0 22 46z"/>'],
  ['load-balancer', COLOR.network, '<rect x="9" y="26" width="13" height="12" rx="2.5"/><rect x="42" y="11" width="13" height="11" rx="2.5"/><rect x="42" y="26.5" width="13" height="11" rx="2.5"/><rect x="42" y="42" width="13" height="11" rx="2.5"/><path d="M22 32h8M30 32V16.5h12M30 32h12M30 32v15.5h12"/>'],
  ['router', COLOR.network, '<circle cx="32" cy="32" r="6"/><path d="M32 10v16M26 16l6-6 6 6M32 54V38M26 48l6 6 6-6M10 32h16M16 26l-6 6 6 6M54 32H38M48 26l6 6-6 6"/>'],
  // security and operations
  ['firewall', COLOR.security, '<rect x="11" y="15" width="42" height="34" rx="3"/><path d="M11 26h42M11 38h42M26 15v11M40 26v12M26 38v11"/>'],
  ['lock', COLOR.security, `<rect x="17" y="29" width="30" height="22" rx="3.5"/><path d="M23 29v-6a9 9 0 0 1 18 0v6"/>${dots([32, 38.5])}<path d="M32 40v6"/>`],
  ['key', COLOR.security, '<circle cx="22" cy="32" r="9"/><path d="M31 32h22M45 32v9M52 32v6"/>'],
  ['monitor', COLOR.ops, '<path d="M13 12v38h38"/><path d="M19 41l10-11 8 7 13-17"/>'],
];

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(OUT, f));
for (const [id, tile, glyph] of ICONS) {
  const body = tile
    ? `<rect width="64" height="64" rx="12" fill="${tile}"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`
    : `<g fill="none" stroke="${DARK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`;
  fs.writeFileSync(path.join(OUT, `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>\n`);
}
console.log(`wrote ${ICONS.length} icons to ${OUT}`);
