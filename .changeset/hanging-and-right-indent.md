---
'svelte-rtf-editor': minor
---

Hanging indent and right indent, the two RTF paragraph indents the editor could not set. Four
toolbar buttons move a paragraph 0.5 in per press: Increase and Decrease hanging indent
(`\li720\fi-720`: every line but the first moves, the first stays), and Increase and Decrease right
indent (`\ri720`). `htmlToRtf` now writes `margin-right` as `\ri`; through 1.7.0 it was dropped.
Decrease indent stops where the first line of a hanging paragraph reaches the left edge.

`rtfToHtml` reads `\li`, `\ri` and `\fi` back as `margin-left`, `margin-right` and `text-indent`, so
`RtfViewer` and an editor loaded from RTF show a document's indents; through 1.7.0 every paragraph
came back flush left. Lists the writer sent now come back indented too.

Hang at caret: a toolbar button that sets the hanging indent to where the caret is, for a hang of
any distance. After a tab it also sets a tab stop at the new indent, written to RTF as `\tx`.

Copy format: a toolbar button that copies one paragraph's alignment and indents to each paragraph
clicked after it, until Done, Esc or the button again.

A pasted paragraph no longer keeps the `id` of the one it was copied from, or the margins the
browser wrote out for it, and a line the browser makes as a `<div>` is spaced like a `<p>`: through
1.7.0 those lines sat closer together than the paragraphs around them.
