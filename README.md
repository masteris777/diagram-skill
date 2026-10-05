# diagram-skill

An agent skill that draws architecture diagrams. Describe the system; the agent writes a small JSON spec, runs one script and gets a clean PNG (and SVG) for your document. Offline, no browser, no Graphviz, nothing to install beyond Node.js.

![Event-driven order processing, drawn from a 36-line spec](.apm/skills/diagram/examples/aws/event-driven.png)

- **Two profiles.** `aws`: AWS architecture style with the official AWS Architecture Icons (you import the pack once, see below). `generic`: any architecture, with 26 bundled icons.
- **No coordinates, unless you want them.** Layout (ELK), orthogonal line routing, group styles, numbered step badges and labels are automatic. Hints (`rank`, `back`, `border`) steer the few cases that need it, and an optional layout file pins nodes to grid cells for exact rows and columns.
- **Agent friendly.** `SKILL.md` teaches the loop: write the spec, `--check` (all problems at once, with "did you mean"), render, read the review, look at the picture, refine. Pictures take 0.5 to 3 s.
- **Self-review.** Every render ends with measured faults (lines through icons, crossings, bends in the main flow, detours, misaligned icons, big empty areas) and a check against the requested frame (`"frame": {"aspect": "4:3", "maxWidth": 1400}`). The layout engine tries several layouts and keeps the one with the fewest faults.
- **Zero install, deterministic.** The three runtime components are vendored and verified against SHA-256 sums. No network at install or run time; the same spec gives the same bytes on Windows and Linux (Node 18 and 24 tested).

## Requirements

