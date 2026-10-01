# Profiles and icon sets

The engine (spec checking, ELK layout, line routing, SVG drawing, PNG rendering) knows no provider. A profile supplies everything provider specific, so a new provider is a new folder: `profiles/<name>/profile.mjs`. The spec selects it with `"profile": "<name>"` (or `--profile`).

## What a profile exports

```js
export default {
  name: 'aws',                                   // = folder name
  title: 'one line description',
  iconPx: { service: 80, resource: 48, general: 48, group: 40 },   // icon sizes in px by icon kind
  groupTypes: [ { name: 'VPC', stroke: '#8C4FFF', dash: 'dash' | 'sysDash' (optional), icon: 'icon id of the corner icon' (optional), alias: ['lower case aliases'] } ],
  abbr: [['simple storage service', 's3']],      // optional: words that mean the same in icon names
  aliases: { alb: 'Icon-Id' },                   // optional: lower case alias -> icon id
  stripPrefix: /^(amazon|aws) /,                 // optional: prefix that may be left out when naming an icon
  exampleIcon: 'AWS Lambda',                     // used in error messages
  icons: { kind: 'folder', dir },                // icons shipped with the profile (a folder of .svg files) ...
  // ... or icons the user imports once:
  icons: { kind: 'store' },                      // per-user store <data folder>/<name>-icons.json
  importPack(src, outFile) { /* read a zip or folder, write the store JSON, return a message */ },
  setupHelp: (file) => ['how to set the store up'],
};
```

The first group type is the fallback for unknown types. Group icons are looked up by id in the icon library; a group type whose icon is missing is drawn without a corner icon, so a profile also works with a plain icon folder.

## Icon libraries

An icon library is `{ icons: { <id>: { k, c, vb, b } } }`: `k` the kind (`service`, `resource`, `general`, `group`; decides the size), `c` a category label, `vb` the `viewBox`, `b` the inner SVG markup. `scripts/pack.mjs` has helpers to read a zip or folder (`readPack`) and to turn an SVG into such a record (`iconFromSvg`). Icon SVGs may use `id`, `url(#...)` and `href="#..."`; the engine prefixes them so icons never clash.

## Your own icons without writing a profile

```
node scripts/diagram.mjs spec.json out.png --icons-dir ./my-icons
```

Every `.svg` with a `viewBox` in the folder becomes an icon named after its file (`payment-gateway.svg` -> `"icon": "payment gateway"`), all as `general` kind. The profile chosen in the spec still provides group styles.

## Adding a provider (for example Azure or GCP)

1. Copy `profiles/generic/profile.mjs` to `profiles/<name>/profile.mjs`; set `name`, group types and sizes.
2. If the vendor's icon licence allows bundling, put the SVGs in `profiles/<name>/icons/` (`kind: 'folder'`). If not, use `kind: 'store'` and write `importPack` for the vendor's pack layout, like `profiles/aws/profile.mjs` does.
3. Add an example spec in `examples/<name>/`, add it to `EXAMPLES` in `test/run.mjs`, run `node test/run.mjs --update`, look at the picture, commit.
4. Update `SKILL.md` (the profile list) and `NOTICE.md` (icon terms).
