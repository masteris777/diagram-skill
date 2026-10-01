#!/usr/bin/env node
// Test suite and example builder. No dependencies, plain Node >= 18.
//   node test/run.mjs                          every check that can run on this machine (CI runs exactly this)
//   node test/run.mjs --aws-pack <zip|folder>  also check the AWS examples against the real official icon pack (it is not in this repository)
//   node test/run.mjs --update [--aws-pack P]  re-render the example pictures and rewrite test/golden.json (look at the pictures before committing)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, '.apm', 'skills', 'diagram'), CLI = path.join(SKILL, 'scripts', 'diagram.mjs'), EX = path.join(SKILL, 'examples');
const GOLDEN = path.join(ROOT, 'test', 'golden.json');
const args = process.argv.slice(2), UPDATE = args.includes('--update');
const PACK = args.includes('--aws-pack') ? path.resolve(args[args.indexOf('--aws-pack') + 1] ?? '') : null;

// the pictures that ship with the skill: spec (relative to examples/), render width, profile it needs
const EXAMPLES = [
  { name: 'generic/web-app', width: 2400, profile: 'generic' },
  { name: 'generic/platform', width: 2400, profile: 'generic' },
  { name: 'aws/tiny', width: 2000, profile: 'aws' },
  { name: 'aws/medium', width: 2400, profile: 'aws' },
  { name: 'aws/large', width: 4600, profile: 'aws' },
  { name: 'aws/event-driven', width: 2400, profile: 'aws' },
];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-skill-test-')), HOME = path.join(tmp, 'home');
let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log(`ok    ${name}`); };
const bad = (name, why) => { failed++; console.log(`FAIL  ${name}\n        ${String(why).split('\n').join('\n        ')}`); };
const check = (name, cond, why = '') => (cond ? ok(name) : bad(name, why));
const env = () => { const e = { ...process.env, DIAGRAM_SKILL_HOME: HOME }; delete e.DIAGRAM_SKILL_ICONS; return e; };
const cli = (a) => child_process.spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env: env(), cwd: tmp });
const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : { examples: {}, synthetic: null, aws_store: null };

