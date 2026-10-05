#!/usr/bin/env node
// diagram-skill: JSON spec -> ELK layout -> SVG (icons as <symbol>/<use>) -> PNG (resvg-wasm).
// Node >= 18, ESM. Dependencies are vendored in ../vendor (elkjs, resvg-wasm, Liberation Sans): no npm install, no browser, no native code, no network.
// Everything provider specific lives in a profile (../profiles/<name>/profile.mjs): group styles, icon names, where the icons come from.
//   aws      official AWS Architecture Icons; the pack is NOT bundled: `--import-icons <pack folder|zip>` builds a per-user icon store once
//   generic  boxes and arrows with the bundled generic icons (or any folder of SVG icons: --icons-dir)
// Usage: node diagram.mjs spec.json out.png [--svg] [--width N | --scale N] [--profile aws|generic] [--icons file] [--icons-dir dir] [--check]
//        node diagram.mjs --doctor  |  --import-icons <folder|zip>  |  --find <text>  |  --types  |  --version  |  --help
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ELK from '../vendor/elk.bundled.cjs';
import { UserError, readPack, iconFromSvg } from './pack.mjs';

const VERSION = '0.2.0';
const HERE = path.dirname(fileURLToPath(import.meta.url)), SKILL = path.resolve(HERE, '..');

// ======================= 1. look and feel (architecture-diagram house style: light background, 96 dpi, 12 pt labels) =======================
let ICON_PX = { service: 80, resource: 48, general: 48, group: 40 }, GROUP_TYPES = [];   // both are set by the selected profile (loadProfile)
const FONT = 'Liberation Sans', FS = 16, LH = 19;          // 12 pt Arial-compatible labels
const STROKE = 1.67, BADGE_R = 14.4;                        // 1.25 pt lines; small numbered callout (0.30 in)
const DASH = { solid: null, dash: '6.7 5', sysDash: '5 1.7' };
const EDGE_DASH = { solid: null, dashed: '8 5', dotted: '2 4' };
const MARGIN = 24, PAD = 20, HEAD_ICON = 48, HEAD_PLAIN = 40, LABEL_GAP = 4;

// ELK defaults. Everything the agent may want to change is reachable through the spec's "elk" object (see --help).
const ELK_BASE = {
  'elk.algorithm': 'layered', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.separateConnectedComponents': 'false', 'elk.layered.spacing.nodeNodeBetweenLayers': '32', 'elk.spacing.nodeNode': '22',
  'elk.spacing.edgeNode': '12', 'elk.spacing.edgeEdge': '16', 'elk.layered.spacing.edgeNodeBetweenLayers': '10',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '16', 'elk.spacing.labelNode': String(LABEL_GAP),
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.edgeLabels.sideSelection': 'ALWAYS_UP', 'elk.portAlignment.default': 'CENTER', 'elk.json.edgeCoords': 'ROOT', 'elk.json.shapeCoords': 'ROOT',
};

// ======================= 2. small helpers =======================
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v) => Math.round(v * 10) / 10;
const norm = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function suggest(q, cands, n = 5) {                          // nearest names: edit distance + shared words + substring bonus
  const nq = norm(q), qt = new Set(nq.split(' '));
  return cands.map((c) => {
    const nc = norm(c), ct = nc.split(' ');
    const overlap = ct.filter((t) => qt.has(t)).length / Math.max(ct.length, qt.size);
    return [lev(nq, nc) / Math.max(nq.length, nc.length) - 0.5 * overlap - (nc.includes(nq) || nq.includes(nc) ? 0.4 : 0), c];
  }).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1)).slice(0, n).map((x) => x[1]);
}
const quoteList = (l) => l.map((x) => `"${x}"`).join(', ');
const close = (q, list) => suggest(q, list, 1).filter((c) => lev(norm(q), norm(c)) / Math.max(norm(q).length, norm(c).length, 1) <= 0.5)[0];   // a suggestion only when it is really close

