---
'svelte-rtf-editor': patch
---

In the Markdown export, code stays code. `htmlToMarkdown` escapes text and writes code as it is, so
code is safe only inside its code span or its fenced block. Through 1.9.0 there were shapes that put
it outside, where a Markdown viewer that allows HTML would read a line such as
`<img src=x onerror=…>` as HTML and a `[text](javascript:…)` as a link. One of them can be made by
an RTF file alone; the others need pasted HTML or HTML from the host. On screen, in `RtfViewer` and
in the editor, the same text was always escaped: this is the export only.

- A line break in a code span is written as a space. An empty line used to end the paragraph, and
  the span with it. RTF can put one there (`\'0a`, `\u10`) in a run set in a code font.
- A code block starts a line of its own whatever is around it. Inside a heading, bold text, a link,
  or after text that an element around it wrote (`<div>See<span><pre>`), its fence used to follow
  other text on the line and was not a fence.
- Every line of a quotation carries its `>`. Only the first did, so the second paragraph of a
  quotation, and the body of a code block in one, were outside it. A quotation after text starts a
  line of its own (`Note<blockquote>` was `Note> …`).
- `<u>` is written around the text itself, with a line break at either end outside it: a tag alone
  on a line opens a block of HTML, in which `\<` is no escape. It is not written around a code
  block, a quotation, a list or a table.
- `-`, `>` and `1.` at the start of a line are escaped in the text of a paragraph, not in what a
  list or a quotation inside the same `<div>` wrote. A list in a `<div>` used to come out as
  `\- item`, and a quotation as `\> …`, which also took a code block out of it.
- A lone carriage return in a code block is a line break like any other.

`rtfToHtml`: a figure's caption that holds `$&` or `` $` `` is read as those characters. The caption
was put in with `String.replace` and a replacement string, so `$&` wrote `</figure>` into it and
`` $` `` wrote the figure a second time, inside a link's address if that is where it stood.
