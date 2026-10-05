---
name: diagram
description: Draws architecture diagrams as PNG and SVG pictures from a small JSON description (components, groups, flows, numbered steps). Use it when the user asks for an architecture diagram, a cloud or system diagram, a data-flow picture or any box-and-arrow figure for a document, especially AWS architecture diagrams with the official AWS icons. Runs offline with Node 18+ only: no browser, no Graphviz, nothing to install.
---

# diagram

You describe the system in a JSON spec (no coordinates), run one script, and look at the picture it writes. Layout, line routing, icons, group styles and numbered step badges are done by the script.

Two profiles (pick one per picture with `"profile"` in the spec):

- `aws` (default): AWS architecture style with the official AWS Architecture Icons. The icons are not shipped; the user imports them once (see "First run").
- `generic`: any architecture, with 26 bundled icons (user, users, mobile, laptop, browser, server, function, container, service, timer, database, cache, storage, document, queue, topic, mail, api, globe, cloud, load-balancer, router, firewall, lock, key, monitor).

Not for sequence diagrams, charts, ER or UML class diagrams, or free-hand illustrations.

## Run it

`<skill>` is the folder that contains this file, for example `.claude/skills/diagram` or `.agents/skills/diagram`. Only Node 18+ is needed.

```
node <skill>/scripts/diagram.mjs spec.json out.png --svg --width 2400     # PNG (+ out.svg); use --width 4600 for big pictures
node <skill>/scripts/diagram.mjs spec.json --check                        # validate only: lists ALL problems at once
node <skill>/scripts/diagram.mjs --find "load balancer" [--profile P]     # search icon names
node <skill>/scripts/diagram.mjs --types [--profile P]                    # group types of a profile
node <skill>/scripts/diagram.mjs --doctor                                 # is this machine ready? (Node, vendored files, fonts, icons)
```

Exit codes: 0 ok, 2 problem in the spec (message lists each one, with "did you mean"), 3 setup problem (icons or fonts missing), 4 layout failure.

## First run

1. `--doctor`. Fix any `FAIL` line first.
2. `aws` profile only: if doctor says the icon store is not set up, ask the user to download the "Icon package" zip from https://aws.amazon.com/architecture/icons/ (a person with a browser, once per AWS release) and run `node <skill>/scripts/diagram.mjs --import-icons <the .zip or the extracted folder>`. The store is kept per user outside the skill (`%LOCALAPPDATA%\diagram-skill`, `~/Library/Application Support/diagram-skill` or `~/.local/share/diagram-skill`; `DIAGRAM_SKILL_HOME` overrides), so updating the skill does not remove it. If the user cannot get the pack, use the `generic` profile.

## Workflow

1. Get the facts: components, which group each belongs to (cloud, region, VPC, zone, subnet, account, on-premises), who talks to whom, the order of the main flow. Ask at most three questions; assume the rest and say what you assumed.
2. Write `spec.json` next to the document it is for (keep it, so the picture can be regenerated). List nodes and edges in reading order: it drives the layout.
   If the user says how the picture must fit (a page width, "landscape slide", "narrow, may grow downwards"), put it in `"frame"` with their words as `intent`: `{"intent": "fits a 16 cm column, may grow downwards", "aspect": "any", "maxWidth": 1200}`. Without a frame the target is 4:3, as a hint only.
3. `--check`, fix everything it reports, render.
4. **Read the review lines** the script prints after the PNG line: frame met or missed, then measured faults, worst first (lines through icons, crossings, bends in the main flow, detours, misalignment, big empty areas). The table in `references/spec.md` gives the usual fix for each kind.
5. **Open the PNG and look at it** with your image-reading tool. (If you cannot view images, say so, rely on `--check` and the review, and ask the user to review the picture.) Check:
   - every component is there, in the right group (NAT and ALB in public subnets, databases in private ones, global services and users outside the Region);
   - the flow reads left to right, step badges run 1..n in order;
   - AZ A above AZ B, internet gateway on the VPC border;
   - no label over an icon or a line, no line through an icon, no group title crossed;
   - the shape suits where it goes, and the text is readable at that width (the review prints the label size at 16 cm wide; 6 pt or more reads well on a page);
   - solid lines are the main flow, dashed lines are secondary (async, logs, replication).
