---
'svelte-rtf-editor': minor
---

Tables with merged cells, lists, links and code now survive a save and a reload, and a set of
places where text was lost or changed is fixed (#2, #3). Ordinary content (paragraphs, bold, italic,
headings, lists one level deep, quotes, code, rules, tables with no merged cells, figures) is
written as before, with one exception: a document that holds a link now has the link color in its
color table.

**Tables (#2)**

- `htmlToRtf` works out a table's columns once and writes every row against the same `\cellx`
  edges. Through 1.8.0 each row was divided by its own number of cells, so a table with `rowspan`
  or `colspan` came out with columns that did not line up, and the merged cell covered one row.
- `rowspan` is written as `\clvmgf` and `\clvmrg`, `colspan` as one cell that ends at the right
  edge of the last column it covers. `rtfToHtml` reads both back, and `\clmgf` / `\clmrg` too.
- Only a `<th>` gets the header border, not every cell of its row. `<thead>` is written first and
  `<tfoot>` last, wherever the source has them. A cell's own `text-align` is written; through 1.8.0
  a right-aligned cell read from RTF was written back left-aligned.
- A table inside a table cell is written as lines of text in that cell, its cells a tab apart. It
  used to open a row inside the cell, which is not valid RTF.
- A row whose definition is repeated before `\row`, which is how Word writes every row, keeps its
  cells. Through 1.8.0 such a table was read with every row empty.
- Two paragraphs in one cell are read as two lines. They were run together into one word.
- `\intbl` with no `\row` no longer makes one paragraph of the rest of the document.
- A table row the file ends in the middle of keeps its cells, and text after a row's last `\cell`
  is a cell: both were lost or run into the next paragraph.

**Lists (#3)**

- A list the writer sent is read back as `<ul>` or `<ol>`, with lists inside list items and
  `<ol start>`. It used to come back as paragraphs that began with a bullet character. Word's lists
  are read too. A line typed with a dash or a number, or a list in any other shape, stays a paragraph.
- A list inside a list item is indented one level further, and the item before it ends before it:
  the item and its first child used to be written as one paragraph.
- `<ol start="5">` counts from 5. A list item that holds a paragraph (`<li><p>`, as Word and Google
  Docs paste) keeps its marker and indent. A list written straight inside a list (`<ul><ul>`) is no
  longer dropped, and an item with no list around it no longer runs into the next.
- A list made with the toolbar's list buttons is no longer followed by an empty paragraph in the
  RTF. Chromium leaves such a list inside the paragraph it was made from (`<p><ul>…</ul></p>`), and
  that paragraph was written too.

**Links, code, headings, rules**

- A link is read back as a link, for a web, mail or phone address only; any other field is read as
  its text. Link text is written in a link color of its own. `htmlToMarkdown` writes an unsafe link
  as its text alone, as `htmlToRtf` does.
- Text in a monospace font is read as `<code>`, and a code block as `<pre>`. Both lost their font
  on a reload.
- A heading is read with no size or bold inside it, and one large word no longer turns its
  paragraph into a heading. `<h4>`, `<h5>` and `<h6>` are written as paragraphs of their own;
  `<h4>title</h4><p>x</p>` was written as "titlex".
- `<hr>` is read back as `<hr>`. `\page` is read as a rule marked as a page break and written back
  as `\page`.
- The `<br>` a browser leaves at the end of a paragraph is no longer written as an extra line.

**Reading RTF from other programs**

- A `\'` with no hex digits after it, and `\'00`, add no NUL character to the HTML.
- `\pard` no longer ends bold, italic, underline and strikethrough; only `\plain` does.
- `\sect` ends a paragraph. A character outside the Basic Multilingual Plane in formatted text is
  one element, not two halves, and accented text in one format is one element.
- A `\u` out of range no longer throws, groups nested 100,000 deep no longer overflow the stack,
  and color components are kept within 0 to 255.
- Non-breaking and em spaces at the ends of a paragraph are kept.

**New**

- `rtfToHtml` and `readRtfFile` take `maxBytes` and refuse a larger document: `rtfToHtml` throws a
  `RangeError`, `readRtfFile` rejects before reading the file, and `RtfViewer` shows the message in
  place of the document. The default, `DEFAULT_MAX_RTF_BYTES`, is 50 MB; `0` reads any size. This is
  the one change that can make a call fail that worked before.
- `htmlToMarkdown` writes tables, escapes the characters Markdown reads as markup, and starts a
  numbered list from its `start`.
- A picture pasted with text from a web page is fetched and embedded, as one added by address in
  the image dialog is. When it cannot be, the editor says that it will export as a placeholder.
- `estimateRtfBytes` counts all of the above, and no longer undercounts blank lines in a code
  block, text after a quotation or a list, or a paragraph after text with no paragraph of its own.
- CI runs the type check, the tests and the package build on every push and pull request, and the
  publish workflow runs them before it publishes.