// ======================= 3. fonts, resvg-wasm, text measurement =======================
let RS = null;                                              // { Resvg, fonts }
async function initRaster(fontDir) {
  const fonts = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf'].map((f) => {
    const p = path.join(fontDir, f);
    if (!fs.existsSync(p)) throw new UserError(`FONT MISSING: ${p}\n  resvg silently drops all text without a font, so rendering is refused. Restore ${path.join(SKILL, 'vendor', 'fonts')} (it ships with the skill) or pass --font-dir <folder containing ${f}>.`, 3);
    const b = fs.readFileSync(p);
    if (b.length < 50000 || ![0x00010000, 0x4f54544f, 0x74727565].includes(b.readUInt32BE(0))) throw new UserError(`FONT UNUSABLE: ${p} is not a TrueType/OpenType font (${b.length} bytes).`, 3);
    return new Uint8Array(b);
  });
  const dir = path.join(SKILL, 'vendor', 'resvg-wasm');
  let m;
  try { m = await import(pathToFileURL(path.join(dir, 'index.mjs')).href); await m.initWasm(fs.readFileSync(path.join(dir, 'index_bg.wasm'))); }
  catch (e) { throw new UserError(`RESVG / WEBASSEMBLY UNAVAILABLE: ${String(e?.message ?? e).slice(0, 200)}\n  Needs Node >= 18 with WebAssembly enabled and the files in ${dir}.`, 3); }
  RS = { Resvg: m.Resvg, fonts };
  if (textWidth('Hamburgefonstiv') < 50) throw new UserError('FONT CHECK FAILED: resvg measured no text with the bundled font; refusing to render (labels would be invisible).', 3);
}
const mcache = new Map();
function textWidth(text, size = FS, bold = false) {          // width measured by the same engine and font that draws the text
  const key = `${size}|${bold}|${text}`;
  if (!mcache.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="80"><text x="0" y="50" font-family="${FONT}" font-size="${size}"${bold ? ' font-weight="bold"' : ''}>${esc(text)}</text></svg>`;
    const r = new RS.Resvg(svg, { font: { fontBuffers: RS.fonts, defaultFontFamily: FONT } });
    const bb = r.innerBBox(); r.free?.();
    mcache.set(key, bb ? bb.x + bb.width : 0);
  }
  return mcache.get(key);
}
function wrapLabel(label, maxW) {
  const out = [];
  for (const para of String(label).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const c = line ? `${line} ${w}` : w;
      if (!line || textWidth(c) <= maxW) line = c; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
const nodeLines = (label) => { for (const w of [130, 150, 175, 205]) { const l = wrapLabel(label, w); if (l.length <= 2) return l; } return wrapLabel(label, 150); };

// ======================= 4. icon libraries (a profile says where its icons come from; AWS artwork is imported by the user, never bundled) =======================
const displayName = (id) => id.replace(/_/g, ': ').replace(/-/g, ' ');

function userHome() {                                        // per-user data folder: imported icon stores live here, so a skill update never wipes them
  if (process.env.DIAGRAM_SKILL_HOME) return path.resolve(process.env.DIAGRAM_SKILL_HOME);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'diagram-skill');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'diagram-skill');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'diagram-skill');
}
const storeFile = (P, opt) => path.resolve(opt || process.env.DIAGRAM_SKILL_ICONS || path.join(userHome(), `${P.name}-icons.json`));

const PROFILE_DIR = path.join(SKILL, 'profiles');
const profileNames = () => (fs.existsSync(PROFILE_DIR) ? fs.readdirSync(PROFILE_DIR).filter((d) => fs.existsSync(path.join(PROFILE_DIR, d, 'profile.mjs'))).sort() : []);
async function loadProfile(name) {                           // a profile = group styles + icon names + icon source; the engine itself knows no provider
  const n = String(name ?? 'aws').toLowerCase(), have = profileNames();
  if (!have.includes(n)) throw new UserError(`unknown profile "${name}"${suggest(n, have, 1).length ? ` - did you mean "${suggest(n, have, 1)[0]}"?` : ''} (available: ${have.join(', ') || 'none'})`);
  const P = (await import(pathToFileURL(path.join(PROFILE_DIR, n, 'profile.mjs')).href)).default;
  ICON_PX = P.iconPx; GROUP_TYPES = P.groupTypes;
  return P;
}

function libFromFolder(dir) {                                // every .svg with a viewBox becomes an icon; id = file name without extension
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError(`--icons-dir: "${dir}" is not a folder`, 3);
  const icons = {};
  for (const [rel, read] of [...readPack(dir)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const id = rel.split('/').pop().replace(/\.svg$/i, ''); if (icons[id]) continue;
    const ic = iconFromSvg(read().toString('utf8'), 'general', 'Custom'); if (ic) icons[id] = ic;
  }
  if (!Object.keys(icons).length) throw new UserError(`no usable .svg icons (they need a viewBox attribute) in ${dir}`, 3);
  return { icons };
}
function readLibrary(P, f) {                                 // -> { lib: {icons: {id: {k, c, vb, b}}}, from }   order: --icons-dir, --icons / env / per-user store, bundled folder
  if (f['icons-dir']) return { lib: libFromFolder(path.resolve(f['icons-dir'])), from: `folder ${f['icons-dir']}` };
  if (!f.icons && !process.env.DIAGRAM_SKILL_ICONS && P.icons.kind === 'folder') return { lib: libFromFolder(P.icons.dir), from: `bundled with the ${P.name} profile` };
  const file = storeFile(P, f.icons);
  if (!fs.existsSync(file)) throw new UserError(P.setupHelp ? P.setupHelp(file) : `icon store ${file} does not exist`, 3);
  let lib; try { lib = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new UserError(`icon store ${file} is unreadable (${e.message}); re-run --import-icons`, 3); }
  if (!lib.icons) throw new UserError(`icon store ${file} has no "icons" table; re-run --import-icons`, 3);
  return { lib, from: file };
}
function loadIcons(lib, P) {
  const kn = (s) => (P.abbr ?? []).reduce((t, [a, b]) => t.replace(new RegExp(`\\b${a}\\b`, 'g'), b), norm(s));
  const noPrefix = (s) => (P.stripPrefix ? s.replace(P.stripPrefix, '') : s), ALIASES = P.aliases ?? {};
  const exact = new Map(), loose = new Map(), rank = { service: 0, general: 1, resource: 2, group: 3 };
  const put = (m, k, id) => { if (!m.has(k)) m.set(k, []); m.get(k).push(id); };
  const ids = Object.keys(lib.icons).sort();
  for (const id of ids) {
    const k = kn(id.replace(/_/g, ' ')); put(exact, k, id); put(loose, noPrefix(k), id);
    if (id.includes('_')) put(loose, kn(id.split('_').slice(1).join(' ')), id);
  }
  for (const m of [exact, loose]) for (const v of m.values()) v.sort((a, b) => rank[lib.icons[a].k] - rank[lib.icons[b].k]);
  const pick = (ids2) => ids2.filter((i) => lib.icons[i].k !== 'group');
  const resolve = (name) => {
    const q = String(name ?? '').trim(), nq = kn(q), nq2 = kn(q.replace(/\([^)]*generic[^)]*\)/i, ''));
    if (lib.icons[q]) return lib.icons[q].k === 'group' ? null : q;
    for (const k of [nq, nq2]) {
      const a = pick(exact.get(k) ?? []); if (a.length) return a[0];
      const al = ALIASES[k] ?? ALIASES[nq2]; if (al && lib.icons[al]) return al;
    }
    for (const k of [noPrefix(nq), noPrefix(nq2)]) { const l = pick(loose.get(k) ?? []); if (l.length === 1) return l[0]; if (l.length > 1) return { ambiguous: l.slice(0, 6).map(displayName) }; }
    return null;
  };
  return { lib, ids, resolve, kn, names: ids.filter((i) => lib.icons[i].k !== 'group').map(displayName), example: P.exampleIcon ?? displayName(ids[0]), profile: P.name };
}

// ======================= 5. spec -> validated model (all problems reported at once) =======================
function checkKeys(o, allowed, where, err) {
  for (const k of Object.keys(o)) {
    if (allowed.includes(k) || k.startsWith('_') || ['comment', 'note', '$schema'].includes(k)) continue;
    const s = suggest(k, allowed, 1)[0];
    err(`${where}: unknown key "${k}"${s ? ` (did you mean "${s}"?)` : ''}. Allowed: ${allowed.join(', ')}`);
  }
}
function resolveGroupType(t) {
  const q = norm(t ?? 'generic');
  return GROUP_TYPES.find((g) => norm(g.name) === q || (g.alias ?? []).includes(q));
}
function parseEdgeStyle(e, where, err) {
  const s = String(e.style ?? 'solid').toLowerCase();
  const line = /dott/.test(s) ? 'dotted' : /dash/.test(s) ? 'dashed' : 'solid';
  let arrows = /no arrow|noarrow|without arrow|\bnone\b|no head/.test(s) ? 'none' : /both|bidirectional|<->|two/.test(s) ? 'both' : 'end';
  if (!/solid|dash|dott|arrow|both|none|no head|<->/.test(s)) err(`${where}: style "${e.style}" not understood. Use "solid" | "dashed" | "dotted" (add "no arrowhead" or "both ends", or set "arrows": "none"|"both"|"start"|"end")`);
  if (e.arrows !== undefined) { if (['end', 'start', 'both', 'none'].includes(e.arrows)) arrows = e.arrows; else err(`${where}: "arrows" must be end | start | both | none`); }
  return { line, arrows };
}
function breakCycles(E) {                                    // edges that close a cycle (in spec order) are laid out reversed and drawn pointing backwards
  const adj = new Map(), add = (u, v) => adj.set(u, [...(adj.get(u) ?? []), v]);
  const reach = (a, b) => { const seen = new Set([a]), st = [a]; while (st.length) { const x = st.pop(); if (x === b) return true; for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y); } } return false; };
  for (const e of E) if (e.back) add(e.to, e.from);
  for (const e of E) { if (e.back || e.from === e.to) continue; if (reach(e.to, e.from)) { e.back = true; e.autoBack = true; } add(e.back ? e.to : e.from, e.back ? e.from : e.to); }
}
function parseFrame(f, err) {                              // what the picture must fit: target aspect ratio (default 4:3) and optional hard limits in layout px (16 px text = 12 pt at 100 %)
  const fr = { given: f !== undefined, intent: '', aspect: 4 / 3, aspectText: '4:3', tol: 0.25, maxWidth: null, maxHeight: null };
  if (f === undefined) return fr;
  if (!isObj(f)) { err('"frame" must be an object, e.g. {"intent": "fits a portrait page", "aspect": "4:3", "maxWidth": 1400}'); return fr; }
  checkKeys(f, ['intent', 'aspect', 'tolerance', 'maxWidth', 'maxHeight'], 'frame', err);
  if (f.intent !== undefined) fr.intent = String(f.intent);
  if (f.aspect !== undefined) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(f.aspect));
    if (String(f.aspect).toLowerCase() === 'any') { fr.aspect = null; fr.aspectText = 'any'; }
    else if (typeof f.aspect === 'number' && f.aspect > 0) { fr.aspect = f.aspect; fr.aspectText = `${f.aspect}:1`; }
    else if (m && +m[1] > 0 && +m[2] > 0) { fr.aspect = m[1] / m[2]; fr.aspectText = `${m[1]}:${m[2]}`; }
    else err(`frame.aspect ${JSON.stringify(f.aspect)}: use "W:H" such as "4:3", "16:9" or "1:1", a number (width / height), or "any"`);
  }
  if (f.tolerance !== undefined) { if (typeof f.tolerance === 'number' && f.tolerance >= 0 && f.tolerance <= 2) fr.tol = f.tolerance; else err('frame.tolerance must be a number from 0 to 2 (0.25 = within 25 % of the aspect)'); }
  for (const k of ['maxWidth', 'maxHeight']) if (f[k] !== undefined) { if (Number.isFinite(f[k]) && f[k] >= 200) fr[k] = f[k]; else err(`frame.${k} must be a number of layout px, at least 200 (16 px text = 12 pt when the picture is shown at 100 %)`); }
  return fr;
}
function frameCheck(W, H, fr) {                              // -> { cost, ok, text }: how far the picture is from its frame
  const a = W / H, out = [];
  let cost = 0, ok = true;
  if (fr.aspect) {
    const off = Math.abs(Math.log(a / fr.aspect)) - Math.log(1 + fr.tol);
    if (off > 0) { cost += off * 500; ok = false; out.push(`aspect ${a.toFixed(2)}:1 is ${a > fr.aspect ? 'wider' : 'taller'} than ${fr.aspectText} (${fr.aspect.toFixed(2)}:1, within ${Math.round(fr.tol * 100)}%)`); }
  }
  if (fr.maxWidth && W > fr.maxWidth) { cost += 300 + (W - fr.maxWidth) / 2; ok = false; out.push(`width ${W} px is over maxWidth ${fr.maxWidth}`); }
  if (fr.maxHeight && H > fr.maxHeight) { cost += 300 + (H - fr.maxHeight) / 2; ok = false; out.push(`height ${H} px is over maxHeight ${fr.maxHeight}`); }
  return { cost, ok, text: out.join('; ') };
}
function buildModel(spec, icons) {
  const errs = [], warns = [], err = (m) => errs.push(m);
  if (!isObj(spec)) throw new UserError('spec must be a JSON object: {"title":"...","direction":"RIGHT","groups":[...],"nodes":[...],"edges":[...]}');
  checkKeys(spec, ['title', 'profile', 'direction', 'frame', 'groups', 'nodes', 'edges', 'elk'], 'spec', err);
  const frame = parseFrame(spec.frame, err);
  const arr = (k) => { const v = spec[k] ?? []; if (!Array.isArray(v)) { err(`"${k}" must be an array`); return []; } return v; };
  const dirs = { right: 'RIGHT', lr: 'RIGHT', left: 'LEFT', rl: 'LEFT', down: 'DOWN', tb: 'DOWN', up: 'UP', bt: 'UP' };
  let direction = dirs[String(spec.direction ?? 'RIGHT').toLowerCase()];
  if (!direction) { err(`direction "${spec.direction}" must be RIGHT, LEFT, DOWN or UP`); direction = 'RIGHT'; }
  const kind = new Map(), G = [], N = [], E = [];
  const takeId = (o, where, what) => {
    if (typeof o.id !== 'string' || !o.id.trim()) { err(`${where}: "id" must be a non-empty string`); return null; }
    if (kind.has(o.id)) { err(`${where}: duplicate id "${o.id}" (already used by a ${kind.get(o.id)})`); return null; }
    kind.set(o.id, what); return o.id;
  };
  const elkOpts = (o, where) => { if (o.elk === undefined) return {}; if (!isObj(o.elk)) { err(`${where}: "elk" must be an object of ELK options`); return {}; } return Object.fromEntries(Object.entries(o.elk).map(([k, v]) => [k, String(v)])); };
  const borderOf = (o, where) => { if (o.border === undefined) return null; if (!['left', 'right', 'top', 'bottom'].includes(o.border) || !(o.group ?? o.parent)) { err(`${where}: "border" must be left | right | top | bottom and the node needs a "group" (the icon is centred on that border of its group, e.g. an internet gateway on the VPC edge)`); return null; } return o.border; };
  const rankOf = (o, where) => { if (o.rank === undefined) return null; if (!Number.isInteger(o.rank) || o.rank < 0) { err(`${where}: "rank" must be a non-negative integer (column index inside its parent), got ${JSON.stringify(o.rank)}`); return null; } return o.rank; };
  arr('groups').forEach((g, i) => {
    const where = `groups[${i}]${isObj(g) && g.id ? ` ("${g.id}")` : ''}`;
    if (!isObj(g)) return err(`${where}: must be an object {id, label, type, parent}`);
    checkKeys(g, ['id', 'label', 'type', 'parent', 'group', 'rank', 'elk'], where, err);
    const id = takeId(g, where, 'group'); if (!id) return;
    const t = resolveGroupType(g.type);
    if (!t) err(`${where}: unknown group type "${g.type}" - did you mean ${quoteList(suggest(g.type, GROUP_TYPES.map((x) => x.name), 3))}? (all: ${GROUP_TYPES.map((x) => x.name).join(', ')})`);
    G.push({ id, label: String(g.label ?? t?.name ?? id), t: t ?? GROUP_TYPES[0], parent: g.parent ?? g.group ?? null, rank: rankOf(g, where), elk: elkOpts(g, where), where });
  });
  arr('nodes').forEach((n, i) => {
    const where = `nodes[${i}]${isObj(n) && n.id ? ` ("${n.id}")` : ''}`;
    if (!isObj(n)) return err(`${where}: must be an object {id, label, icon, group}`);
    checkKeys(n, ['id', 'label', 'icon', 'group', 'parent', 'rank', 'border', 'elk'], where, err);
    const id = takeId(n, where, 'node'); if (!id) return;
    let icon = null, box = false;
    if (n.icon === undefined || n.icon === null) err(`${where}: missing "icon" (an icon name, e.g. "${icons.example}"; use "box" for a plain labelled box; search with --find <text>)`);
    else if (String(n.icon).toLowerCase() === 'box') box = true;
    else {
      const r = icons.resolve(n.icon);
      if (typeof r === 'string') icon = r;
      else if (r?.ambiguous) err(`${where}: icon "${n.icon}" is ambiguous: ${quoteList(r.ambiguous)}. Use the full name.`);
      else err(`${where}: unknown icon "${n.icon}" - nearest: ${quoteList(suggest(n.icon, icons.names, 5))}. (search: node scripts/diagram.mjs --find "${String(n.icon).split(/\s+/)[0]}" --profile ${icons.profile})`);
    }
    const kindOf = icon ? icons.lib.icons[icon].k : 'resource';
    N.push({ id, label: String(n.label ?? (icon ? displayName(icon) : id)), icon, box, size: box ? ICON_PX.service : ICON_PX[kindOf], parent: n.group ?? n.parent ?? null, rank: rankOf(n, where), border: borderOf(n, where), elk: elkOpts(n, where), where });
  });
  const gIds = new Set(G.map((g) => g.id)), nIds = N.map((n) => n.id);
  for (const o of [...G, ...N]) if (o.parent != null && !gIds.has(o.parent)) {
    err(`${o.where}: ${kind.has(o.parent) ? `"${o.parent}" is a node, not a group` : `unknown group "${o.parent}"${close(o.parent, [...gIds]) ? ` - did you mean "${close(o.parent, [...gIds])}"?` : ''}`} (groups: ${[...gIds].join(', ') || 'none defined'})`);
    o.parent = null;
  }
  const gp = new Map(G.map((g) => [g.id, g.parent]));
  for (const g of G) { const seen = new Set([g.id]); for (let p = g.parent; p; p = gp.get(p)) { if (seen.has(p)) { err(`${g.where}: group nesting forms a cycle through "${p}"`); g.parent = null; break; } seen.add(p); } }
  const endpoint = (v, side, where) => {
    if (typeof v !== 'string' || !kind.has(v)) { const all = [...kind.keys()]; err(`${where}: unknown "${side}" id ${JSON.stringify(v)}${typeof v === 'string' && close(v, all) ? ` - did you mean "${close(v, all)}"?` : ''} (known ids: ${all.slice(0, 12).join(', ')}${all.length > 12 ? ', ...' : ''})`); return false; }
    return true;
  };
  arr('edges').forEach((e, i) => {
    const where = `edges[${i}]`;
    if (!isObj(e)) return err(`${where}: must be an object {from, to, label, style, step}`);
    checkKeys(e, ['from', 'to', 'source', 'target', 'label', 'style', 'step', 'arrows', 'back', 'elk'], where, err);
    const from = e.from ?? e.source, to = e.to ?? e.target, w = `${where} (${from} -> ${to})`;
    const ok = endpoint(from, 'from', w) & endpoint(to, 'to', w);
    const st = parseEdgeStyle(e, w, err);
    let step = null;
    if (e.step !== undefined && e.step !== null && e.step !== '') { step = Number(e.step); if (!Number.isInteger(step) || step < 1) { err(`${w}: "step" must be a positive integer, got ${JSON.stringify(e.step)}`); step = null; } }
    if (ok) E.push({ id: `e${i}`, from, to, label: e.label == null ? '' : String(e.label), ...st, step, back: e.back === true, elk: elkOpts(e, w) });
  });
  if (!N.length && !errs.length) err('"nodes" is empty: nothing to draw');
  breakCycles(E);
  const steps = [...new Set(E.map((e) => e.step).filter(Boolean))].sort((a, b) => a - b);
  if (steps.length && (steps[0] !== 1 || steps.some((s, i) => i && s !== steps[i - 1] + 1))) warns.push(`step numbers are not contiguous from 1: ${steps.join(', ')}`);
  for (const n of N) if (!E.some((e) => e.from === n.id || e.to === n.id)) warns.push(`node "${n.id}" has no edges`);
  if (errs.length) throw new UserError([`SPEC HAS ${errs.length} ERROR${errs.length > 1 ? 'S' : ''}:`, ...errs.map((m) => `  - ${m}`)]);
  void nIds;
  return { direction, frame, title: spec.title ? String(spec.title) : '', G, N, E, warns, elk: elkOpts(spec, 'spec') };
}

// ======================= 6. layout: ELK on several seeds -> scene -> own routing for stacked-group edges -> a cost function picks the best =======================
const labelOpt = { 'elk.nodeLabels.placement': '[H_CENTER, V_BOTTOM, OUTSIDE]' };
const labelBox = (m) => {                                    // size of [numbered badge] + wrapped text
  const lines = m.label ? wrapLabel(m.label, 140) : [], tw = lines.length ? Math.max(...lines.map((l) => textWidth(l))) : 0;
  return { lines, w: Math.ceil((m.step ? 2 * BADGE_R + (lines.length ? 5 : 0) : 0) + tw + (lines.length ? 8 : 0)), h: Math.max(m.step ? 2 * BADGE_R + 2 : 0, lines.length * LH + 2) };
};
function stackedEdges(M) {                                   // edges between two sibling groups that share a rank (= stacked in one column): ELK would split the column, the kit routes them
  const parent = new Map([...M.G, ...M.N].map((o) => [o.id, o.parent])), gById = new Map(M.G.map((g) => [g.id, g]));
  const chain = (id) => { const c = [id]; for (let p = parent.get(id); p; p = parent.get(p)) c.unshift(p); return c; };
  const out = new Set();
  for (const e of M.E) {
    const a = chain(e.from), b = chain(e.to); let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const ga = gById.get(a[i]), gb = gById.get(b[i]);
    if (!gById.has(e.from) && !gById.has(e.to) && ga && gb && ga.rank != null && ga.rank === gb.rank) out.add(e.id);
  }
  return out;
}
async function elkRun(M, icons, skip, seed, debugBase, { free, ...place } = {}) {   // free: no fixed attachment points (ELK spreads lines over the side)
  const rootOpts = { ...ELK_BASE, ...place, 'elk.direction': M.direction, 'elk.randomSeed': String(seed), ...M.elk };
  const inherit = Object.fromEntries(Object.entries(rootOpts).filter(([k]) => /spacing|portAlignment|crossingMinimization|nodePlacement|edgeLabels|randomSeed/.test(k)));   // elkjs does not pass root options to nested compound graphs: copy them down
  const mk = new Map();
  for (const g of M.G) {
    const hasIcon = g.t.icon && icons.lib.icons[g.t.icon], lw = textWidth(g.label), head = hasIcon ? HEAD_ICON : HEAD_PLAIN;
    mk.set(g.id, { id: g.id, children: [], _g: g, _icon: !!hasIcon, layoutOptions: { 'elk.padding': `[top=${head},left=${PAD},bottom=${PAD},right=${PAD}]`,
      'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': `(${Math.ceil(hasIcon ? 52.8 + lw + 16 : lw + 32)},${head + 16})`, ...inherit, ...g.elk } });
  }
  const ports = !free && (M.direction === 'RIGHT' || M.direction === 'LEFT');   // DOWN/UP: the label sits under the icon, where a port would be
  for (const n of M.N) {
    const lines = nodeLines(n.label), lw = Math.ceil(Math.max(...lines.map((l) => textWidth(l))));
    mk.set(n.id, { id: n.id, width: n.size, height: n.size, _n: n, _lines: lines, labels: [{ text: n.label, width: lw, height: lines.length * LH, layoutOptions: labelOpt }], layoutOptions: { ...labelOpt, ...n.elk } });
    if (ports) {                                             // one attachment point in the middle of the in-side and one of the out-side: lines leave an icon from its centre line and fan out from there
      const r = M.direction === 'RIGHT', h = n.size / 2;
      const back = Math.min(n.size - 2, Math.max(h + 20, Math.round(n.size * 0.8)));   // return lines get their own points below the centre, so they never merge with the main flow
      mk.get(n.id).ports = [{ id: `${n.id}.in`, x: r ? 0 : n.size, y: h, width: 0, height: 0, layoutOptions: { 'elk.port.side': r ? 'WEST' : 'EAST' } },
        { id: `${n.id}.out`, x: r ? n.size : 0, y: h, width: 0, height: 0, layoutOptions: { 'elk.port.side': r ? 'EAST' : 'WEST' } },
        { id: `${n.id}.bin`, x: r ? 0 : n.size, y: back, width: 0, height: 0, layoutOptions: { 'elk.port.side': r ? 'WEST' : 'EAST' } },
        { id: `${n.id}.bout`, x: r ? n.size : 0, y: back, width: 0, height: 0, layoutOptions: { 'elk.port.side': r ? 'EAST' : 'WEST' } }];
      Object.assign(mk.get(n.id).layoutOptions, { 'elk.portConstraints': 'FIXED_POS', 'elk.alignment': 'CENTER' });
    }
  }
  const root = { id: 'root', children: [], edges: [], layoutOptions: { ...rootOpts, 'elk.padding': `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]` } };
  for (const o of [...M.G, ...M.N]) {
    const host = o.parent ? mk.get(o.parent) : root;
    host.children.push(mk.get(o.id));
    if (o.rank != null) { mk.get(o.id).layoutOptions['elk.partitioning.partition'] = String(o.rank); host.layoutOptions['elk.partitioning.activate'] = 'true'; }   // rank = column band inside the parent
  }
  for (const g of M.G) if (!mk.get(g.id).children.length) Object.assign(mk.get(g.id), { width: 160, height: 90 });
  for (const e of M.E) {
    if (skip.has(e.id)) continue;
    const src = e.back ? e.to : e.from, tgt = e.back ? e.from : e.to, port = (id, side) => (ports && mk.get(id)?._n ? `${id}.${e.back ? 'b' : ''}${side}` : id);
    const el = { id: e.id, sources: [port(src, 'out')], targets: [port(tgt, 'in')], _e: e, layoutOptions: { ...e.elk } }, lb = labelBox(e);
    if (e.label || e.step) el.labels = [{ id: `${e.id}_l`, text: e.label, width: lb.w, height: lb.h, layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }];
    root.edges.push(el);
  }
  const strip = (k, v) => (k.startsWith('_') ? undefined : v);
  if (debugBase) fs.writeFileSync(`${debugBase}.elk-in.json`, JSON.stringify(root, strip, 1));
  let laid;
  try { laid = await new ELK().layout(root); } catch (e) {
    throw new UserError([`ELK layout failed: ${String(e?.message ?? e).slice(0, 300)}`, '  Hints: check for edges whose endpoint is an ancestor/descendant group of the other; remove spec.elk / node.elk overrides; try "direction": "DOWN".'], 4);
  }
  if (debugBase) fs.writeFileSync(`${debugBase}.elk-out.json`, JSON.stringify(laid, strip, 1));
  return laid;
}
function toScene(laid) {                                     // flat, absolute geometry: groups (parents first), nodes, edges {m, pts, rev, label}
  const S = { W: Math.ceil(laid.width), H: Math.ceil(laid.height), groups: [], nodes: [], edges: [] };
  (function walk(n) {
    for (const c of n.children ?? []) {
      if (c._g) S.groups.push({ g: c._g, icon: c._icon, x: c.x, y: c.y, w: c.width, h: c.height });
      else if (c._n) S.nodes.push({ n: c._n, lines: c._lines, x: c.x, y: c.y, w: c.width, h: c.height, lw: Math.max(...c._lines.map((l) => textWidth(l))) });
      walk(c);
    }
  })(laid);
  for (const e of laid.edges ?? []) {
    const s = e.sections?.[0], l = e.labels?.[0]; if (!s) continue;
    S.edges.push({ m: e._e, rev: !!e._e.back, pts: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y })), label: l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null });
  }
  return S;
}

// ----- own orthogonal router (A* over the grid lines through both end points) for the edges ELK cannot route inside a stacked column -----
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const sidesOf = (nd) => {                                    // attachment points on the icon; a south attachment starts below the label
  const s = nd.n.size, cx = nd.x + s / 2, cy = nd.y + s / 2, lb = nd.y + s + LABEL_GAP + nd.lines.length * LH;
  return [{ x: nd.x + s, y: cy, d: 0 }, { x: cx, y: lb + 3, d: 1 }, { x: nd.x, y: cy, d: 2 }, { x: cx, y: nd.y, d: 3 }];
};
function astar(S, obst, a, b, trunk = () => false, pad = 120) {   // trunk(e): lines this one may share a track with (same start or end point); pad: how far the search may stray beyond the two ends
  const G = 12, TURN = 30;
  const lines = (c1, c2, lo, hi) => { const set = new Set(); for (const c of [c1, c2]) for (let v = c - Math.floor((c - lo) / G) * G; v <= hi; v += G) set.add(r1(v)); return [...set].sort((p, q) => p - q); };
  const xs = lines(a.x, b.x, Math.max(0, Math.min(a.x, b.x) - pad), Math.min(S.W, Math.max(a.x, b.x) + pad));
  const ys = lines(a.y, b.y, Math.max(0, Math.min(a.y, b.y) - pad), Math.min(S.H, Math.max(a.y, b.y) + pad));
  const ny = ys.length, blocked = new Uint8Array(xs.length * ny);
  for (const [x0, y0, x1, y1] of obst) for (let i = 0; i < xs.length; i++) if (xs[i] > x0 && xs[i] < x1) for (let j = 0; j < ny; j++) if (ys[j] > y0 && ys[j] < y1) blocked[i * ny + j] = 1;
  const penV = new Uint8Array(xs.length * ny), penH = new Uint8Array(xs.length * ny);   // vertices lying on a group border: running ALONG a border looks like a second border
  for (const g of S.groups) for (let i = 0; i < xs.length; i++) for (let j = 0; j < ny; j++) {
    if ((Math.abs(xs[i] - g.x) < 4 || Math.abs(xs[i] - g.x - g.w) < 4) && ys[j] > g.y - 1 && ys[j] < g.y + g.h + 1) penV[i * ny + j] = 1;
    if ((Math.abs(ys[j] - g.y) < 4 || Math.abs(ys[j] - g.y - g.h) < 4) && xs[i] > g.x - 1 && xs[i] < g.x + g.w + 1) penH[i * ny + j] = 1;
  }
  const onSeg = new Uint8Array(xs.length * ny);               // vertices on an already drawn edge: avoid sharing a track
  for (const e of S.edges) if (!trunk(e)) for (let k = 1; k < e.pts.length; k++) {
    const p = e.pts[k - 1], q = e.pts[k];
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < ny; j++) {
      const vert = Math.abs(p.x - q.x) < 1 && Math.abs(xs[i] - p.x) < 10 && ys[j] >= Math.min(p.y, q.y) - 1 && ys[j] <= Math.max(p.y, q.y) + 1, hor = Math.abs(p.y - q.y) < 1 && Math.abs(ys[j] - p.y) < 10 && xs[i] >= Math.min(p.x, q.x) - 1 && xs[i] <= Math.max(p.x, q.x) + 1;
      if (vert || hor) onSeg[i * ny + j] = Math.max(onSeg[i * ny + j], (vert ? Math.abs(xs[i] - p.x) : Math.abs(ys[j] - p.y)) < 2 ? 2 : 1);
    }
  }
  const ia = xs.indexOf(r1(a.x)), ja = ys.indexOf(r1(a.y)), ib = xs.indexOf(r1(b.x)), jb = ys.indexOf(r1(b.y));
  const goalDir = (b.d + 2) % 4, heap = [], dist = new Map(), prev = new Map();
  const push = (f, st) => { heap.push([f, st]); let i = heap.length - 1; while (i && heap[(i - 1) >> 1][0] > heap[i][0]) { [heap[i], heap[(i - 1) >> 1]] = [heap[(i - 1) >> 1], heap[i]]; i = (i - 1) >> 1; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const st0 = (ia * ny + ja) * 4 + a.d; dist.set(st0, 0); push(0, st0);
  for (let n = 0; heap.length && n < 400000; n++) {
    const [, st] = pop(), dir = st % 4, v = (st - dir) / 4, i = Math.floor(v / ny), j = v % ny, g = dist.get(st);
    if (i === ib && j === jb && dir === goalDir) {
      const pts = []; for (let s = st; s !== undefined; s = prev.get(s)) { const d = s % 4, vv = (s - d) / 4; pts.push({ x: xs[Math.floor(vv / ny)], y: ys[vv % ny] }); }
      pts.reverse(); return { cost: g, pts: pts.filter((p, k) => k === 0 || k === pts.length - 1 || !((pts[k - 1].x === p.x && p.x === pts[k + 1].x) || (pts[k - 1].y === p.y && p.y === pts[k + 1].y))) };
    }
    for (const nd of [dir, (dir + 1) % 4, (dir + 3) % 4]) {
      if (v === ia * ny + ja && nd !== a.d) continue;          // leave the start node straight out
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1]; if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ny || blocked[ni * ny + nj]) continue;
      const ng = g + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nd === dir ? 0 : TURN) + ((nd % 2 ? penV : penH)[ni * ny + nj] ? 25 : 0) + onSeg[ni * ny + nj] * 14, ns = (ni * ny + nj) * 4 + nd;
      if (ng < (dist.get(ns) ?? Infinity)) { dist.set(ns, ng); prev.set(ns, st); push(ng + Math.abs(xs[ni] - b.x) + Math.abs(ys[nj] - b.y), ns); }
    }
  }
  return null;
}
function obstacles(S, skipA, skipB) {                       // rectangles lines and labels must keep out of: icons, node labels, group headers
  const o = [];
  for (const n of S.nodes) {
    const own = n === skipA || n === skipB, m = own ? 0 : 8, s = n.n.size;
    o.push([n.x - m, n.y - m, n.x + s + m, n.y + s + m], [n.x + s / 2 - n.lw / 2 - (own ? 0 : 4), n.y + s, n.x + s / 2 + n.lw / 2 + (own ? 0 : 4), n.y + s + LABEL_GAP + n.lines.length * LH + (own ? 0 : 4)]);
  }
  for (const g of S.groups) { const tw = textWidth(g.g.label); o.push(g.icon ? [g.x, g.y, g.x + 52.8 + tw + 10, g.y + HEAD_ICON - 4] : [g.x + g.w / 2 - tw / 2 - 6, g.y, g.x + g.w / 2 + tw / 2 + 6, g.y + HEAD_PLAIN - 4]); }   // the whole header band: no line squeezes between title and content
  return o;
}
function snapToBorders(S) {                                  // node {border:'left'} sits centred on the border of its group; its edge ends move with it
  for (const nd of S.nodes) {
    const side = nd.n.border, g = side && S.groups.find((x) => x.g.id === nd.n.parent); if (!g) continue;
    const s = nd.n.size, dx = side === 'left' ? g.x - s / 2 - nd.x : side === 'right' ? g.x + g.w - s / 2 - nd.x : 0, dy = side === 'top' ? g.y - s / 2 - nd.y : side === 'bottom' ? g.y + g.h - s / 2 - nd.y : 0;
    nd.x += dx; nd.y += dy;
    for (const e of S.edges) for (const [pi, adj, who] of [[0, 1, e.rev ? e.m.to : e.m.from], [e.pts.length - 1, e.pts.length - 2, e.rev ? e.m.from : e.m.to]]) {
      if (who !== nd.n.id) continue;
      const p = e.pts[pi], q = e.pts[adj], hor = Math.abs(p.y - q.y) < 0.5, sg = Math.sign(q.x - p.x);
      p.x += dx; p.y += dy;
      if (hor && dy) q.y += dy; if (!hor && dx) q.x += dx;
      if (hor && sg && Math.sign(q.x - p.x) !== sg) { const nx = p.x + sg * 14, r = e.pts[adj + (adj - pi)]; if (r && Math.abs(r.x - q.x) < 0.5) r.x = nx; q.x = nx; }   // keep the last segment pointing the right way
    }
  }
}
function routeStacked(S, M, ids) {
  const byId = new Map(S.nodes.map((n) => [n.n.id, n]));
  for (const e of M.E.filter((x) => ids.has(x.id))) {
    const A = byId.get(e.from), B = byId.get(e.to); if (!A || !B) continue;
    const near = (sides, dx, dy) => [...sides].sort((p, q) => (DIRS[q.d][0] * dx + DIRS[q.d][1] * dy) - (DIRS[p.d][0] * dx + DIRS[p.d][1] * dy)).slice(0, 2);
    const dx = B.x - A.x, dy = B.y - A.y, obst = obstacles(S, A, B);
    let best = null;
    const taken = S.edges.flatMap((x) => [x.pts[0], x.pts[x.pts.length - 1]]), isTaken = (p) => taken.some((q) => Math.abs(q.x - p.x) < 8 && Math.abs(q.y - p.y) < 8);
    const free = (sd) => { const off = sd.d % 2 ? [0, 18, -18].map((o) => ({ ...sd, x: sd.x + o })) : [0, 12, -12].map((o) => ({ ...sd, y: sd.y + o })); return off.find((p) => !isTaken(p)) ?? sd; };   // do not share an attachment point with another edge
    for (const s of near(sidesOf(A), dx, dy).map(free)) for (const t of near(sidesOf(B), -dx, -dy).map(free)) { const r = astar(S, obst, s, t); if (r && (!best || r.cost < best.cost)) best = r; }
    if (!best) { console.error(`warning: could not route stacked edge ${e.from} -> ${e.to}; drawn as a straight line`); best = { pts: [sidesOf(A)[0], sidesOf(B)[2]] }; }
    S.edges.push({ m: e, rev: false, pts: best.pts, label: null });
  }
  S.edges.sort((p, q) => Number(p.m.id.slice(1)) - Number(q.m.id.slice(1)));
}
const routeShape = (pts) => {                                // real bends (straight-through points ignored), length, and the distance between the ends
  const s = segsOf({ pts }).filter((x) => x.len >= 0.5), p = pts[0], q = pts[pts.length - 1];
  return { bends: s.filter((x, i) => i && x.hor !== s[i - 1].hor).length, len: s.reduce((t, x) => t + x.len, 0), dist: Math.abs(p.x - q.x) + Math.abs(p.y - q.y), segs: s };
};
const crossingsWith = (segs, S, self) => S.edges.filter((o) => o !== self).flatMap((o) => segsOf(o)).reduce((t, b) => t + segs.filter((a) => a.hor !== b.hor && (a.hor
  ? b.x0 > a.x0 + 1 && b.x0 < a.x1 - 1 && a.y0 > b.y0 + 1 && a.y0 < b.y1 - 1 : a.x0 > b.x0 + 1 && a.x0 < b.x1 - 1 && b.y0 > a.y0 + 1 && b.y0 < a.y1 - 1)).length, 0);
function reroute(S, M) {                                     // lines ELK sends on a detour (more than two bends, or much longer than needed) get our own A* route, kept only when it is simpler
  const byId = new Map(S.nodes.map((n) => [n.n.id, n])), out = { RIGHT: 0, DOWN: 1, LEFT: 2, UP: 3 }[M.direction], done = new Set();
  for (const se of [...S.edges]) {
    const A = byId.get(se.m.from), B = byId.get(se.m.to);
    if (!A || !B || A === B || se.m.back || A.n.border || B.n.border) continue;
    const old = routeShape(se.pts); if (old.bends <= 2 && old.len <= 1.4 * old.dist + 120) continue;
    const at = S.edges.indexOf(se); S.edges.splice(at, 1);
    const obst = obstacles(S, A, B), oldScore = old.bends * 60 + old.len + crossingsWith(old.segs, S, se) * 150; let best = null;
    for (const inSide of [(out + 2) % 4, (out + 1) % 4, (out + 3) % 4].filter((d) => d !== 1)) {   // never into the bottom: the label is there
      const r = astar(S, obst, sidesOf(A)[out], sidesOf(B)[inSide], (o) => !o.m.back && o.m.line === se.m.line && (o.m.from === se.m.from || o.m.to === se.m.to)); if (!r) continue;
      const sh = routeShape(r.pts), score = sh.bends * 60 + sh.len + crossingsWith(sh.segs, S, se) * 150;   // a bend costs about 60 px of line, a crossing 150
      if (sh.bends < old.bends && score < oldScore && (!best || score < best.score)) best = { pts: r.pts, score };
    }
    S.edges.splice(at, 0, se);
    if (best) { se.pts = best.pts; se.label = null; done.add(se.m.id); }
  }
  return done;
}
function placeLabels(S, ids) {                               // own label placement: next to the longest free segment (used for routed edges and when ELK reports a label far from its edge)
  const avoid = obstacles(S, null, null);
  for (const se of S.edges) if (se.label && !ids.has(se.m.id)) avoid.push([se.label.x, se.label.y, se.label.x + se.label.w, se.label.y + se.label.h]);
  for (const g of S.groups) avoid.push([g.x - 2, g.y - 2, g.x + g.w + 2, g.y + 2], [g.x - 2, g.y + g.h - 2, g.x + g.w + 2, g.y + g.h + 2], [g.x - 2, g.y, g.x + 2, g.y + g.h], [g.x + g.w - 2, g.y, g.x + g.w + 2, g.y + g.h]);   // group borders
  const all = S.edges.flatMap((e) => segsOf(e).filter((s) => s.len >= 0.5));
  for (const se of S.edges.filter((x) => ids.has(x.m.id))) {
    const lb = labelBox(se.m); if (!lb.w) continue;
    const others = all.filter((s) => s.e !== se).map((s) => [s.x0 - 2, s.y0 - 2, s.x1 + 2, s.y1 + 2]);
    const shared = (s) => all.some((o) => o.e !== se && o.hor === s.hor && (s.hor ? Math.abs(o.y0 - s.y0) < 2 && Math.min(o.x1, s.x1) - Math.max(o.x0, s.x0) > 10 : Math.abs(o.x0 - s.x0) < 2 && Math.min(o.y1, s.y1) - Math.max(o.y0, s.y0) > 10));
    // a label belongs on its line's own horizontal stretch: rank segments by length, vertical and shared (trunk) ones much lower; try the middle first, then along the segment
    const segs = segsOf(se).filter((s) => s.len >= 0.5).map((s) => ({ ...s, score: s.len * (s.hor ? 1 : 0.35) * (shared(s) ? 0.25 : 1) })).sort((u, v) => v.score - u.score);
    const cands = [];
    for (const sg of segs) for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
      const mx = sg.x0 + (sg.x1 - sg.x0) * t, my = sg.y0 + (sg.y1 - sg.y0) * t;
      cands.push(...(sg.hor ? [[mx - lb.w / 2, sg.y0 - lb.h - 3], [mx - lb.w / 2, sg.y0 + 3]] : [[sg.x0 + 6, my - lb.h / 2], [sg.x0 - lb.w - 6, my - lb.h / 2]]));
    }
    const free = (c, list) => !list.some(([x0, y0, x1, y1]) => c[0] < x1 && c[0] + lb.w > x0 && c[1] < y1 && c[1] + lb.h > y0);
    const c = cands.find((c) => free(c, avoid) && free(c, others)) ?? cands.find((c) => free(c, avoid)) ?? cands[0];
    se.label = { x: c[0], y: c[1], w: lb.w, h: lb.h }; avoid.push([c[0], c[1], c[0] + lb.w, c[1] + lb.h]);
  }
}
const labelOnRoute = (e) => {                                // ELK sometimes reports a label relative to a container (0,0): detect labels that are not next to their line
  const cx = e.label.x + e.label.w / 2, cy = e.label.y + e.label.h / 2;
  return e.pts.some((p, i) => i && Math.max(Math.min(p.x, e.pts[i - 1].x) - cx, cx - Math.max(p.x, e.pts[i - 1].x), 0) < e.label.w / 2 + 12 && Math.max(Math.min(p.y, e.pts[i - 1].y) - cy, cy - Math.max(p.y, e.pts[i - 1].y), 0) < e.label.h / 2 + 24);
};

// ----- cost function: lower is better (crossings, bends, length, edges through nodes, label clashes, group order, area, aspect ratio) -----
function sceneCost(S, M) {
  let c = (S.W * S.H) / 4000 + frameCheck(S.W, S.H + (M.title ? 52 : 0), M.frame).cost;
  const segs = [], nodeRects = S.nodes.map((n) => ({ n, r: [n.x - 2, n.y - 2, n.x + n.n.size + 2, n.y + n.n.size + 2 + LABEL_GAP + n.lines.length * LH] }));
  for (const e of S.edges) {
    for (let i = 1; i < e.pts.length; i++) { const p = e.pts[i - 1], q = e.pts[i]; segs.push({ e, x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) }); c += (Math.abs(p.x - q.x) + Math.abs(p.y - q.y)) / 40; }   // length: a light tie-breaker (area and the review carry the weight)
    c += 3 * Math.max(0, e.pts.length - 2);
    for (const { n, r } of nodeRects) if (n.n.id !== e.m.from && n.n.id !== e.m.to) for (const s of segs.filter((z) => z.e === e)) if (s.x0 < r[2] && s.x1 > r[0] && s.y0 < r[3] && s.y1 > r[1]) c += 300;
    if (e.label) for (const { r } of nodeRects) if (e.label.x < r[2] && e.label.x + e.label.w > r[0] && e.label.y < r[3] && e.label.y + e.label.h > r[1]) c += 150;
  }
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j]; if (a.e === b.e) continue;
    const share = a.e.m.from === b.e.m.from || a.e.m.to === b.e.m.to || a.e.m.from === b.e.m.to || a.e.m.to === b.e.m.from;
    const ah = a.y0 === a.y1, bh = b.y0 === b.y1;
    if (ah !== bh) { const h = ah ? a : b, v = ah ? b : a; if (v.x0 > h.x0 + 1 && v.x0 < h.x1 - 1 && h.y0 > v.y0 + 1 && h.y0 < v.y1 - 1 && !share) c += 60; }
    else if (!share && ((ah && Math.abs(a.y0 - b.y0) < 2 && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 6) || (!ah && Math.abs(a.x0 - b.x0) < 2 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 6))) c += 40;
  }
  const items = new Map();                                    // listed order of siblings should survive in stacked columns
  for (const g of S.groups) items.set(g.g.id, { o: g.g, x: g.x, y: g.y, w: g.w, h: g.h, grp: true });
  for (const n of S.nodes) items.set(n.n.id, { o: n.n, x: n.x, y: n.y, w: n.w, h: n.w, grp: false });
  const sib = new Map(); for (const v of items.values()) sib.set(v.o.parent ?? '', [...(sib.get(v.o.parent ?? '') ?? []), v]);
  const vert = M.direction === 'RIGHT' || M.direction === 'LEFT';
  for (const list of sib.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const p = list[i], q = list[j], overlap = vert ? Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) : Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    if (overlap > 10 && !(p.grp && q.grp) && (vert ? p.y + p.h / 2 > q.y + q.h / 2 + 5 : p.x + p.w / 2 > q.x + q.w / 2 + 5)) c += 40;   // groups: see review()
  }
  return c;
}
// ----- review: measured layout faults, so the agent fixes facts instead of guessing from the picture (and the cost function can avoid them) -----
const iconRect = (n) => [n.x, n.y, n.x + n.n.size, n.y + n.n.size];
const nodeLabelRect = (n) => { const c = n.x + n.n.size / 2; return [c - n.lw / 2, n.y + n.n.size, c + n.lw / 2, n.y + n.n.size + LABEL_GAP + n.lines.length * LH]; };
const footRect = (n) => { const a = iconRect(n), b = nodeLabelRect(n); return [Math.min(a[0], b[0]), a[1], Math.max(a[2], b[2]), b[3]]; };
const hit = (a, b, m = 0) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
const segsOf = (e) => e.pts.slice(1).map((q, i) => { const p = e.pts[i]; return { e, hor: Math.abs(p.y - q.y) < 0.5, x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y), len: Math.abs(p.x - q.x) + Math.abs(p.y - q.y) }; });
const segRect = (s) => [s.x0, s.y0, s.x1, s.y1];
function review(S, M) {
  const f = [], add = (kind, weight, text) => f.push({ kind, weight, text });
  const nm = (id) => `"${id}"`, en = (e) => `${e.m.from} -> ${e.m.to}`;
  const flow = M.direction === 'RIGHT' || M.direction === 'LEFT' ? 'y' : 'x', across = flow === 'y' ? 'x' : 'y';
  const c = (n, ax) => (ax === 'x' ? n.x : n.y) + n.n.size / 2;
  const byId = new Map(S.nodes.map((n) => [n.n.id, n]));
  // 1. connected nodes that are almost, but not exactly, in line (the line gets a small step)
  const seenPair = new Set();
  for (const e of S.edges) {
    const a = byId.get(e.m.from), b = byId.get(e.m.to); if (!a || !b) continue;
    const d = Math.abs(c(a, flow) - c(b, flow)), key = [a.n.id, b.n.id].sort().join('|');
    if (d > 0.5 && d < 40 && !seenPair.has(key)) { seenPair.add(key); add('misaligned', 30 + d, `${nm(a.n.id)} and ${nm(b.n.id)} are connected but ${Math.round(d)} px out of line`); }
  }
  // 1b. the main flow should run straight: a bend in a plain chain (a -> b, nothing else leaves a or enters b), or in the branch of a fan-out
  //     that carries the longer continuation (side branches should take the bends); the more nodes follow, the more it matters
  const fwd = S.edges.filter((e) => !e.m.back && byId.has(e.m.from) && byId.has(e.m.to) && e.m.from !== e.m.to);
  const outs = (id) => fwd.filter((e) => e.m.from === id), inN = (id) => fwd.filter((e) => e.m.to === id).length;
  const after = (id) => { const seen = new Set([id]), st = [id]; while (st.length) { const x = st.pop(); for (const e of fwd) if (e.m.from === x && !seen.has(e.m.to)) { seen.add(e.m.to); st.push(e.m.to); } } return seen.size - 1; };
  for (const e of fwd) {
    const a = byId.get(e.m.from), b = byId.get(e.m.to), d = Math.abs(c(a, flow) - c(b, flow)), o = outs(a.n.id);
    if (d < 40 || a.n.border || b.n.border) continue;
    const n = after(b.n.id), chain = o.length === 1 && inN(b.n.id) === 1, main = o.length > 1 && n > 0 && o.every((x) => x === e || after(x.m.to) < n);
    if (chain || main) add('bent', 15 + 10 * Math.min(n, 6), chain ? `line ${en(e)} bends: ${nm(b.n.id)} could sit in line with ${nm(a.n.id)}` : `the main line ${en(e)} bends while side branches of ${nm(a.n.id)} could take the bend instead`);
  }
  // 2. small steps (jogs) inside a line
  for (const e of S.edges) segsOf(e).forEach((s, i, all) => {
    if (i === 0 || i === all.length - 1 || s.len >= 24 || s.len < 0.5) return;
    if (all[i - 1].hor === all[i + 1].hor && all[i - 1].hor !== s.hor) add('jog', 20, `line ${en(e)} has a ${Math.round(s.len)} px step`);
  });
  // 2b. detours: more than two bends, or a path much longer than the distance between its ends
  for (const e of S.edges) {
    const real = segsOf(e).filter((s) => s.len >= 0.5), bends = real.filter((s, i) => i && s.hor !== real[i - 1].hor).length, len = real.reduce((t, s) => t + s.len, 0), p = e.pts[0], q = e.pts[e.pts.length - 1], dist = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
    if (bends > 2 || len > 1.4 * dist + 120) add('detour', 25 + 15 * Math.max(0, bends - 2) + Math.round(Math.max(0, len - dist) / 20), `line ${en(e)} takes a detour (${bends} bends, ${Math.round(len)} px for ${Math.round(dist)} px)`);
  }
  // 3. ragged columns (rows for DOWN/UP): nodes stacked across the flow whose centres differ a little
  const col = [...S.nodes].sort((p, q) => c(p, across) - c(q, across));
  for (let i = 0; i < col.length;) {                           // one finding per column: consecutive centres closer than 24 px form a column
    let j = i; while (j + 1 < col.length && c(col[j + 1], across) - c(col[j], across) < 24) j++;
    const d = c(col[j], across) - c(col[i], across);
    if (d > 4) add('ragged', 10 + d, `${col.slice(i, j + 1).map((n) => nm(n.n.id)).join(', ')} are stacked but their centres differ by up to ${Math.round(d)} px`);
    i = j + 1;
  }
  // 4. lines through icons or labels, label clashes, crossings, lines running side by side
  const segs = S.edges.flatMap(segsOf), labels = S.edges.filter((e) => e.label).map((e) => ({ e, r: [e.label.x, e.label.y, e.label.x + e.label.w, e.label.y + e.label.h] }));
  for (const n of S.nodes) {
    const through = new Set(segs.filter((s) => s.e.m.from !== n.n.id && s.e.m.to !== n.n.id && (hit(segRect(s), iconRect(n), -1) || hit(segRect(s), nodeLabelRect(n), -1))).map((s) => en(s.e)));
    for (const t of through) add('through', 300, `line ${t} runs through ${nm(n.n.id)}`);
    for (const l of labels) if (hit(l.r, iconRect(n), -1) || hit(l.r, nodeLabelRect(n), -1)) add('label', 150, `label of ${en(l.e)} covers ${nm(n.n.id)}`);
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (hit(labels[i].r, labels[j].r, -1)) add('label', 150, `labels of ${en(labels[i].e)} and ${en(labels[j].e)} overlap`);
  for (const l of labels) for (const s of segs) if (s.e !== l.e && hit(l.r, segRect(s), -1)) { add('label', 40, `label of ${en(l.e)} sits on line ${en(s.e)}`); break; }
  for (const l of labels) for (const g of S.groups) {
    const edges = [[g.x, g.y, g.x + g.w, g.y], [g.x, g.y + g.h, g.x + g.w, g.y + g.h], [g.x, g.y, g.x, g.y + g.h], [g.x + g.w, g.y, g.x + g.w, g.y + g.h]];
    if (edges.some((b) => hit(l.r, b, 2))) { add('label', 40, `label of ${en(l.e)} sits on the border of group ${nm(g.g.id)}`); break; }
  }
  const shares = (a, b) => [a.m.from, a.m.to].some((x) => x === b.m.from || x === b.m.to);
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j]; if (a.e === b.e) continue;
    if (a.hor !== b.hor) { const h = a.hor ? a : b, v = a.hor ? b : a; if (v.x0 > h.x0 + 1 && v.x0 < h.x1 - 1 && h.y0 > v.y0 + 1 && h.y0 < v.y1 - 1 && !shares(a.e, b.e)) crossings++; continue; }
    const gap = a.hor ? Math.abs(a.y0 - b.y0) : Math.abs(a.x0 - b.x0), run = a.hor ? Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) : Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const trunk = gap < 2 && !!a.e.m.back === !!b.e.m.back && (a.e.m.from === b.e.m.from || a.e.m.to === b.e.m.to);   // lines that fan out from (or into) one point share a trunk on purpose
    if (run > 20 && gap < 16 && !trunk) add(gap < 2 ? 'overlap' : 'tight', gap < 2 ? 60 : 25, gap < 2 ? `lines ${en(a.e)} and ${en(b.e)} share a ${Math.round(run)} px track` : `lines ${en(a.e)} and ${en(b.e)} run side by side only ${Math.round(gap)} px apart`);
  }
  if (crossings) add('crossing', 60 * crossings, `${crossings} line crossing${crossings > 1 ? 's' : ''}`);
  // 5. empty space: inside groups (box much bigger than what it holds) and over the whole picture
  const inside = new Map();
  const grow = (id, r) => { const b = inside.get(id); inside.set(id, b ? [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])] : r); };
  for (const n of S.nodes) if (n.n.parent && !n.n.border) grow(n.n.parent, footRect(n));
  for (const g of S.groups) if (g.g.parent) grow(g.g.parent, [g.x, g.y, g.x + g.w, g.y + g.h]);
  for (const g of S.groups) {
    const b = inside.get(g.g.id); if (!b) continue;
    const used = (b[2] - b[0] + 2 * PAD) * (b[3] - b[1] + PAD + (g.icon ? HEAD_ICON : HEAD_PLAIN)), spare = 1 - used / (g.w * g.h);
    if (spare > 0.35 && g.w * g.h > 90000) add('space', Math.round(spare * 200), `group ${nm(g.g.id)} is ${Math.round(spare * 100)}% empty`);
  }
  // 5b. groups stacked in one column keep the order of the spec (AZ A above AZ B)
  const gl = S.groups.filter((g) => M.G.indexOf(g.g) >= 0);
  for (let i = 0; i < gl.length; i++) for (let j = 0; j < gl.length; j++) {
    const p = gl[i], q = gl[j]; if (p.g.parent !== q.g.parent || M.G.indexOf(p.g) >= M.G.indexOf(q.g)) continue;
    const overlap = flow === 'y' ? Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) : Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    if (overlap > 10 && (flow === 'y' ? p.y > q.y + 5 : p.x > q.x + 5)) add('order', 400, `group ${nm(p.g.id)} comes first in the spec but is drawn ${flow === 'y' ? 'below' : 'right of'} ${nm(q.g.id)}`);
  }
  // 6. the biggest empty patch (at least 168 px both ways; thin strips are just spacing): a 24 px grid where icons, labels, lines and group borders are "ink"; largest all-empty rectangle (histogram method)
  const CELL = 24, nx = Math.ceil(S.W / CELL), ny = Math.ceil(S.H / CELL), inkd = new Uint8Array(nx * ny);
  const mark = (r) => { for (let i = Math.max(0, Math.floor(r[0] / CELL)); i <= Math.min(nx - 1, Math.floor(r[2] / CELL)); i++) for (let j = Math.max(0, Math.floor(r[1] / CELL)); j <= Math.min(ny - 1, Math.floor(r[3] / CELL)); j++) inkd[j * nx + i] = 1; };
  for (const n of S.nodes) mark(footRect(n));
  for (const l of labels) mark(l.r);
  for (const s of segs) mark(segRect(s));
  for (const g of S.groups) { mark([g.x, g.y, g.x + g.w, g.y + (g.icon ? 40 : 30)]); mark([g.x, g.y, g.x, g.y + g.h]); mark([g.x + g.w, g.y, g.x + g.w, g.y + g.h]); mark([g.x, g.y + g.h, g.x + g.w, g.y + g.h]); }
  let hole = { a: 0 }; const hgt = new Array(nx).fill(0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) hgt[i] = inkd[j * nx + i] ? 0 : hgt[i] + 1;
    const st = [];
    for (let i = 0; i <= nx; i++) {
      const h = i < nx ? hgt[i] : 0; let start = i;
      while (st.length && st[st.length - 1][1] >= h) { const [s0, h0] = st.pop(), a = h0 * (i - s0); if (a > hole.a && h0 >= 7 && i - s0 >= 7) hole = { a, x: s0, y: j - h0 + 1, w: i - s0, h: h0 }; start = s0; }
      st.push([start, h]);
    }
  }
  const holeShare = (hole.a * CELL * CELL) / (S.W * S.H);
  if (holeShare > 0.08) {
    const hx = (hole.x + hole.w / 2) * CELL / S.W, hy = (hole.y + hole.h / 2) * CELL / S.H, where = `${hy < 0.33 ? 'top' : hy > 0.67 ? 'bottom' : 'middle'} ${hx < 0.33 ? 'left' : hx > 0.67 ? 'right' : 'centre'}`.replace('middle centre', 'centre');
    add('space', Math.round(holeShare * 1500), `an empty area of ${hole.w * CELL}x${hole.h * CELL} px (${Math.round(holeShare * 100)}% of the picture) at the ${where}`);
  }
  // 7. reading starts top-left: the first node of the spec that nothing leads to should not sit low (RIGHT) or far right (DOWN)
  const entry = M.N.map((n) => byId.get(n.id)).find((n) => n && !inN(n.n.id) && !n.n.parent) ?? M.N.map((n) => byId.get(n.id)).find((n) => n && !inN(n.n.id));
  if (entry) {
    const pos = flow === 'y' ? c(entry, 'y') / S.H : c(entry, 'x') / S.W;
    if (pos > 0.62) add('start', Math.round((pos - 0.4) * 400), `the flow starts at ${nm(entry.n.id)}, which sits ${flow === 'y' ? 'low' : 'far right'} (${Math.round(pos * 100)}% ${flow === 'y' ? 'down' : 'across'}); reading starts top-left`);
  }
  const ink = S.nodes.reduce((t, n) => { const r = footRect(n); return t + (r[2] - r[0]) * (r[3] - r[1]); }, 0) / (S.W * S.H);
  return { faults: f.sort((a, b) => b.weight - a.weight), crossings, ink, hole: holeShare, aspect: S.W / S.H };
}

async function layoutBest(M, icons, nLayouts, debugBase) {
  const stacked = stackedEdges(M), seeds = [1, 8, 2, 3, 4, 5, 6, 7].slice(0, M.N.length <= 6 ? 1 : nLayouts);   // never seed 0: ELK treats 0 as "pick a random seed", which made pictures differ from run to run
  const bk = (a) => ({ 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', ...(a ? { 'elk.layered.nodePlacement.bk.fixedAlignment': a } : {}) });
  const places = [{}, bk(), bk('LEFTUP'), bk('LEFTDOWN'), { free: true }];   // node placers differ in which lines they straighten, and free attachment points suit some nested pictures better: try each, the review decides
  const wrap = (k) => ({ 'elk.layered.wrapping.strategy': 'MULTI_EDGE', 'elk.aspectRatio': String((M.frame.aspect ?? 1.33) * k) });   // a long flow folded into rows: the way to a narrow frame (ELK tends to fold a bit too far, hence two targets)
  const runs = [...seeds.flatMap((seed) => places.map((place, pi) => ({ seed, place, pi }))), ...(M.frame.aspect || M.frame.maxWidth ? seeds.slice(0, 2).flatMap((seed) => [1, 1.5].map((k) => ({ seed, place: wrap(k), pi: `wrap${k}`, optional: true }))) : [])];
  const cands = [], cost = (S) => sceneCost(S, M) + review(S, M).faults.reduce((t, x) => t + x.weight, 0);
  for (const { seed, place, pi, optional } of runs) {
    let laid;
    try { laid = await elkRun(M, icons, stacked, seed, seed === seeds[0] && pi === 0 ? debugBase : null, place); } catch (e) { if (optional && e instanceof UserError) continue; throw e; }   // ELK cannot wrap every nested graph
    const S = toScene(laid);
    snapToBorders(S);
    if (stacked.size) routeStacked(S, M, stacked);
    const need = new Set(stacked);
    for (const e of S.edges) if (e.label && !labelOnRoute(e)) { need.add(e.m.id); e.label = null; }
    if (need.size) placeLabels(S, need);
    const c = cost(S);
    if (process.env.DIAGRAM_VERBOSE) console.error(`seed ${seed} placer ${pi}: cost ${c.toFixed(0)} (${S.W}x${S.H})`);
    cands.push({ S, c });
  }
  for (const cd of cands.sort((a, b) => a.c - b.c).slice(0, 3)) {   // our own detour repair is slow (A*): only for the three best layouts
    const done = reroute(cd.S, M);
    if (done.size) { placeLabels(cd.S, done); cd.c = cost(cd.S); }
  }
  return cands.sort((a, b) => a.c - b.c)[0].S;
}

// ======================= 6b. grid layout: a layout file pins nodes to cells; rows, columns and group boxes are sized here and every line is routed by the own router =======================
const GAP = [64, 48];                                        // default free space between columns / rows (lines and their labels run there)
const layoutPathFor = (specFile) => (/\.json$/i.test(specFile) ? specFile.replace(/\.json$/i, '.layout.json') : `${specFile}.layout.json`);
function readLayout(file, M) {                               // -> { grid: Map id -> [column, row], nudge: Map id -> [dx, dy], gap, frame, warns }
  const L = parseJson(file), errs = [], warns = [], err = (m) => errs.push(m);
  if (!isObj(L)) throw new UserError(`${file}: a layout file is a JSON object {"grid": {"node id": [column, row]}, "nudge": {"node id": [dx, dy]}, "gap": [x, y], "frame": {...}}`);
  checkKeys(L, ['grid', 'nudge', 'gap', 'frame'], 'layout', err);
  const ids = M.N.map((n) => n.id), out = { grid: new Map(), nudge: new Map(), gap: GAP, frame: null, warns };
  const pairs = (k, ok, what) => {
    if (L[k] === undefined) return [];
    if (!isObj(L[k])) { err(`"${k}" must be an object {"node id": ${what}}`); return []; }
    return Object.entries(L[k]).filter(([id, v]) => {
      if (id.startsWith('_')) return false;
      if (!ok(v)) { err(`${k} "${id}": must be ${what}, got ${JSON.stringify(v)}`); return false; }
      if (ids.includes(id)) return true;
      const s = close(id, ids); warns.push(`layout ${k}: "${id}" is not a node of the spec${s ? ` - renamed to "${s}"?` : ' (removed?)'}; ignored`); return false;
    });
  };
  for (const [id, v] of pairs('grid', (v) => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && x >= 0 && x < 100), '[column, row], whole numbers from 0')) out.grid.set(id, v);
  for (const [id, v] of pairs('nudge', (v) => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x) && Math.abs(x) <= 300), '[dx, dy] in px, each within 300')) out.nudge.set(id, v);
  if (L.gap !== undefined) { if (Array.isArray(L.gap) && L.gap.length === 2 && L.gap.every((x) => Number.isFinite(x) && x >= 16 && x <= 600)) out.gap = L.gap; else err(`"gap" must be [x, y] in px, each from 16 to 600 (default [${GAP}])`); }
  if (L.frame !== undefined) out.frame = parseFrame(L.frame, err);
  if (errs.length) throw new UserError([`LAYOUT FILE ${file} HAS ${errs.length} ERROR${errs.length > 1 ? 'S' : ''}:`, ...errs.map((m) => `  - ${m}`), ...warns.map((m) => `  (warning: ${m})`)]);
  return out;
}
function gridFromScene(S) {                                  // a finished layout read back as cells: icon centres closer than 24 px share a column (row)
  const cl = (vals) => { const idx = new Map(); let k = -1, last = -Infinity; for (const v of [...new Set(vals)].sort((a, b) => a - b)) { if (v - last > 24) k++; idx.set(v, k); last = v; } return idx; };
  const cx = (n) => r1(n.x + n.n.size / 2), cy = (n) => r1(n.y + n.n.size / 2), fx = cl(S.nodes.map(cx)), fy = cl(S.nodes.map(cy));
  return new Map(S.nodes.map((n) => [n.n.id, [fx.get(cx(n)), fy.get(cy(n))]]));
}
function resolveGrid(M, given, auto) {                       // given cells win; the others keep their automatic cell, moved down while it is taken; then check group areas
  const cells = new Map(), taken = new Map(), warns = [], errs = [];
  const put = (id, [c, r], mine) => {
    const want = [c, r]; while (taken.has(`${c},${r}`)) r++;
    if (mine && r !== want[1]) warns.push(`grid: "${id}" wants [${want}], which "${taken.get(want.join(','))}" already has; drawn at [${c}, ${r}]`);
    cells.set(id, [c, r]); taken.set(`${c},${r}`, id);
  };
  for (const n of M.N) if (given.has(n.id)) put(n.id, given.get(n.id), true);
  for (const n of M.N) if (!given.has(n.id)) put(n.id, auto?.get(n.id) ?? [0, 0], false);
  const parent = new Map([...M.G, ...M.N].map((o) => [o.id, o.parent])), anc = (id) => { const a = []; for (let p = parent.get(id); p; p = parent.get(p)) a.push(p); return a; };
  const span = new Map();                                    // group -> [c0, r0, c1, r1] over its nodes (a node on its own group's border does not stretch that group)
  for (const n of M.N) for (const g of anc(n.id)) {
    if (n.border && g === n.parent) continue;
    const [c, r] = cells.get(n.id), s = span.get(g);
    span.set(g, s ? [Math.min(s[0], c), Math.min(s[1], r), Math.max(s[2], c), Math.max(s[3], r)] : [c, r, c, r]);
  }
  for (const g of M.G) if (!span.has(g.id)) errs.push(`group "${g.id}" has no node in it; a grid layout needs at least one node in each group`);
  const inside = (s, c, r) => c >= s[0] && c <= s[2] && r >= s[1] && r <= s[3], show = (s) => `columns ${s[0]}-${s[2]}, rows ${s[1]}-${s[3]}`;
  for (const [g, s] of span) {
    for (const n of M.N) if (!anc(n.id).includes(g) && inside(s, ...cells.get(n.id))) errs.push(`"${n.id}" at [${cells.get(n.id)}] lies in the area of group "${g}" (${show(s)}) but does not belong to it: move it out, or move the group's nodes`);
    for (const [h, t] of span) if (g < h && !anc(g).includes(h) && !anc(h).includes(g) && t[0] <= s[2] && s[0] <= t[2] && t[1] <= s[3] && s[1] <= t[3]) errs.push(`groups "${g}" (${show(s)}) and "${h}" (${show(t)}) overlap: neither contains the other, so their cells must not overlap`);
  }
  if (errs.length) throw new UserError([`GRID LAYOUT HAS ${errs.length} PROBLEM${errs.length > 1 ? 'S' : ''}:`, ...errs.map((m) => `  - ${m}`)]);
  return { cells, span, warns };
}
function gridScene(M, icons, cells, span, { nudge = new Map(), gap = GAP } = {}) {   // cells -> scene: column widths, row heights and group borders are solved here, then the lines are routed
  const info = new Map(M.N.map((n) => { const lines = nodeLines(n.label), lw = Math.max(...lines.map((l) => textWidth(l))); return [n.id, { n, lines, lw, w: Math.max(n.size, lw), down: n.size / 2 + LABEL_GAP + lines.length * LH }]; }));
  const depth = new Map(); for (const g of M.G) { let d = 0; for (let p = g.parent; p; p = M.G.find((x) => x.id === p)?.parent) d++; depth.set(g.id, d); }
  const head = (g) => (g.t.icon && icons.lib.icons[g.t.icon] ? HEAD_ICON : HEAD_PLAIN), minW = (g) => Math.ceil(g.t.icon && icons.lib.icons[g.t.icon] ? 52.8 + textWidth(g.label) + 16 : textWidth(g.label) + 32);
  const nc = Math.max(...[...cells.values()].map((c) => c[0])) + 1, nr = Math.max(...[...cells.values()].map((c) => c[1])) + 1;
  const colW = Array(nc).fill(0), up = Array(nr).fill(0), down = Array(nr).fill(0);
  for (const [id, [c, r]] of cells) {                        // a node on a group's border does not size its own column (left/right) or row (top/bottom): it sits on the border
    const i = info.get(id), b = i.n.border;
    if (b !== 'left' && b !== 'right') colW[c] = Math.max(colW[c], i.w);
    if (b !== 'top' && b !== 'bottom') { up[r] = Math.max(up[r], i.n.size / 2); down[r] = Math.max(down[r], i.down); }
  }
  const labelGap = Array(nc + 1).fill(0), rowGap = Array(nr + 1).fill(0);   // room an edge label or a border node needs at a boundary
  for (const e of M.E) {
    const a = cells.get(e.from), b = cells.get(e.to); if (!a || !b || !(e.label || e.step)) continue;
    if (Math.abs(a[0] - b[0]) === 1 && a[1] === b[1]) labelGap[Math.max(a[0], b[0])] = Math.max(labelGap[Math.max(a[0], b[0])], labelBox(e).w + 36);
    if (a[0] === b[0]) colW[a[0]] = Math.max(colW[a[0]], 2 * (labelBox(e).w + 14));   // a labelled line inside one column: its label sits beside the line
  }
  const G = M.G.filter((g) => span.has(g.id)), gById = new Map(M.G.map((g) => [g.id, g])), byDepth = (sign) => (a, b) => sign * (depth.get(a.id) - depth.get(b.id));
  const within = (a, g) => { for (let p = g.parent; p; p = gById.get(p)?.parent) if (p === a.id) return true; return false; };   // a encloses g
  const onBorder = new Map();                                // group id + side -> room a border node needs inside that side
  for (const [id, [c, r]] of cells) {
    const i = info.get(id), b = i.n.border; if (!b || !span.has(i.n.parent)) continue;
    const s = span.get(i.n.parent), inner = b === 'left' || b === 'right' ? i.w / 2 + 16 : b === 'top' ? i.down + 12 : i.n.size / 2 + 12, outer = b === 'left' || b === 'right' ? i.w / 2 + 16 : b === 'top' ? i.n.size / 2 + 12 : i.down + 12;
    onBorder.set(`${i.n.parent}${b}`, Math.max(onBorder.get(`${i.n.parent}${b}`) ?? 0, inner));
    if (b === 'left') labelGap[s[0]] = Math.max(labelGap[s[0]], outer); if (b === 'right') labelGap[s[2] + 1] = Math.max(labelGap[s[2] + 1], outer);
    if (b === 'top') rowGap[s[1]] = Math.max(rowGap[s[1]], outer); if (b === 'bottom') rowGap[s[3] + 1] = Math.max(rowGap[s[3] + 1], outer);
    for (const e of M.E) {                                   // a labelled line from the border node into its group: its label needs room inside the border too
      if (!(e.label || e.step) || (e.from !== id && e.to !== id) || (b !== 'left' && b !== 'right')) continue;
      const o = cells.get(e.from === id ? e.to : e.from); if (!o || o[1] !== r) continue;
      onBorder.set(`${i.n.parent}${b}`, Math.max(onBorder.get(`${i.n.parent}${b}`), i.n.size / 2 + labelBox(e).w + 30));
    }
  }
  // positions along one axis. At boundary k: groups closing after the previous column/row, the free gap, groups opening before the next.
  // Only nested groups stack their borders; side-by-side groups opening (closing) at the same boundary share the space.
  const axis = (n, size, lo, hi, opens, closes, gapMin, extraGap) => {
    const start = [], border = new Map(); let x = MARGIN;
    for (let k = 0; k <= n; k++) {
      const C = G.filter((g) => hi(g) === k - 1).sort(byDepth(-1)), cpos = new Map();
      for (const g of C) { cpos.set(g.id, Math.max(0, ...C.filter((d) => within(g, d)).map((d) => cpos.get(d.id))) + closes(g)); border.set(`${g.id}>`, x + cpos.get(g.id)); }
      x += Math.max(0, ...cpos.values());
      x += k === 0 || k === n ? 0 : Math.max(gapMin, extraGap[k] ?? 0);
      const O = G.filter((g) => lo(g) === k).sort(byDepth(1)), opos = new Map();
      for (const g of O) { opos.set(g.id, Math.max(0, ...O.filter((a) => within(a, g)).map((a) => opos.get(a.id) + opens(a)))); border.set(`${g.id}<`, x + opos.get(g.id)); }
      x += Math.max(0, ...O.map((g) => opos.get(g.id) + opens(g)));
      if (k < n) { start[k] = x; x += size[k]; }
    }
    return { start, border, end: x + MARGIN };
  };
  const side = (g, s, base) => Math.max(base, onBorder.get(`${g.id}${s}`) ?? 0);
  let X, Y;
  for (let pass = 0; pass < 6; pass++) {                    // a group whose title is wider than its columns widens its last column
    X = axis(nc, colW, (g) => span.get(g.id)[0], (g) => span.get(g.id)[2], (g) => side(g, 'left', PAD), (g) => side(g, 'right', PAD), gap[0], labelGap);
    let grew = false;
    for (const g of G) { const w = X.border.get(`${g.id}>`) - X.border.get(`${g.id}<`), need = minW(g) - w; if (need > 0.5) { colW[span.get(g.id)[2]] += need; grew = true; } }
    if (!grew) break;
  }
  Y = axis(nr, up.map((u, r) => u + down[r]), (g) => span.get(g.id)[1], (g) => span.get(g.id)[3], (g) => side(g, 'top', head(g)), (g) => side(g, 'bottom', PAD), gap[1], rowGap);
  const S = { W: Math.ceil(X.end), H: Math.ceil(Y.end), groups: [], nodes: [], edges: [] };
  for (const g of [...G].sort(byDepth(1))) {
    const x0 = X.border.get(`${g.id}<`), y0 = Y.border.get(`${g.id}<`);
    S.groups.push({ g, icon: head(g) === HEAD_ICON, x: x0, y: y0, w: X.border.get(`${g.id}>`) - x0, h: Y.border.get(`${g.id}>`) - y0 });
  }
  for (const [id, [c, r]] of cells) {
    const i = info.get(id), [dx, dy] = nudge.get(id) ?? [0, 0], b = span.has(i.n.parent) ? i.n.border : null, h = i.n.size / 2;
    const cx = b === 'left' ? X.border.get(`${i.n.parent}<`) : b === 'right' ? X.border.get(`${i.n.parent}>`) : X.start[c] + colW[c] / 2;
    const cy = b === 'top' ? Y.border.get(`${i.n.parent}<`) : b === 'bottom' ? Y.border.get(`${i.n.parent}>`) : Y.start[r] + up[r];
    S.nodes.push({ n: i.n, lines: i.lines, lw: i.lw, w: i.n.size, h: i.n.size, x: cx - h + dx, y: cy - h + dy });
  }
  S.nodes.sort((a, b) => M.N.indexOf(a.n) - M.N.indexOf(b.n));
  snapToBorders(S);
  routeAll(S, M);
  return S;
}
function routeAll(S, M) {                                    // every line with the own router: the end sides that face each other, never into the bottom of an icon (its label is there)
  const node = new Map(S.nodes.map((n) => [n.n.id, n])), grp = new Map(S.groups.map((g) => [g.g.id, g]));
  const sidesOfGroup = (g) => [{ x: g.x + g.w, y: g.y + g.h / 2, d: 0 }, { x: g.x + g.w / 2, y: g.y + g.h, d: 1 }, { x: g.x, y: g.y + g.h / 2, d: 2 }, { x: g.x + g.w / 2, y: g.y, d: 3 }];
  const centre = (o) => (o.n ? [o.x + o.n.size / 2, o.y + o.n.size / 2] : [o.x + o.w / 2, o.y + o.h / 2]);
  const used = new Map(), spot = (p, e) => {                  // a point may be shared only by a fan (same style, same start or same end); otherwise move 14 px along the side
    const fits = (k) => (used.get(k) ?? []).every((o) => o.line === e.line && (o.from === e.from || o.to === e.to));
    for (const o of [0, 14, -14, 28, -28]) { const q = p.d % 2 ? { ...p, x: p.x + o } : { ...p, y: p.y + o }; if (fits(`${r1(q.x)},${r1(q.y)}`)) return q; }
    return p;
  };
  const facing = (dx, dy) => { const h = dx >= 0 ? 0 : 2, v = dy >= 0 ? 1 : 3; return Math.abs(dx) >= Math.abs(dy) ? [h, v] : [v, h]; };
  for (const e of M.E) {
    const A = node.get(e.from) ?? grp.get(e.from), B = node.get(e.to) ?? grp.get(e.to); if (!A || !B || A === B) continue;
    const [ax, ay] = centre(A), [bx, by] = centre(B), sa = A.n ? sidesOf(A) : sidesOfGroup(A), sb = B.n ? sidesOf(B) : sidesOfGroup(B);
    const side = (dx, dy) => { const f = facing(dx, dy); return Math.abs(dx) < Math.abs(dy) ? [...f, (f[1] + 2) % 4] : f; };   // above/below each other: also try both sides (a C shape)
    const outs = side(bx - ax, by - ay).filter((d) => A.n || d !== 3), ins = side(ax - bx, ay - by).filter((d) => (B.n ? d !== 1 : d !== 3));
    if (!ins.length) ins.push(bx >= ax ? 2 : 0);
    const obst = obstacles(S, A.n ? A : null, B.n ? B : null), trunk = (o) => o.m.line === e.line && (o.m.from === e.from || o.m.to === e.to);   // only lines of the same style may share a trunk (a dashed line on a solid one would vanish)
    let best = null;
    for (const [oi, o] of outs.entries()) for (const [ii, i] of ins.entries()) {   // the sides that face each other come first; another side must be clearly better
      const r = astar(S, obst, spot(sa[o], e), spot(sb[i], e), trunk, 400); if (!r) continue;
      const cost = r.cost + crossingsWith(routeShape(r.pts).segs, S, null) * 150 + (oi + ii) * 80;
      if (!best || cost < best.cost) best = { pts: r.pts, cost };
    }
    if (!best) { console.error(`warning: could not route ${e.from} -> ${e.to}; drawn as a straight line`); best = { pts: [sa[outs[0]], sb[ins[0]]] }; }
    for (const p of [best.pts[0], best.pts[best.pts.length - 1]]) { const k = `${r1(p.x)},${r1(p.y)}`; used.set(k, [...(used.get(k) ?? []), e]); }
    S.edges.push({ m: e, rev: false, pts: best.pts, label: null });
  }
  placeLabels(S, new Set(M.E.map((e) => e.id)));
}
function writeLayout(file, cells, old, M) {                  // one node per line in spec order, so a change is one line in a diff
  const ids = M.N.map((n) => n.id).filter((id) => cells.has(id)), w = Math.max(...ids.map((id) => id.length)) + 3;
  const rows = ids.map((id) => `    ${`"${id}":`.padEnd(w)} [${cells.get(id).join(', ')}]`);
  const rest = old ? Object.entries(old).filter(([k]) => k !== 'grid').map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`) : [];
  fs.writeFileSync(file, `{\n  "grid": {\n${rows.join(',\n')}\n  }${rest.length ? `,\n${rest.join(',\n')}` : ''}\n}\n`);
}

// ======================= 7. SVG emitter =======================
function emitSvg(M, S, icons) {
  const used = new Map(), sym = [], missing = new Set();
  const use = (id, x, y, size) => {                          // each icon is inlined once as <symbol>; ids inside are prefixed (no clashes)
    const ic = icons.lib.icons[id]; if (!ic) { missing.add(id); return ''; }
    if (!used.has(id)) {
      const p = `i${used.size}_`, body = ic.b.replace(/\bid="([^"]*)"/g, (_, v) => `id="${p}${v}"`).replace(/url\(#([^)]+)\)/g, (_, v) => `url(#${p}${v})`).replace(/(xlink:)?href="#([^"]+)"/g, (_, a, v) => `${a ?? ''}href="#${p}${v}"`);
      used.set(id, `s${used.size}`); sym.push(`<symbol id="${used.get(id)}" viewBox="${ic.vb}">${body}</symbol>`);
    }
    return `<use href="#${used.get(id)}" x="${r1(x)}" y="${r1(y)}" width="${size}" height="${size}"/>`;
  };
  const titleH = M.title ? 52 : 0, W = S.W, H = S.H + titleH, out = [];
  for (const n of S.groups) {                                // parents precede children (depth-first)
    const t = n.g.t, d = DASH[t.dash ?? 'solid'];
    out.push(`<rect x="${r1(n.x)}" y="${r1(n.y)}" width="${r1(n.w)}" height="${r1(n.h)}" fill="none" stroke="${t.stroke}" stroke-width="${STROKE}"${d ? ` stroke-dasharray="${d}"` : ''}/>`);
    if (n.icon) out.push(use(t.icon, n.x, n.y, ICON_PX.group), `<text x="${r1(n.x + 52.8)}" y="${r1(n.y + 25)}" fill="#000">${esc(n.g.label)}</text>`);
    else out.push(`<text x="${r1(n.x + n.w / 2)}" y="${r1(n.y + 24)}" text-anchor="middle" fill="#000">${esc(n.g.label)}</text>`);
  }
  for (const e of S.edges) {
    const m = e.m, atTo = m.arrows === 'end' || m.arrows === 'both', atFrom = m.arrows === 'start' || m.arrows === 'both';   // ELK laid back edges out reversed: their polyline runs to -> from
    const mark = ((e.rev ? atFrom : atTo) ? ' marker-end="url(#ah)"' : '') + ((e.rev ? atTo : atFrom) ? ' marker-start="url(#ahs)"' : ''), dash = EDGE_DASH[m.line];
    out.push(`<polyline points="${e.pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join(' ')}" fill="none" stroke="#000" stroke-width="${STROKE}"${dash ? ` stroke-dasharray="${dash}"` : ''}${mark}/>`);
  }
  for (const e of S.edges) {                                 // label = [numbered badge] + text, white backing so crossing lines never hit the text
    const l = e.label, m = e.m; if (!l) continue;
    const lines = labelBox(m).lines, bw = m.step ? 2 * BADGE_R + (lines.length ? 5 : 0) : 0, cy = l.y + l.h / 2;
    out.push(`<rect x="${r1(l.x - 1)}" y="${r1(l.y)}" width="${r1(l.w + 2)}" height="${r1(l.h)}" fill="#fff"/>`);
    if (m.step) out.push(`<circle cx="${r1(l.x + BADGE_R)}" cy="${r1(cy)}" r="${BADGE_R}" fill="#000"/><text x="${r1(l.x + BADGE_R)}" y="${r1(cy + 5.2)}" text-anchor="middle" font-weight="bold" font-size="14.7" fill="#fff">${m.step}</text>`);
    lines.forEach((t, i) => out.push(`<text x="${r1(l.x + bw + 4)}" y="${r1(cy - (lines.length * LH) / 2 + 14 + i * LH)}" fill="#000">${esc(t)}</text>`));
  }
  for (const n of S.nodes) {
    const m = n.n;
    out.push(m.box ? `<rect x="${r1(n.x)}" y="${r1(n.y)}" width="${n.w}" height="${n.h}" fill="#fff" stroke="#7D8998" stroke-width="${STROKE}"/>` : use(m.icon, n.x, n.y, m.size));
    if (m.border) out.push(`<rect x="${r1(n.x + n.w / 2 - n.lw / 2 - 3)}" y="${r1(n.y + n.h + LABEL_GAP)}" width="${r1(n.lw + 6)}" height="${n.lines.length * LH}" fill="#fff"/>`);
    n.lines.forEach((line, i) => out.push(`<text x="${r1(n.x + n.w / 2)}" y="${r1(n.y + n.h + LABEL_GAP + 14 + i * LH)}" text-anchor="middle" fill="#000">${esc(line)}</text>`));
  }
  const title = M.title ? `<text x="${MARGIN}" y="${MARGIN + 18}" font-size="24" font-weight="bold" fill="#000">${esc(M.title)}</text>` : '';
  const marker = '<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1.5 L9 5 L1 8.5" fill="none" stroke="#000" stroke-width="1.5"/></marker><marker id="ahs" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M9 1.5 L1 5 L9 8.5" fill="none" stroke="#000" stroke-width="1.5"/></marker>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" font-size="${FS}"><defs>${marker}${sym.join('')}</defs><rect width="${W}" height="${H}" fill="#fff"/>${title}<g transform="translate(0 ${titleH})">${out.join('')}</g></svg>`;
  return { svg, W, H, missing: [...missing] };
}

