# Changelog

## 0.1.0

First release.

- Skill `diagram` (SKILL.md plus references) for agents that read skills; installable with APM.
- Engine: JSON spec, ELK layered layout on several seeds with a cost function, own routing for stacked groups, SVG with `<symbol>` icons, PNG with resvg-wasm and Liberation Sans. Output is deterministic (ELK seed 0, which means "random", is never used).
- Profiles: `aws` (official AWS Architecture Icons, imported once per user, never bundled) and `generic` (26 bundled icons, coloured groups); `--icons-dir` for your own SVG icons.
- `--doctor`, `--find`, `--types`, `--check`, `--import-icons`; all spec problems are reported at once with suggestions.
- Vendored runtime (elkjs 0.12.0, @resvg/resvg-wasm 2.6.2, Liberation Sans 2.1.5) with SHA-256 sums; no install step, no network.
- Tests with golden hashes (`node test/run.mjs`) and a GitHub Actions workflow (Ubuntu and Windows, Node 18, 20, 22, 24).
