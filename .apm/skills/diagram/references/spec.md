# Spec reference

A spec is one JSON object. Unknown keys are reported (with "did you mean"); keys starting with `_` and `comment`, `note`, `$schema` are ignored, so you can annotate a spec.

## Top level

| Key | Meaning |
|---|---|
| `title` | Optional bold title above the picture. |
| `profile` | `aws` (default) or `generic`. The `--profile` option overrides it. |
| `direction` | `RIGHT` (default), `LEFT`, `DOWN`, `UP` (also `LR`, `RL`, `TB`, `BT`). `DOWN` makes lines cross node labels; prefer `RIGHT`. |
| `groups` | Array of groups (below). |
| `nodes` | Array of nodes (below). Required, at least one. |
| `edges` | Array of edges (below). |
| `elk` | Object of raw ELK layout options for the whole picture, e.g. `{"elk.spacing.nodeNode": 40}`. |

## Groups

`{ "id", "label", "type", "parent", "rank", "elk" }`

- `id`: unique across groups and nodes. `label`: text in the group's header (defaults to the type name).
- `type`: a group type of the profile (`--types` lists them; names are case-insensitive, aliases such as `az`, `account`, `on prem` work). Unknown types get suggestions. The first type of the list is the fallback.
- `parent`: id of the enclosing group. Groups may not form a cycle.
- `rank`: see "Ranks" below. `elk`: raw ELK options for this group.

## Nodes

`{ "id", "label", "icon", "group", "rank", "border", "elk" }`

- `icon` is required: an icon name, or `"box"` for a plain labelled box. Names are matched without case, punctuation and (for `aws`) the "Amazon"/"AWS" prefix; a parenthesised "(generic)" is ignored. If several icons match, the error lists them: use the full name. Resolution order: exact id, normalised name, profile alias, loose match.
- `group`: id of the group the node sits in; no group = outside every group.
- `label`: shown under the icon, wrapped to at most two lines (`\n` forces a break). Defaults to the icon name.
- `border`: `left`, `right`, `top` or `bottom`: the icon is centred on that border of its group (internet gateway on the VPC edge). Needs `group`.
- Icon sizes (aws): service icons 80 px, resource and general icons 48 px, group corner icons 40 px, as in the official deck. Generic: 56 px.

## Edges

`{ "from", "to", "label", "style", "arrows", "step", "back", "elk" }` (`source` / `target` are accepted for `from` / `to`)

- `from`, `to`: node ids, or group ids (the line then ends on the group).
- `label`: text on the line, wrapped at about 140 px.
- `style`: `solid` (default), `dashed`, `dotted`; add `no arrowhead` or `both ends` in the same string (`"dotted, no arrowhead"`), or use `arrows`.
- `arrows`: `end` (default), `start`, `both`, `none`.
- `step`: positive integer; draws a black circle with the number in front of the label. Use 1..n without gaps (gaps give a warning). The same number on several edges means "happens together".
- `back`: `true` when the edge runs against the reading direction (egress, reply, alert). It is laid out reversed and drawn pointing the right way. Edges that close a cycle are detected automatically, in spec order.

## Ranks (stacking and columns)

`rank` is a non-negative integer on a group or node: its column (row for DOWN) inside its parent. Nodes and groups of one parent with a lower rank are placed before higher ranks. **Groups with the same rank in the same parent are stacked in one column** and edges between them are routed by the tool itself (AZ A above AZ B). Once any child of a parent has a rank, give every child of that parent one. Without ranks, the order of nodes and edges in the spec decides.

## Command line

```
node scripts/diagram.mjs spec.json out.png [--svg] [--width N | --scale N] [--profile P] [--layouts N] [--icons FILE] [--icons-dir DIR] [--check] [--debug]
node scripts/diagram.mjs --doctor | --version | --help
node scripts/diagram.mjs --import-icons PACK [--profile aws] [--icons FILE]
node scripts/diagram.mjs --find TEXT [--profile P]     |     --types [--profile P]
```

- Size: `--width N` sets the PNG width in pixels (2400 is good for a page, 4600 for 30+ nodes); `--scale N` multiplies the natural size; with neither, the picture is rendered at 2x or more (small pictures are enlarged to 2400 px wide) and never wider than 4800 px.
- `--svg` also writes `out.svg` (same name, vector).
- `--layouts N`: number of ELK layouts tried with different seeds (default 6, one for tiny pictures); a cost function (crossings, bends, edges through nodes, group order, area, aspect ratio) keeps the best. Output is deterministic.
- `--icons FILE`: use this icon store JSON. `--icons-dir DIR`: use every `.svg` (with a `viewBox`) in a folder as the icon set, file name = icon name; the profile's group styles still apply. `--debug`: also write the ELK input and output next to the PNG.
- Environment: `DIAGRAM_SKILL_HOME` (per-user data folder), `DIAGRAM_SKILL_ICONS` (icon store file).

## Errors an agent will meet

| Exit | Message starts with | Do |
|---|---|---|
| 2 | `SPEC HAS n ERRORS` | fix every listed line; unknown ids and icons come with suggestions |
| 2 | `... is not valid JSON at line L, column C` | fix the syntax |
| 3 | `AWS ICON STORE NOT FOUND` | import the pack once, or use `generic` |
| 3 | `FONT MISSING` / `RESVG / WEBASSEMBLY UNAVAILABLE` | the vendored files are damaged or the machine blocks WebAssembly; run `--doctor` |
| 4 | `ELK layout failed` | remove `elk` overrides, check for an edge between a group and one of its own children, try another `direction` |
