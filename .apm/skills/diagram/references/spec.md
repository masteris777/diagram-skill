# Spec reference

A spec is one JSON object. Unknown keys are reported (with "did you mean"); keys starting with `_` and `comment`, `note`, `$schema` are ignored, so you can annotate a spec.

## Top level

| Key | Meaning |
|---|---|
| `title` | Optional bold title above the picture. |
| `profile` | `aws` (default) or `generic`. The `--profile` option overrides it. |
| `direction` | `RIGHT` (default), `LEFT`, `DOWN`, `UP` (also `LR`, `RL`, `TB`, `BT`). `DOWN` makes lines cross node labels; prefer `RIGHT`. |
| `frame` | What the picture must fit (below). Optional; without it the target is 4:3, reported as a hint only. |
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

## Frame

`{ "intent", "aspect", "tolerance", "maxWidth", "maxHeight" }`, all optional:

```json
"frame": { "intent": "fits a 16 cm wide page, may grow downwards", "aspect": "any", "maxWidth": 1400 }
```

- `intent`: the user's own words for the shape they want. Keep them, so whoever edits the picture later knows why the frame is what it is.
- `aspect`: `"W:H"` (`"4:3"`, `"16:9"`, `"1:1"`), a number (width / height) or `"any"`. Default `"4:3"`. `tolerance`: allowed deviation, default 0.25 (25 %).
- `maxWidth`, `maxHeight`: limits in layout px, title included. Layout px are what the review prints; 16 px text is 12 pt when the picture is shown at 100 %. A picture pasted 16 cm wide shows its labels at 12 pt x 605 / layout width, so `maxWidth` 1400 keeps them at about 5 pt and 1000 at about 7 pt.
- The layout prefers candidates that fit the frame, and for a wide picture it also tries folding the flow into rows. Folding works well without groups and only a little with nested groups. The review says whether the frame is met; what else to try is in SKILL.md.

## Layout file (exact placement)

The spec says what exists; an optional layout file says where it goes. It sits next to the spec (`web-shop.json` -> `web-shop.layout.json`) and is used automatically; `--layout FILE` names another one, `--no-layout` ignores it.

```json
{
  "grid": {
    "users":  [0, 1],
    "api":    [1, 1],
    "db":     [1, 2]
  },
  "nudge": { "db": [12, -3] },
  "gap":   [64, 48],
  "frame": { "intent": "fits a slide", "aspect": "16:9" }
}
```

- `grid`: `[column, row]` per node id, counting from 0 at the top left. Columns and rows are sized to their widest and tallest node, so everything in one row or column is exactly aligned. Group boxes are drawn around their nodes, and every line is routed by the script (lines leave and enter the sides that face each other, never into the bottom of an icon, where its label is).
- Nodes missing from `grid` keep their automatic place (moved down if the cell is taken). A node in the area of a group it does not belong to, or two groups overlapping without one containing the other, is an error that names the cells. Ids the spec no longer has are reported (with "renamed to ...?") and ignored.
- `nudge`: `[dx, dy]` in px for fine-tuning one node after the grid is solved.
- `gap`: minimum free space between columns and rows in px (default `[64, 48]`); columns grow by themselves for edge labels and group titles. An empty column or row is allowed and adds space.
- `frame`: as in the spec; the layout file's frame wins. With a grid the frame is only reported, the cells decide the shape.
- `--save-layout` writes the layout of the current render as a grid (one node per line, in spec order), keeping `nudge`, `gap` and `frame` of an existing file. Typical use: render automatically, save, then move a few cells.
- In grid mode `rank`, `back` and `direction` do not move anything (lines are still drawn pointing the right way); `border` still puts a node on its group's edge.

## Command line

