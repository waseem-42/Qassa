# قَصّة — brand files

The full identity (name and voice, colours, type, components, rules) is the design system
**قَصّة**: https://claude.ai/artifact/QrcjCzbMUBFz5pRZ7o1Krv — read its README before changing the UI.

- `qassa-mark-on-dark.svg` — the mark on dark grounds (the editor).
- `qassa-mark-on-light.svg` — on light grounds (deeper gold, 3.6:1 on white).
- `qassa-app-icon.svg` — app icon / favicon (copied to `packages/app/public/favicon.svg`).

In code: the tokens live in `packages/app/src/index.css` (`@theme`, as `--color-<token>`), the mark
and icons in `packages/app/src/components/Brand.tsx`.
