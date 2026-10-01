// Generic profile: boxes and arrows with the icons in ./icons (drawn for this project, MIT; see tools/make-generic-icons.mjs).
// Rounded colour tiles are services and data stores, dark outline glyphs are people and devices.
// Use --icons-dir <folder of .svg files> to draw with your own icons under the same group styles.
import { fileURLToPath } from 'node:url';

const T = (name, stroke, o = {}) => ({ name, stroke, ...o });
const COLORS = [['Blue', '#2F6FDE'], ['Green', '#2E9B4F'], ['Orange', '#E8710A'], ['Purple', '#8C4FFF'], ['Red', '#D93A4C'], ['Teal', '#0D9488']];
const GROUP_TYPES = [
  T('Group', '#7D8998', { dash: 'dash', alias: ['generic', 'generic group', 'box', 'boundary', 'zone', 'dashed'] }),    // the default type
  T('Group solid', '#7D8998', { alias: ['solid', 'generic solid', 'generic group solid'] }),
];
for (const [name, color] of COLORS) GROUP_TYPES.push(T(name, color, { alias: [`${name.toLowerCase()} group`] }), T(`${name} dashed`, color, { dash: 'dash' }));

const ALIASES = {                                            // synonyms -> icon ids (keys are lower case, words separated by single spaces)
  person: 'user', customer: 'user', people: 'users', team: 'users', client: 'laptop', desktop: 'laptop', computer: 'laptop', workstation: 'laptop',
  phone: 'mobile', smartphone: 'mobile', 'mobile client': 'mobile', web: 'browser', website: 'browser', 'web app': 'browser', frontend: 'browser', ui: 'browser',
  vm: 'server', host: 'server', machine: 'server', compute: 'server', instance: 'server', backend: 'service', microservice: 'service', worker: 'service', app: 'service',
  lambda: 'function', fn: 'function', 'serverless function': 'function', docker: 'container', pod: 'container', k8s: 'container', cron: 'timer', schedule: 'timer', scheduler: 'timer',
  db: 'database', sql: 'database', datastore: 'database', 'data store': 'database', bucket: 'storage', blob: 'storage', 'object storage': 'storage', 'file storage': 'storage',
  file: 'document', files: 'document', doc: 'document', report: 'document', sqs: 'queue', 'message queue': 'queue', kafka: 'queue', stream: 'queue',
  pubsub: 'topic', 'pub sub': 'topic', sns: 'topic', events: 'topic', email: 'mail', smtp: 'mail', internet: 'globe', dns: 'globe', cdn: 'globe',
  'api gateway': 'api', rest: 'api', endpoint: 'api', lb: 'load-balancer', gateway: 'router', network: 'router', vpn: 'router', waf: 'firewall',
  auth: 'lock', security: 'lock', secret: 'key', secrets: 'key', monitoring: 'monitor', metrics: 'monitor', dashboard: 'monitor', logs: 'monitor', redis: 'cache', memcached: 'cache',
};

export default {
  name: 'generic',
  title: 'generic architecture diagrams with bundled icons (or your own SVG folder via --icons-dir)',
  iconPx: { service: 56, resource: 56, general: 56, group: 40 },
  groupTypes: GROUP_TYPES, aliases: ALIASES,
  exampleIcon: 'database',
  icons: { kind: 'folder', dir: fileURLToPath(new URL('./icons/', import.meta.url)) },
};
