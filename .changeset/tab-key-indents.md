---
'svelte-rtf-editor': minor
---

Tab indents in the editor instead of moving focus to the next control. Tab inserts a tab, written to
RTF as `\tab`; Shift+Tab removes one tab from the start of the line; Esc, then Tab, moves focus out.
RTF read back keeps `\tab` as a tab (it was an em space, written out again as `\u8195`), except after
a list marker.