6. Fix with the hints below and render again. When the automatic layout cannot give what is needed (a node in a particular place, rows that must line up, a more compact arrangement), use a layout file: render once with `--save-layout`, then move nodes by editing their `[column, row]` cells in `spec.layout.json` and render again (see "Layout file" below). A frame the user asked for is a requirement; the default 4:3 is not. To make a picture narrower: fewer columns (stack groups with equal `rank`), a flat picture without groups (it can fold into rows), or split it. Expect 1 round for up to about 10 nodes and 2-4 rounds for nested AWS pictures. After four rounds, simplify or split into several pictures of up to about 15 nodes each, and tell the user which findings are left.
7. Give the user the path of the PNG (and the SVG if they want a vector) and the spec.

## Spec

```json
{ "title": "optional title", "profile": "aws", "direction": "RIGHT",
  "groups": [ {"id":"cloud","label":"AWS Cloud","type":"AWS Cloud"},
              {"id":"vpc","label":"VPC 10.0.0.0/16","type":"VPC","parent":"cloud"} ],
  "nodes":  [ {"id":"users","label":"Users","icon":"Users"},
              {"id":"alb","label":"Application Load Balancer","icon":"Application Load Balancer","group":"vpc"} ],
  "edges":  [ {"from":"users","to":"alb","label":"HTTPS","step":1} ] }
```

- Ids are yours. Groups nest with `parent`; a node sits in a `group`; a node without a group is drawn outside every group. Edges may also end on a group id.
- `icon`: the official service name for `aws` ("AWS Lambda", "Amazon S3 (bucket)", "Amazon DynamoDB"; aliases such as ALB, NLB, IGW, NAT work), an icon name for `generic`. Unknown names get the nearest matches. No icon exists for it? Use `"icon": "box"` (plain labelled box); never guess an unrelated icon.
- Edge: `label`, `step` (positive integer, drawn as a black numbered badge; the same number on parallel edges is fine), `style` solid | dashed | dotted (add "no arrowhead" for a plain line), `arrows` end | start | both | none.
- Labels wrap by themselves; `\n` forces a line break.
- Group `type` for `aws`: AWS Cloud, Region, Availability Zone, VPC, Public subnet, Private subnet, AWS account, Corporate data center, Security group, Auto Scaling group, Generic, Generic solid (more via `--types`). For `generic`: Group (default, dashed grey), Group solid, and Blue, Green, Orange, Purple, Red, Teal, each solid or "... dashed".
- Full reference: `references/spec.md`.

## Layout hints (only when the picture needs them)

- `"direction"`: RIGHT (default) reads best. DOWN makes lines cross node labels; avoid it.
- `"back": true` on an edge that runs against the reading direction (egress, replies, alerts).
- `"rank": N` on groups or nodes = column index inside their parent. Groups of one parent with the same rank are stacked in one column (AZ A above AZ B). Give every child of that parent a rank.
- `"border": "left"` on a node puts it on its group's border (internet gateway on the VPC edge).
- `"elk": {"elk.spacing.nodeNode": 40}` passes raw layout options (spec, group, node or edge level). `--layouts 12` tries more layouts.
- **Layout file** (`spec.layout.json` next to the spec, used automatically): `{"grid": {"id": [column, row]}, "nudge": {"id": [dx, dy]}, "gap": [x, y]}`. Cells give exact rows and columns; nodes without a cell stay automatic. `--save-layout` writes the current layout as cells to start from. Keep a node out of the cells of groups it is not in. A line cannot enter an icon from below (the label is there), so put a target beside or above its source rather than straight under it when a label must stay readable. Details: `references/spec.md`.
- Recipes and spec fragments: `references/layout.md`. Style rules and check list for AWS pictures: `references/aws-style.md`. Working specs with pictures: `examples/aws/` and `examples/generic/`.

## Rules

- Never write pixel coordinates or edit the SVG by hand; change the spec or the layout file's cells and render again.
- Do not recolour, crop or redraw AWS icons, and never copy the imported icon store or AWS icon files into a repository or document package. Finished pictures are fine to share.
- Keep the AWS and Amazon names as AWS writes them; this skill is not affiliated with AWS.