// ======================= 8. PNG =======================
function toPng(svg, W, { width, scale }) {
  const fit = width ? { mode: 'width', value: Math.round(width) } : { mode: 'zoom', value: scale ?? Math.min(Math.max(2, 2400 / W), 4800 / W) };
  const r = new RS.Resvg(svg, { background: '#ffffff', fitTo: fit, font: { fontBuffers: RS.fonts, defaultFontFamily: FONT } });
  const img = r.render(), png = img.asPng(), res = { png, w: img.width, h: img.height };
  img.free?.(); r.free?.();
  return res;
}

// ======================= 9. CLI =======================
const HELP = `diagram-skill ${VERSION}: JSON spec -> PNG architecture diagram (offline, no browser, nothing to install)
  node scripts/diagram.mjs spec.json out.png [--svg] [--width 2400 | --scale 2] [--profile aws|generic] [--check] [--debug] [--save-layout] [--layout F | --no-layout]
  node scripts/diagram.mjs --doctor        check Node, the vendored files, fonts, WebAssembly and every profile's icons
  node scripts/diagram.mjs --import-icons <extracted AWS pack folder | Icon-package.zip>      one-time setup of the aws profile
  node scripts/diagram.mjs --find <text> [--profile P]     search icon names     |   --types [--profile P]   list group types
Profiles: aws (official AWS icons, bring your own pack) | generic (bundled generic icons). Pick one with "profile" in the spec or --profile (default aws).
  --icons-dir <folder>  use any folder of .svg icons (with a viewBox) instead of the profile's icons;  --icons <file>  use a specific imported icon store
Spec (JSON, ids are your own; groups nest through "parent"; edges may also point at group ids):
  { "title": "optional", "profile": "aws", "direction": "RIGHT", "frame": {"intent":"fits a slide","aspect":"16:9"},
    "groups": [ {"id":"cloud","label":"AWS Cloud","type":"AWS Cloud"}, {"id":"vpc","label":"VPC 10.0.0.0/16","type":"VPC","parent":"cloud"} ],
    "nodes":  [ {"id":"users","label":"Users","icon":"Users"}, {"id":"alb","label":"ALB","icon":"Application Load Balancer","group":"vpc"} ],
    "edges":  [ {"from":"users","to":"alb","label":"HTTPS","step":1,"style":"solid"} ] }
  edge style: solid | dashed | dotted ("dotted, no arrowhead" works), "arrows": end|start|both|none. step = numbered black badge.
  layout hints (all optional): "direction" RIGHT|DOWN|LEFT|UP. List nodes/edges in reading order (cycles are broken in that order).
    "back":true on an edge = it points against the reading direction (egress / return path), drawn that way and laid out reversed.
    "rank":N on a group or node = column index inside its parent; groups of one parent with the SAME rank are stacked in one column and
    edges between them are routed by the tool (e.g. AZ A above AZ B). "border":"left" puts a node on the border of its group (internet gateway on the VPC edge).
    Raw ELK options: "elk": {"elk.spacing.nodeNode":50} on spec/group/node/edge.
  frame (optional): "aspect" "W:H"|number|"any" (default 4:3, a hint only when no frame is given), "maxWidth"/"maxHeight" in layout px, "intent" = the user's words.
  Layout file (optional, spec.layout.json next to the spec): {"grid": {"id": [column, row]}, "nudge": {"id": [dx, dy]}, "gap": [x, y]} pins nodes to cells;
    --save-layout writes the current layout as cells, --no-layout ignores the file.
  After rendering, "review:" lines report the frame and measured faults (lines through icons, crossings, bends, detours, misalignment, empty areas).
  --layouts N  ELK runs with different seeds (default 6), each with five placement styles; the review and a cost function pick the best.
Environment: DIAGRAM_SKILL_HOME (per-user data folder, default %LOCALAPPDATA%\\diagram-skill, ~/Library/Application Support/diagram-skill or ~/.local/share/diagram-skill), DIAGRAM_SKILL_ICONS (icon store file).
Exit codes: 0 ok, 2 spec error, 3 setup/font/icon error, 4 layout failure.`;
function parseArgs(argv) {
  const known = { '--svg': 0, '--check': 0, '--debug': 0, '--help': 0, '--types': 0, '--doctor': 0, '--version': 0, '--width': 1, '--scale': 1, '--layouts': 1, '--icons': 1, '--icons-dir': 1, '--profile': 1, '--font-dir': 1, '--import-icons': 1, '--find': 1, '--layout': 1, '--no-layout': 0, '--save-layout': 0 };
  const a = { pos: [], f: {} };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s) : [null];
    if (!k) { a.pos.push(argv[i]); continue; }
    if (!(k in known)) throw new UserError(`unknown option ${k}${suggest(k, Object.keys(known), 1).length ? ` - did you mean ${suggest(k, Object.keys(known), 1)[0]}?` : ''}`);
    a.f[k.slice(2)] = known[k] ? (v ?? argv[++i]) : true;
    if (known[k] && a.f[k.slice(2)] === undefined) throw new UserError(`option ${k} needs a value`);
  }
  return a;
}
function parseJson(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new UserError(`cannot read spec file "${file}": ${e.message}`); }
  try { return JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text); } catch (e) {
    const m = /position (\d+)/.exec(e.message), before = m ? text.slice(0, +m[1]) : '', early = /end of JSON/i.test(e.message);
    throw new UserError(`"${file}" is not valid JSON${m ? ` at line ${before.split('\n').length}, column ${before.length - before.lastIndexOf('\n')}` : early ? ` (it ends early, after line ${text.trimEnd().split('\n').length}: a ] or } is missing)` : ''}: ${e.message}`);
  }
}
async function doctor(f) {                                   // one screen that tells a person or an agent whether rendering can work on this machine
  const out = []; let bad = 0;
  const ok = (m) => out.push(`ok    ${m}`), info = (m) => out.push(`info  ${m}`), fail = (m) => { bad++; out.push(`FAIL  ${m}`); };
  const major = Number(process.versions.node.split('.')[0]);
  (major >= 18 ? ok : fail)(`node ${process.versions.node} on ${process.platform}-${process.arch} (needs >= 18)`);
  const sums = path.join(SKILL, 'vendor', 'SHA256SUMS');
  if (!fs.existsSync(sums)) fail('vendor/SHA256SUMS is missing');
  else {
    const lines = fs.readFileSync(sums, 'utf8').split(/\r?\n/).filter(Boolean); let n = 0;
    for (const ln of lines) {
      const [h, p] = ln.split(/\s+/), fp = path.join(SKILL, 'vendor', p);
      if (!fs.existsSync(fp)) { fail(`vendor/${p} is missing`); continue; }
      if (crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex') !== h) fail(`vendor/${p} does not match vendor/SHA256SUMS (modified or corrupt)`); else n++;
    }
    if (n === lines.length) ok(`vendor: all ${n} files match vendor/SHA256SUMS (elkjs, resvg-wasm, Liberation Sans)`);
  }
  try { await initRaster(f['font-dir'] ?? path.join(SKILL, 'vendor', 'fonts')); ok('resvg-wasm starts and the bundled font renders text'); } catch (e) { fail(e.message); }
  for (const name of profileNames()) {
    const P = await loadProfile(name);
    try { const { lib, from } = readLibrary(P, f); ok(`profile ${name}: ${Object.values(lib.icons).filter((i) => i.k !== 'group').length} icons (${from})`); }
    catch (e) {
      if (P.icons.kind === 'store' && e instanceof UserError) info(`profile ${name}: not set up yet (expected ${storeFile(P, f.icons)}). Run: node scripts/diagram.mjs --import-icons <AWS icon pack zip or folder> --profile ${name}`);
      else fail(`profile ${name}: ${e.message}`);
    }
  }
  console.log(out.join('\n'));
  if (bad) process.exit(3);
}
async function main(argv) {
  const { pos, f } = parseArgs(argv);
  if (f.version) { console.log(VERSION); return; }
  if (f.help || (!pos.length && !f['import-icons'] && !f.find && !f.types && !f.doctor)) { console.log(HELP); return; }
  if (f.doctor) return doctor(f);
  if (f.types) {
    await loadProfile(f.profile);
    for (const t of GROUP_TYPES) console.log(`${t.name.padEnd(28)} ${t.stroke} ${(t.dash ?? 'solid').padEnd(8)} ${t.icon ? `corner icon ${t.icon}` : 'centred label, no icon'}`);
    return;
  }
  if (f['import-icons']) {
    const P = await loadProfile(f.profile ?? 'aws');
    if (!P.importPack) throw new UserError(`profile "${P.name}" has no icon pack to import (it ships its own icons; use --icons-dir for your own SVG folder)`, 3);
    const out = storeFile(P, f.icons); fs.mkdirSync(path.dirname(out), { recursive: true });
    console.log(P.importPack(f['import-icons'], out)); return;
  }
  if (f.find) {
    const P = await loadProfile(f.profile), ic = loadIcons(readLibrary(P, f).lib, P), toks = ic.kn(f.find).split(' ');
    let hits = ic.ids.filter((id) => ic.lib.icons[id].k !== 'group' && toks.every((t) => `${ic.kn(displayName(id))} ${norm(displayName(id))}`.includes(t)));
    if (!hits.length) { console.log(`no icon contains "${f.find}"; nearest:`); hits = suggest(f.find, ic.names, 8).map((n) => ic.ids.find((id) => displayName(id) === n)); }
    for (const id of hits.slice(0, 40)) console.log(`${ic.lib.icons[id].k.padEnd(9)} ${displayName(id)}`);
    return;
  }
  const [specFile, outFile] = pos;
  if (!outFile && !f.check) throw new UserError('usage: node scripts/diagram.mjs spec.json out.png [--svg]   (or --check to only validate)');
  const t0 = performance.now(), spec = parseJson(specFile);
  const P = await loadProfile(f.profile ?? (isObj(spec) ? spec.profile : undefined));
  await initRaster(f['font-dir'] ?? path.join(SKILL, 'vendor', 'fonts'));
  const icons = loadIcons(readLibrary(P, f).lib, P);
  const M = buildModel(spec, icons);
  for (const w of M.warns) console.error(`warning: ${w}`);
  const layFile = f.layout ? path.resolve(f.layout) : layoutPathFor(specFile);   // the layout file sits next to the spec: spec.json -> spec.layout.json
  if (f.layout && !f['save-layout'] && !fs.existsSync(layFile)) throw new UserError(`layout file ${layFile} does not exist (write one with --save-layout)`);
  const lay = !f['no-layout'] && fs.existsSync(layFile) ? readLayout(layFile, M) : null;
  if (lay) { for (const w of lay.warns) console.error(`warning: ${w}`); if (lay.frame) M.frame = lay.frame; }
  const full = lay && lay.grid.size === M.N.length;
  if (f.check) {
    if (full) for (const w of resolveGrid(M, lay.grid, null).warns) console.error(`warning: ${w}`);
    console.log(`spec OK (profile ${P.name}): ${M.G.length} groups, ${M.N.length} nodes, ${M.E.length} edges${lay ? `; layout file: ${lay.grid.size} of ${M.N.length} nodes placed` : ''}`); return;
  }
  let S, cells = null;
  if (!full) S = await layoutBest(M, icons, f.layouts ? Number(f.layouts) : 6, f.debug ? outFile.replace(/\.png$/i, '') : null);
  if (lay && lay.grid.size) {                                 // grid mode: the cells of the layout file, the automatic cells for the rest
    const G = resolveGrid(M, lay.grid, full ? null : gridFromScene(S));
    for (const w of G.warns) console.error(`warning: ${w}`);
    cells = G.cells; S = gridScene(M, icons, cells, G.span, lay);
  }
  if (f['save-layout']) {
    writeLayout(layFile, cells ?? gridFromScene(S), fs.existsSync(layFile) ? parseJson(layFile) : null, M);
    console.log(`wrote ${layFile}: ${M.N.length} nodes as [column, row]; edit the cells, add "nudge" {"id": [dx, dy]} or "gap" [x, y], and render again`);
  }
  if (lay || f['save-layout']) console.log(`layout: ${cells ? `grid from ${path.basename(layFile)} (${lay.grid.size} of ${M.N.length} nodes placed there${full ? '' : ', the others automatic'})` : 'automatic'}`);
  const t1 = performance.now();
  const { svg, W, H, missing } = emitSvg(M, S, icons);
  if (missing.length) console.error(`warning: icon(s) missing from the icon library (drawn without icon): ${missing.join(', ')}. Re-run --import-icons with a complete pack.`);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  if (f.svg) fs.writeFileSync(outFile.replace(/\.png$/i, '') + '.svg', svg);
  const res = toPng(svg, W, { width: f.width && Number(f.width), scale: f.scale && Number(f.scale) });
  fs.writeFileSync(outFile, res.png);
  console.log(`${outFile}: ${res.w}x${res.h}px (layout ${W}x${H}) ${M.N.length} nodes ${M.G.length} groups ${M.E.length} edges, layout ${(t1 - t0).toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`);
  const R = review(S, M);
  const F = frameCheck(W, H, M.frame), pt = (12 * 605 / W).toFixed(1);   // 16 cm = 605 px at 96 dpi; labels are 12 pt at 100 %
  console.log(`review: ${R.faults.length} finding${R.faults.length === 1 ? '' : 's'}; layout ${W}x${H} px, aspect ${(W / H).toFixed(2)}:1, labels ${pt} pt when the picture is 16 cm wide`);
  if (M.frame.given) console.log(`  frame ${F.ok ? 'met' : 'MISSED'}: ${M.frame.intent ? `"${M.frame.intent}" = ` : ''}aspect ${M.frame.aspectText}${M.frame.maxWidth ? `, maxWidth ${M.frame.maxWidth}` : ''}${M.frame.maxHeight ? `, maxHeight ${M.frame.maxHeight}` : ''}${F.ok ? '' : `; ${F.text}`}`);
  else if (!F.ok) console.log(`  frame (none given, default target 4:3): ${F.text}; a hint only, unless the user asked for a shape`);
  for (const x of R.faults.slice(0, 20)) console.log(`  - ${x.kind}: ${x.text}`);
  if (R.faults.length > 20) console.log(`  ... ${R.faults.length - 20} more`);
}
main(process.argv.slice(2)).catch((e) => {
  if (e instanceof UserError) { console.error(e.message); process.exit(e.code); }
  console.error(e?.stack ?? e); process.exit(1);
});
