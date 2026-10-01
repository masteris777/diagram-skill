# Third-party notices

The code, documents and generic icons of this repository are MIT licensed (see `LICENSE`).

## Redistributed, unmodified

These files are copied unchanged from the published npm packages into `.apm/skills/diagram/vendor/` (versions, sources and checksums: `.apm/skills/diagram/vendor/README.md`):

| Component | Version | Licence | Where the source is |
|---|---|---|---|
| elkjs (Eclipse Layout Kernel for JavaScript) | 0.12.0 | EPL-2.0 (elkjs is offered as EPL-2.0 OR GPL-3.0-or-later; it is used here under the EPL-2.0). Licence text: `vendor/ELK-LICENSE-EPL-2.0.md` | https://github.com/kieler/elkjs and https://github.com/eclipse/elk |
| @resvg/resvg-wasm (resvg compiled to WebAssembly) | 2.6.2 | MPL-2.0. Licence text: `vendor/resvg-wasm/LICENSE-MPL-2.0.txt`. The `.wasm` binary is distributed unmodified | https://github.com/yisibl/resvg-js and https://github.com/RazrFalcon/resvg |
| Liberation Sans (Regular and Bold) | 2.1.5 | SIL Open Font License 1.1. Licence text: `vendor/fonts/LICENSE-Liberation-OFL-1.1.txt` | https://github.com/liberationfonts/liberation-fonts |

## AWS

This project is not affiliated with, endorsed by or sponsored by Amazon Web Services. AWS, Amazon and the AWS Architecture Icons are trademarks or materials of Amazon.com, Inc. or its affiliates.

The AWS Architecture Icons are **not part of this repository**. AWS publishes them for customers and partners "to create architecture diagrams" but states no right to redistribute them, so each user downloads the pack from https://aws.amazon.com/architecture/icons/ and imports it locally (`--import-icons`). The imported store stays on the user's machine; do not publish or bundle it.

The pictures in `.apm/skills/diagram/examples/aws/` are architecture diagrams drawn with those icons, unmodified and at their predefined colours. Delete those `.png` files if that does not fit your policy; nothing else depends on them.

This is not legal advice.

## Generic icons

The icons in `.apm/skills/diagram/profiles/generic/icons/` were drawn for this project (`tools/make-generic-icons.mjs`) and are MIT licensed like the code.
