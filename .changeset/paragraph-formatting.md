---
'svelte-rtf-editor': minor
---

`htmlToRtf` writes a paragraph's own formatting: `margin-left` as `\li`, `text-indent` as `\fi`,
`margin-top` and `margin-bottom` as `\sb` and `\sa`, `break-after: avoid` as `\keepn`, and the stops
in `data-rtf-tab-stops` as `\tx`. A paragraph without them writes exactly as before. A blank line
after a formatted paragraph now restates `\pard`, so it does not take on that paragraph's indent. A `<div>` that wraps paragraphs passes its left indent to them and no longer adds a blank line after
them.