function render(specFile, name, width) {                     // -> { png, svg } sha256, or throws with the CLI's message
  const out = path.join(tmp, 'out', `${name.replace(/\//g, '-')}.png`);
  const r = cli([specFile, out, '--svg', '--width', String(width)]);
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr || r.stdout}`);
  return { out, png: sha(fs.readFileSync(out)), svg: sha(fs.readFileSync(out.replace(/\.png$/, '.svg'))) };
}
function compare(label, got, want) {
  if (!want) return bad(label, 'no golden hash recorded yet: run node test/run.mjs --update after looking at the picture');
  check(label, got.svg === want.svg && got.png === want.png, `layout/SVG ${got.svg === want.svg ? 'same' : 'DIFFERENT'}, PNG ${got.png === want.png ? 'same' : 'DIFFERENT'}\n  got  svg ${got.svg} png ${got.png}\n  want svg ${want.svg} png ${want.png}`);
}

// ---------- 1. static checks ----------
{
  const doc = cli(['--doctor']);
  check('doctor: Node, vendored files (SHA256SUMS), resvg-wasm and the bundled font are fine', doc.status === 0, doc.stdout + doc.stderr);
  const v1 = /const VERSION = '([^']+)'/.exec(fs.readFileSync(CLI, 'utf8'))?.[1], v2 = /^version:\s*"?([^"\s]+)"?/m.exec(fs.readFileSync(path.join(ROOT, 'apm.yml'), 'utf8'))?.[1];
  check(`version in apm.yml (${v2}) equals VERSION in diagram.mjs (${v1})`, v1 && v1 === v2);
  const skillMd = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  check('SKILL.md has frontmatter with name "diagram" and a description', /^---\r?\nname: diagram\r?\ndescription: .{40,}/s.test(skillMd));

  // APM refuses to install packages that contain invisible Unicode (zero-width, bidi controls, BOM, soft hyphen): keep every text file clean
  const ranges = [[0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff], [0xad, 0xad], [0x180e, 0x180e]];
  const HIDDEN = new RegExp(`[${ranges.map(([a, b]) => String.fromCharCode(a) + (b > a ? `-${String.fromCharCode(b)}` : '')).join('')}]`);
  const TEXT = /\.(md|mjs|cjs|js|json|txt|yml|yaml|svg|gitignore|gitattributes)$|SHA256SUMS$/;
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (TEXT.test(e.name) && HIDDEN.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
    }
  })(ROOT);
  check('no hidden Unicode characters in any text file', !hits.length, hits.join('\n'));
}

// ---------- 2. command line behaviour an agent relies on ----------
{
  fs.mkdirSync(path.join(tmp, 'cases'), { recursive: true });
  const w = (n, s) => { const p = path.join(tmp, 'cases', n); fs.writeFileSync(p, s); return p; };
  const good = w('good.json', JSON.stringify({ profile: 'generic', nodes: [{ id: 'a', icon: 'server' }, { id: 'b', icon: 'database' }], edges: [{ from: 'a', to: 'b' }] }));
  let r = cli([good, '--check']);
  check('--check accepts a valid generic spec (exit 0)', r.status === 0 && /spec OK/.test(r.stdout), r.stdout + r.stderr);
  r = cli([w('broken.json', '{ "nodes": [ { "id": "a" } ]\n  "edges": [] }'), '--check']);
  check('invalid JSON (missing comma): exit 2 with line and column', r.status === 2 && /line \d+, column \d+/.test(r.stderr), r.stderr);
  r = cli([w('truncated.json', '{ "nodes": [ '), '--check']);
  check('truncated JSON: exit 2 saying where it ends', r.status === 2 && /ends early, after line \d+/.test(r.stderr), r.stderr);
  r = cli([w('bad-icon.json', JSON.stringify({ profile: 'generic', nodes: [{ id: 'a', icon: 'databse' }] })), '--check']);
  check('unknown icon: exit 2 with the nearest names', r.status === 2 && /nearest/.test(r.stderr) && /database/.test(r.stderr), r.stderr);
  r = cli([w('bad-profile.json', JSON.stringify({ profile: 'azure', nodes: [] })), '--check']);
  check('unknown profile: exit 2 listing the available profiles', r.status === 2 && /available: .*generic/.test(r.stderr), r.stderr);
  r = cli([w('aws-nostore.json', JSON.stringify({ profile: 'aws', nodes: [{ id: 'a', icon: 'AWS Lambda' }] })), '--check']);
  check('aws profile without an icon store: exit 3 with the setup steps', r.status === 3 && /ICON STORE NOT FOUND/.test(r.stderr) && /--import-icons/.test(r.stderr), r.stderr);
  r = cli([w('many.json', JSON.stringify({ profile: 'generic', nodes: [{ id: 'a', icon: 'nope' }, { id: 'b', icon: 'nada' }], edges: [{ from: 'a', to: 'zzz' }] })), '--check']);
  check('several problems are reported together', r.status === 2 && /SPEC HAS 3 ERRORS/.test(r.stderr), r.stderr);
  r = cli(['--find', 'data', '--profile', 'generic']);
  check('--find lists matching icon names', r.status === 0 && /database/.test(r.stdout), r.stdout + r.stderr);
}

// ---------- 3. generic examples: byte-identical pictures ----------
for (const ex of EXAMPLES.filter((e) => e.profile === 'generic')) {
  try {
    const got = render(path.join(EX, `${ex.name}.json`), ex.name, ex.width);
    if (UPDATE) { fs.copyFileSync(got.out, path.join(EX, `${ex.name}.png`)); fs.copyFileSync(got.out.replace(/\.png$/, '.svg'), path.join(EX, `${ex.name}.svg`)); golden.examples[ex.name] = { width: ex.width, svg: got.svg, png: got.png }; ok(`${ex.name}: re-rendered`); }
    else compare(`${ex.name}: picture identical to the recorded one`, got, golden.examples[ex.name]);
  } catch (e) { bad(ex.name, e.message); }
}

// ---------- 4. the aws profile end to end with a synthetic icon pack (our own placeholder SVGs in the real folder layout; no AWS artwork) ----------
{
  const pack = path.join(tmp, 'synthetic-pack'), put = (rel, svg) => { const p = path.join(pack, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, svg); };
  const tile = (color, vb = 64) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}"><title>placeholder</title><rect width="${vb}" height="${vb}" fill="${color}"/><circle cx="${vb / 2}" cy="${vb / 2}" r="${vb / 4}" fill="#fff"/></svg>`;
  const svc = (cat, name, color) => put(`Architecture-Service-Icons_01012026/Arch_${cat}/64/Arch_${name}_64.svg`, tile(color));
  svc('Compute', 'AWS-Lambda', '#ED7100'); svc('Networking-Content-Delivery', 'Amazon-API-Gateway', '#8C4FFF'); svc('Database', 'Amazon-DynamoDB', '#C925D1'); svc('Management-Governance', 'Amazon-CloudWatch', '#E7157B');
  for (let i = 0; i < 60; i++) svc('Filler', `Filler-Service-${String(i).padStart(2, '0')}`, '#7D8998');
  put('Resource-Icons_01012026/Res_General-Icons/Res_48_Light/Res_Users_48_Light.svg', tile('#232F3E', 48));
  for (const g of ['AWS-Cloud-logo', 'Region', 'Virtual-private-cloud-VPC', 'Private-subnet']) put(`Architecture-Group-Icons_01012026/${g}_32.svg`, tile('#232F3E', 32));
  let r = cli(['--import-icons', pack]);
  check('aws: --import-icons builds the per-user icon store from a pack folder', r.status === 0 && /imported 6\d icons/.test(r.stdout) && fs.existsSync(path.join(HOME, 'aws-icons.json')), r.stdout + r.stderr);
  r = cli(['--find', 'lambda']);
  check('aws: --find works on the imported store', r.status === 0 && /AWS Lambda/.test(r.stdout), r.stdout + r.stderr);
  try {
    const got = render(path.join(ROOT, 'test', 'fixtures', 'aws-synthetic.json'), 'aws-synthetic', 2000);
    if (UPDATE) { golden.synthetic = { width: 2000, svg: got.svg, png: got.png }; ok('aws-synthetic: re-rendered'); }
    else compare('aws: synthetic-pack picture identical to the recorded one', got, golden.synthetic);
  } catch (e) { bad('aws-synthetic', e.message); }
  fs.rmSync(path.join(HOME, 'aws-icons.json'), { force: true });
}

