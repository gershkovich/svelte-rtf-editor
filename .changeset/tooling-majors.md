---
'svelte-rtf-editor': patch
---

**Tooling** (nothing in the published package changes)

- Vitest 5 and `@changesets/cli` 3, the tools that run the tests and write this changelog. The
  files in `dist/` are byte for byte what the older tools built. TypeScript stays at 6: SvelteKit,
  `svelte-check` and `svelte-package` do not run with TypeScript 7 yet.
