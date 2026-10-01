# Layout recipes

The layout engine is ELK (layered, orthogonal routing). It is automatic and deterministic; you steer it with the order of the spec and a few hints. Change one thing at a time and look at the picture after every change.

## 1. Order is a hint

Nodes inside one group are placed in the order they are listed (top to bottom within a column), and edges are laid out in listing order. List things in reading order: entry points first, then each tier, data stores last. A picture that looks scrambled is usually a spec that lists nodes in random order.

## 2. Two zones, one above the other (AZ A above AZ B)

Give both zones the same `rank`, and give their siblings ranks too; inside a zone, give the subnets ranks to make columns (public | app | data):

```json
{ "id": "vpc",    "type": "VPC", "label": "VPC 10.0.0.0/16", "parent": "region" },
{ "id": "az_a",   "type": "Availability Zone", "label": "Availability Zone A", "parent": "vpc", "rank": 2 },
{ "id": "az_b",   "type": "Availability Zone", "label": "Availability Zone B", "parent": "vpc", "rank": 2 },
{ "id": "pub_a",  "type": "Public subnet",  "label": "Public subnet A",        "parent": "az_a", "rank": 0 },
{ "id": "app_a",  "type": "Private subnet", "label": "Private subnet A (app)", "parent": "az_a", "rank": 1 },
{ "id": "data_a", "type": "Private subnet", "label": "Private subnet A (data)", "parent": "az_a", "rank": 2 }
```

Nodes of the VPC itself (internet gateway rank 0, load balancer rank 1) get ranks lower than the zones'. See `examples/aws/medium.json` for the whole picture.

## 3. Internet gateway on the VPC border

```json
{ "id": "igw", "label": "Internet gateway", "icon": "Internet gateway", "group": "vpc", "border": "left", "rank": 0 }
```

## 4. Egress, replies, alerts

An edge that runs against the reading direction gets `"back": true`; otherwise the layout puts its target on the wrong side and the line loops around the picture:

```json
{ "from": "nat_a", "to": "igw", "label": "egress", "back": true }
```

## 5. Several accounts or environments

Use `AWS account` groups (or `Group` / `Blue` ... in the generic profile) side by side or stacked, each with its own Region group, and draw cross-account edges between the nodes inside them. Keep the number of cross-account edges small; every one is a long line. `examples/aws/large.json` has four accounts and an on-premises data centre.

## 6. Too big, too wide, too busy

- More than about 15 nodes with many crossing lines: split into several pictures (overview, then one per tier or account) instead of one wall.
- Very wide: shorten labels, use `\n` in long ones, remove the least important dashed edges, or render with `--width 4600`.
- Labels on lines: keep them to one or two words; put detail in the node labels.
- Lines too close: `"elk": {"elk.spacing.nodeNode": 40, "elk.layered.spacing.nodeNodeBetweenLayers": 50}` at the top level of the spec.

## 7. Things that do not work

- `direction: DOWN` with icon labels: lines run through the labels. Use RIGHT.
- Edges between a group and its own descendants make ELK fail (exit 4).
- A `rank` on only some children of a parent can leave the others unconstrained; rank them all.
- Pictures beyond about 50 nodes can become slow and are unreadable anyway; split them.
