# Vendored dependencies

Everything the renderer needs at run time is in this folder, so installing the skill is the whole installation: no `npm install`, no registry, no network.
The files are unmodified copies of the published npm packages (only `elk.bundled.js` got the extension `.cjs`, so Node always treats it as CommonJS wherever the skill is installed).

| Files | Upstream | Version | Licence | Source |
|---|---|---|---|---|
| `elk.bundled.cjs`, `ELK-LICENSE-EPL-2.0.md` | elkjs (Eclipse Layout Kernel for JavaScript) | 0.12.0 | EPL-2.0 (elkjs is offered under EPL-2.0 OR GPL-3.0-or-later; this project uses it under the EPL-2.0) | https://github.com/kieler/elkjs and https://github.com/eclipse/elk |
| `resvg-wasm/index.mjs`, `resvg-wasm/index_bg.wasm`, `resvg-wasm/LICENSE-MPL-2.0.txt` | @resvg/resvg-wasm (resvg compiled to WebAssembly) | 2.6.2 | MPL-2.0 | https://github.com/yisibl/resvg-js and https://github.com/RazrFalcon/resvg |
| `fonts/LiberationSans-Regular.ttf`, `fonts/LiberationSans-Bold.ttf`, licence and authors files | Liberation Sans (metric-compatible with Arial) | 2.1.5 | SIL OFL 1.1 | https://github.com/liberationfonts/liberation-fonts |

npm integrity of the tarballs the files were taken from (npm `package-lock.json` values):

- `elkjs-0.12.0.tgz`: `sha512-YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ==`
- `resvg-wasm-2.6.2.tgz`: `sha512-FqALmHI8D4o6lk/LRWDnhw95z5eO+eAa6ORjVg09YRR7BkcM6oPHU9uyC0gtQG5vpFLvgpeU4+zEAz2H8APHNw==`

`SHA256SUMS` lists the SHA-256 of every vendored file. `node scripts/diagram.mjs --doctor` verifies it, and the test suite does too, so a modified or corrupted file is reported instead of silently used.

To update a dependency: `npm pack elkjs@<version>` (or `@resvg/resvg-wasm@<version>`) in a scratch folder, copy the files listed above over the ones here, regenerate `SHA256SUMS`, update the table, and run `node test/run.mjs`. A new resvg or ELK version can change pixels or layouts, so the golden hashes in `test/golden.json` will change; review the pictures before accepting them.
