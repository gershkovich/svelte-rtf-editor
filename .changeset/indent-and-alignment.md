---
'svelte-rtf-editor': minor
---

Increase and Decrease indent: toolbar buttons, `Ctrl+]` / `Ctrl+[` (`Cmd` on a Mac), and Tab or
Shift+Tab over several selected lines. Each step moves the paragraphs 0.5 in, written to RTF as
`\li720`; lists move as a whole. Paragraph alignment now reaches the RTF (`\qc`, `\qr`, `\qj`):
through 1.6.0 a centered or right-aligned paragraph was written left-aligned. Indented blocks
pasted from Chromium (a margin-only blockquote) or Firefox (margin-left) are read as indents, not
as italic quotations.
