---
'svelte-rtf-editor': patch
---

`rtfToHtml` no longer throws "Maximum call stack size exceeded" on RTF with thousands of nested
groups. Groups nested deeper than 500 are folded into the group at that depth: their text is kept,
and their formatting ends where that group ends. Real documents nest a few dozen deep at most.
