// AWS profile: group styles measured from the official AWS Architecture Icons deck, icon-name aliases, and the importer for the official icon pack.
// The pack itself is NOT in this repository: AWS grants no redistribution right. A person downloads it once and runs --import-icons (per-user icon store).
import fs from 'node:fs';
import path from 'node:path';
import { UserError, readPack, iconFromSvg } from '../../scripts/pack.mjs';

const T = (name, stroke, o = {}) => ({ name, stroke, ...o });
const GROUP_TYPES = [                                       // colours / dashes measured from the official deck (slide 25)
  T('AWS Cloud', '#232F3E', { icon: 'AWS-Cloud-logo', alias: ['cloud'] }),
  T('Region', '#00A4A6', { dash: 'sysDash', icon: 'Region' }),
  T('Availability Zone', '#00A4A6', { dash: 'dash', alias: ['az', 'availability zone dashed'] }),
  T('VPC', '#8C4FFF', { icon: 'Virtual-private-cloud-VPC', alias: ['virtual private cloud', 'virtual private cloud vpc'] }),
  T('Public subnet', '#7AA116', { icon: 'Public-subnet' }),
  T('Private subnet', '#00A4A6', { icon: 'Private-subnet' }),
  T('AWS account', '#E7157B', { icon: 'AWS-Account', alias: ['account'] }),
  T('Corporate data center', '#7D8998', { icon: 'Corporate-data-center', alias: ['data center', 'datacenter', 'on prem', 'onprem', 'on premises'] }),
  T('Security group', '#DD344C'),
  T('Auto Scaling group', '#ED7100', { dash: 'dash', icon: 'Auto-Scaling-group', alias: ['asg'] }),
  T('EC2 instance contents', '#ED7100', { icon: 'EC2-instance-contents' }),
  T('Server contents', '#7D8998', { icon: 'Server-contents' }),
  T('Spot Fleet', '#ED7100', { icon: 'Spot-Fleet' }),
  T('IoT Greengrass Deployment', '#7AA116', { icon: 'AWS-IoT-Greengrass-Deployment' }),
  T('Generic', '#7D8998', { dash: 'dash', alias: ['generic group', 'group', 'generic dashed'] }),
  T('Generic solid', '#7D8998', { alias: ['generic group solid'] }),
];

const ABBR = [['simple storage service', 's3'], ['key management service', 'kms'], ['elastic container service', 'ecs'], ['elastic kubernetes service', 'eks'],
  ['elastic compute cloud', 'ec2'], ['simple notification service', 'sns'], ['simple queue service', 'sqs'], ['relational database service', 'rds'],
  ['identity and access management', 'iam'], ['elastic container registry', 'ecr'], ['elastic load balancing', 'elb'], ['virtual private cloud', 'vpc']];
const ALIASES = { alb: 'Elastic-Load-Balancing_Application-Load-Balancer', nlb: 'Elastic-Load-Balancing_Network-Load-Balancer', igw: 'Amazon-VPC_Internet-Gateway',
  nat: 'Amazon-VPC_NAT-Gateway', 'nat gateway': 'Amazon-VPC_NAT-Gateway', cgw: 'Amazon-VPC_Customer-Gateway', user: 'User', users: 'Users',
  // names removed or renamed in newer packs: map the old canonical name to the current icon
  quicksight: 'Amazon-Quick', 'amazon quicksight': 'Amazon-Quick', 'kinesis data firehose': 'Amazon-Data-Firehose', 'amazon kinesis data firehose': 'Amazon-Data-Firehose',
  'amazon memorydb for redis': 'Amazon-MemoryDB', 'aws fault injection simulator': 'AWS-Fault-Injection-Service', 'aws application composer': 'AWS-Infrastructure-Composer' };

function importPack(src, outFile) {                          // official pack (extracted folder or the downloaded zip) -> one JSON icon store
  if (!fs.existsSync(src)) throw new UserError(`--import-icons: "${src}" does not exist`, 3);
  const files = readPack(src), icons = {};
  const RULES = [                                            // official pack layout (folder names carry the release date and are renamed between releases)
    ['service', /(?:^|\/)Architecture-Service-Icons_[^/]*\/Arch_([^/]+)\/64\/Arch_(.+)_64\.svg$/],
    ['general', /(?:^|\/)Resource-Icons_[^/]*\/Res_General-Icons\/Res_48_Light\/Res_(.+)_48_Light\.svg$/],
    ['resource', /(?:^|\/)Resource-Icons_[^/]*\/Res_(?!General-Icons)([^/]+)\/Res_(.+)_48\.svg$/],
    ['group', /(?:^|\/)Architecture-Group-Icons_[^/]*\/(.+)_32\.svg$/]];
  for (const [rel, read] of [...files].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {   // sorted: same result for a folder and for the zip
    for (const [k, re] of RULES) {
      const m = re.exec(rel); if (!m) continue;
      const id = m[m.length - 1]; if ((k === 'group' && /_Dark$/.test(id)) || icons[id]) break;   // first wins: one id can exist in two categories
      const ic = iconFromSvg(read().toString('utf8'), k, k === 'general' ? 'General' : k === 'group' ? 'Group' : m[1].replace(/-/g, ' '));
      if (ic) icons[id] = ic;
      break;
    }
  }
  const n = Object.keys(icons).length;
  if (n < 50) throw new UserError(`--import-icons: only ${n} icons recognised under "${src}". Point it at the folder (or zip) that contains Architecture-Service-Icons_*, Resource-Icons_* and Architecture-Group-Icons_*.`, 3);
  const sorted = Object.fromEntries(Object.keys(icons).sort().map((k) => [k, icons[k]]));
  fs.writeFileSync(outFile, JSON.stringify({ _notice: 'Derived from the official AWS Architecture Icons by diagram-skill --import-icons. Local use only: AWS grants no redistribution right. Do not publish or bundle.', source: path.basename(src), icons: sorted }));
  const by = (k) => Object.values(icons).filter((i) => i.k === k).length;
  return `imported ${n} icons (${by('service')} service, ${by('resource')} resource, ${by('general')} general, ${by('group')} group) -> ${outFile}`;
}

export default {
  name: 'aws',
  title: 'AWS architecture diagrams with the official AWS Architecture Icons (bring your own pack)',
  iconPx: { service: 80, resource: 48, general: 48, group: 40 },   // sizes from the official deck
  groupTypes: GROUP_TYPES, abbr: ABBR, aliases: ALIASES, stripPrefix: /^(amazon|aws) /,
  exampleIcon: 'AWS Lambda',
  icons: { kind: 'store' },
  importPack,
  setupHelp: (file) => [
    'AWS ICON STORE NOT FOUND. One-time setup (this skill never bundles AWS artwork):',
    '  1. download the official "Icon package" zip from https://aws.amazon.com/architecture/icons/ (a person with a browser, once per AWS icon release)',
    '  2. node scripts/diagram.mjs --import-icons <the .zip or the extracted folder>',
    `  expected store: ${file}   (change it with --icons <file>, DIAGRAM_SKILL_ICONS or DIAGRAM_SKILL_HOME)`,
    '  no AWS icons available? use "profile": "generic" in the spec (bundled icons).'],
};