- **Node.js 18 or newer** on the PATH (tested with 18, 20, 22 and 24; `node --version` shows yours), with WebAssembly enabled, which is the default. That is all the skill needs to run: no `npm install`, no Python, browser, Graphviz, system fonts, network access or admin rights. elkjs, resvg-wasm and the font are inside the skill (about 6 MB).
- **Windows or Linux.** Tested on Windows 11 and Debian. macOS should work (plain JavaScript and WebAssembly) but is untested.
- **For `aws` pictures, your own copy of the AWS Architecture Icons**, imported once (see [the AWS icons](#the-aws-icons-bring-your-own)). The `generic` profile needs nothing.
- **An agent that reads `SKILL.md` skills and can run shell commands.** It should also be able to view PNG files, so it can check and fix the picture; without that it still renders, but you review the result yourself. Developed and tested with Claude Code; other agents are untested.
- **APM is optional.** It only installs the skill, and it needs git (and Python 3.10+ if you install APM itself with pip). Without APM, copy the folder.

`node .claude/skills/diagram/scripts/diagram.mjs --doctor` checks the Node version, the vendored files (SHA-256), WebAssembly with font rendering, and each profile's icons.

## Install

With [APM](https://github.com/microsoft/apm) (Agent Package Manager):

```
apm install masteris777/diagram-skill#v0.2.0
```

APM copies the skill to `.claude/skills/diagram/` (Claude Code) and `.agents/skills/diagram/` (Copilot, Cursor, Gemini and others), whichever targets your project uses. Without APM, copy `.apm/skills/diagram/` to the folder your agent reads skills from, or run the script directly. APM installs with its own installer, Homebrew, WinGet, Scoop or `pip install apm-cli`; see its README.

A private copy of this repository installs the same way, with the GitHub credentials already on the machine (for example after `gh auth login`).

```
node .claude/skills/diagram/scripts/diagram.mjs --doctor      # is this machine ready?
node .claude/skills/diagram/scripts/diagram.mjs spec.json out.png --svg --width 2400
```

## Use

Ask your agent for a diagram ("draw the three-tier architecture of our web shop as an AWS diagram, steps numbered") and it follows `SKILL.md`. Or write a spec yourself:

```json
{ "title": "Serverless API", "profile": "aws",
  "groups": [ { "id": "cloud", "label": "AWS Cloud", "type": "AWS Cloud" } ],
  "nodes": [
    { "id": "users", "label": "Users",              "icon": "Users" },
    { "id": "api",   "label": "Amazon API Gateway", "icon": "Amazon API Gateway", "group": "cloud" },
    { "id": "fn",    "label": "AWS Lambda",         "icon": "AWS Lambda",         "group": "cloud" } ],
  "edges": [
    { "from": "users", "to": "api", "label": "HTTPS request", "step": 1 },
    { "from": "api",   "to": "fn",  "label": "invoke",        "step": 2 } ] }
```

Positions are automatic. When you want a node in a particular place, add a layout file next to the spec (`spec.layout.json`): render once with `--save-layout`, move cells, render again. Nodes without a cell stay automatic; `nudge` moves one node by a few pixels.

```json
{ "grid":  { "users": [0, 0], "api": [1, 0], "fn": [1, 1] },
  "nudge": { "fn": [0, 8] } }
```

The picture at the top is drawn this way: [event-driven.json](.apm/skills/diagram/examples/aws/event-driven.json) says what exists, [event-driven.layout.json](.apm/skills/diagram/examples/aws/event-driven.layout.json) where it goes. The medium and large examples have layout files too.

Reference: [SKILL.md](.apm/skills/diagram/SKILL.md), [spec](.apm/skills/diagram/references/spec.md), [layout recipes](.apm/skills/diagram/references/layout.md), [AWS style](.apm/skills/diagram/references/aws-style.md), [profiles](.apm/skills/diagram/references/profiles.md).

## The AWS icons (bring your own)

AWS lets customers and partners use its icons to create architecture diagrams but states no right to redistribute them, so they are not in this repository. One person downloads the "Icon package" zip from <https://aws.amazon.com/architecture/icons/> and imports it once per AWS release:

```
node .claude/skills/diagram/scripts/diagram.mjs --import-icons Icon-package_07312026.zip
```

The import builds a per-user icon store (`%LOCALAPPDATA%\diagram-skill`, `~/Library/Application Support/diagram-skill` or `~/.local/share/diagram-skill`; `DIAGRAM_SKILL_HOME` overrides) outside the skill, so skill updates never remove it. Teams can keep the zip in an internal store and point `DIAGRAM_SKILL_ICONS` at a shared store file. Without the pack, use `"profile": "generic"`.

## Examples

| | |
|---|---|
| ![three-tier web application](.apm/skills/diagram/examples/aws/medium.png) | ![generic platform overview](.apm/skills/diagram/examples/generic/platform.png) |
| [aws/medium.json](.apm/skills/diagram/examples/aws/medium.json): 3-tier app, mirrored AZs, 8 steps | [generic/platform.json](.apm/skills/diagram/examples/generic/platform.json): generic icons, coloured groups |
| ![generic web shop](.apm/skills/diagram/examples/generic/web-app.png) | ![generic icons](.apm/skills/diagram/examples/generic/icon-sheet.png) |
| [generic/web-app.json](.apm/skills/diagram/examples/generic/web-app.json) | the 26 bundled generic icons |

More: [aws/tiny](.apm/skills/diagram/examples/aws/tiny.json), [aws/large](.apm/skills/diagram/examples/aws/large.json) (four accounts and an on-premises data centre, 35 nodes), [aws/event-driven](.apm/skills/diagram/examples/aws/event-driven.json).

## How it works

spec (JSON) -> validation -> ELK layered layout on several seeds, a cost function picks the best -> own routing for stacked groups -> SVG with the icons as `<symbol>` -> PNG with resvg (WebAssembly) and a bundled Liberation Sans font. Everything provider specific (group styles, icon names, icon source) lives in a profile, so more providers are new folders under `profiles/`.

## Limits

- Not for sequence diagrams, charts, ER or UML class diagrams.
- Nested AWS pictures usually need 2 to 4 look-and-fix rounds; the agent has to look at the PNG. For exact placement, use a layout file (grid cells).
- A frame narrower than the natural layout is met by folding the flow into rows, which works for pictures without groups and only a little with nested groups. Beyond roughly 35 nodes, split into several pictures. `direction: DOWN` makes lines cross node labels; prefer `RIGHT`.
- Text is set in Liberation Sans: Latin, Greek and Cyrillic work; CJK and emoji do not.
- Tested on Windows 11 and Debian containers (Node 18 and 24, non-root, no network, no system fonts). Not tested: macOS, Windows on ARM, Alpine, behind a TLS-intercepting proxy, with security software that blocks WebAssembly.
- resvg-wasm is 2.6.2 (2024); rare SVG features are missing.

## Security and provenance

No network access at run time, no install scripts, no native binaries (WebAssembly is data). The script reads the spec and icon files you point it to and writes the PNG/SVG and the per-user icon store. `vendor/SHA256SUMS` lists every vendored file; `--doctor` and the tests verify it; `vendor/README.md` records versions, sources and npm integrity values. `apm audit` reports no hidden Unicode in the package.

## Development

```
node test/run.mjs                                   # tests, also what CI runs
node test/run.mjs --aws-pack <zip|folder>           # also the AWS examples with the real icon pack
node test/run.mjs --update [--aws-pack P]           # re-render the example pictures and golden hashes (look first)
node tools/make-generic-icons.mjs && node tools/icon-sheet.mjs
```

## Contributors

- [masteris777](https://github.com/masteris777): author and maintainer.
- [Claude](https://www.anthropic.com/claude) (Anthropic): co-developed the engine, tests and documentation with the author, working in Claude Code.

## Licence

MIT, see [LICENSE](LICENSE). Vendored components keep their licences (EPL-2.0, MPL-2.0, OFL-1.1): [NOTICE.md](NOTICE.md). Not affiliated with Amazon Web Services; AWS and the AWS Architecture Icons are Amazon's.
