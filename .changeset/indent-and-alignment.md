---
'svelte-rtf-editor': minor
---

Increase and Decrease indent: toolbar buttons, `Ctrl+]` / `Ctrl+[` (`Cmd` on a Mac), and Tab or
Shift+Tab over several selected lines. Each step moves the paragraphs 0.5 in, written to RTF as
`\li720`; lists move as a whole. Paragraph alignment now reaches the RTF (`\qc`, `\qr`, `\qj`):
through 1.6.0 a centered or right-aligned paragraph was written left-aligned. Indented blocks
pasted from Chromium (a blockquote with `border: none`) or Firefox (margin-left) are read as indents, not
as italic quotations.

A Quote block or a picture moves as a whole, an indent pasted from Chromium can be decreased, and
Undo also takes back the paragraph a loose line was given. Text after a centered or indented block
no longer inherits that layout in the RTF.