```
node scripts/diagram.mjs spec.json out.png [--svg] [--width N | --scale N] [--profile P] [--layouts N] [--layout FILE | --no-layout] [--save-layout] [--icons FILE] [--icons-dir DIR] [--check] [--debug]
node scripts/diagram.mjs --doctor | --version | --help
node scripts/diagram.mjs --import-icons PACK [--profile aws] [--icons FILE]
node scripts/diagram.mjs --find TEXT [--profile P]     |     --types [--profile P]
```

- Size: `--width N` sets the PNG width in pixels (2400 is good for a page, 4600 for 30+ nodes); `--scale N` multiplies the natural size; with neither, the picture is rendered at 2x or more (small pictures are enlarged to 2400 px wide) and never wider than 4800 px.
- `--svg` also writes `out.svg` (same name, vector).
- `--layouts N`: number of ELK layouts tried with different seeds (default 6, one for tiny pictures); each runs with five placement styles (node placers, fixed or free attachment points), and the review below plus a cost function (crossings, bends, edges through nodes, group order, area, frame) keeps the best. More layouts take longer (about 1 to 2 s for 6 on 35 nodes). Output is deterministic.
- `--icons FILE`: use this icon store JSON. `--icons-dir DIR`: use every `.svg` (with a `viewBox`) in a folder as the icon set, file name = icon name; the profile's group styles still apply. `--debug`: also write the ELK input and output next to the PNG.
- Environment: `DIAGRAM_SKILL_HOME` (per-user data folder), `DIAGRAM_SKILL_ICONS` (icon store file).

## The review after each render

After the PNG line the script prints what it measured in the finished layout, worst first:

```
review: 3 findings; layout 1953x720 px, aspect 2.71:1, labels 3.7 pt when the picture is 16 cm wide
  frame MISSED: "fits a portrait page" = aspect 3:4; aspect 2.71:1 is wider than 3:4 (0.75:1, within 25%)
  - misaligned: "orders" and "queue" are connected but 13 px out of line
```

| Finding | Means | Usual fix |
|---|---|---|
| `through` | a line runs through an icon or its label | reorder nodes in the spec, give `rank`s, or split the picture |
| `label` | an edge label covers an icon, a label or a line | shorten the label, or break it with `\n` |
| `order` | groups stacked in one column are not in spec order | give them the same `rank` and list them in the wanted order |
| `crossing` | lines cross | reorder nodes and edges (reading order), mark return lines `"back": true` |
| `bent` | the main flow bends where it could run straight | list the main chain first in `nodes` and `edges`; move side branches after it |
| `detour` | a line takes more than two bends or a long way round | check the groups of its two ends; `rank` or reordering usually helps |
| `misaligned`, `jog` | two connected icons are a few px out of line | usually fixed by the same changes; small values (under 10 px) can be left |
| `tight`, `overlap` | two lines run side by side or on one track | reorder, or more spacing: `"elk": {"elk.spacing.edgeEdge": 24}` |
| `ragged` | icons stacked in a column do not share a centre line | usually icons of different sizes; small values can be left |
| `space` | a big empty area | move what sits far away closer (rank, order), or split the picture |
| `start` | the flow starts low or far right; reading starts top-left | list the entry node first, give it `rank` 0 |

The script already picks the layout with the fewest and lightest findings, so a remaining finding is what that layout could not avoid. Fix what is visible in the picture; you can leave small `misaligned`, `jog` or `ragged` values.

## Errors an agent will meet

| Exit | Message starts with | Do |
|---|---|---|
| 2 | `SPEC HAS n ERRORS` | fix every listed line; unknown ids and icons come with suggestions |
| 2 | `... is not valid JSON at line L, column C` | fix the syntax |
| 3 | `AWS ICON STORE NOT FOUND` | import the pack once, or use `generic` |
| 3 | `FONT MISSING` / `RESVG / WEBASSEMBLY UNAVAILABLE` | the vendored files are damaged or the machine blocks WebAssembly; run `--doctor` |
| 4 | `ELK layout failed` | remove `elk` overrides, check for an edge between a group and one of its own children, try another `direction` |