// ---------- 5. the aws examples against the real official pack (optional) ----------
if (PACK) {
  let r = cli(['--import-icons', PACK]);
  if (r.status !== 0) bad('aws: import of the real pack', r.stderr + r.stdout);
  else {
    const store = sha(JSON.stringify(JSON.parse(fs.readFileSync(path.join(HOME, 'aws-icons.json'), 'utf8')).icons));
    if (UPDATE) golden.aws_store = store;
    if (!UPDATE && golden.aws_store !== store) console.log(`skip  aws examples: this pack differs from the one the recorded pictures were made with (icon table ${store.slice(0, 12)}, recorded ${String(golden.aws_store).slice(0, 12)}); re-record with --update after looking at them`);
    else for (const ex of EXAMPLES.filter((e) => e.profile === 'aws')) {
      try {
        const got = render(path.join(EX, `${ex.name}.json`), ex.name, ex.width);
        if (UPDATE) { fs.copyFileSync(got.out, path.join(EX, `${ex.name}.png`)); golden.examples[ex.name] = { width: ex.width, svg: got.svg, png: got.png }; ok(`${ex.name}: re-rendered`); }
        else compare(`${ex.name}: picture identical to the recorded one (real AWS pack)`, got, golden.examples[ex.name]);
      } catch (e) { bad(ex.name, e.message); }
    }
  }
} else if (!UPDATE) console.log('skip  aws examples with the real icon pack (pass --aws-pack <zip|folder> to run them)');

if (UPDATE) { fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n'); console.log(`wrote ${path.relative(ROOT, GOLDEN)}`); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
