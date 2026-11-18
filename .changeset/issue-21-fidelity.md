---
'svelte-rtf-editor': minor
---

Fixes for what a review of 1.9.0 against outside readers and outside input found (#21, items 1 to 29;
item 30 is the image cap). Most are places where text changed meaning, was lost, or was shown when it
should not be. Three things change for documents that already work, and are listed first.

**Changes to existing behaviour**

- **A heading must be bold as well as large, at every body size.** At 12 pt, size alone used to make
  a heading, so a report set in 14 pt throughout was read as nothing but headings and saved all bold.
  Large text that is not bold is now a paragraph at that size. Headings this library wrote are bold
  and are read as before.
- **Table cells are written `…\cell}` with no `\par`, and a table's last row carries `\lastrow`.**
  With `\par}\cell`, Apple's reader (TextEdit, Pages, Mail) showed an empty second paragraph in every
  cell. RTF written by earlier versions is read as before.
- **Alignment is read as RTF defines it: it holds until `\pard`.** Word and TextEdit state `\qc` once
  for a run of paragraphs or cells; only the first used to be centered.

**Reading RTF**

- Text a tracked change deleted (`\deleted`) is not shown. Hidden text (`\v`) and index and contents
  entries (`\xe`, `\tc`) are not shown, and neither is a footnote that sits in hidden or deleted text.
- Text in the Symbol font is read as the characters it shows (`m` is μ, so "5 mg" is no longer read
  for "5 μg"), including Word's U+F0xx form and `SYMBOL` fields.
- A footnote no longer splits its sentence or takes a table cell out of its table: notes go to the
  end, numbered. Text boxes, pictures with text wrapped around them and the shown result of an
  embedded object are read; they were dropped.
- `\binN` picture data is stepped over. A brace among its bytes used to end the document.
- U+2028 (TextEdit's Shift-Return) is a line break and U+2029 a paragraph mark; a tab character in
  the file is a tab. Other control characters in the file are dropped, whether written as themselves
  or as `\'xx` or `\uN`.
- `\lastrow` ends a table, so two tables in a row are two. A bottom border with a width or a color
  is a drawn line, not a header cell.
- A paragraph of two pictures keeps both through a save. A picture resized in Word (`\picscalex`) is
  shown at that size. A caption with `$` in it is no longer corrupted.
- A byte-order mark or blank lines before `{\rtf1` no longer lose the color and font tables.
- A rule (`<hr>`) is read as one when a space stands before its line of dashes; a pasted document
  with one used to need two saves to settle.
- A long run of spaces, a paragraph of very many tabs and a wide row of merged cells no longer take
  seconds to read. A file of more than five million parts is refused with a `RangeError`
  ("too complex to show") instead of exhausting memory.

**Writing RTF**

- Bold, italic, underline, strikethrough, superscript and subscript set by a style are written, and
  `<b style="font-weight:normal">` (the wrapper of a Google Docs paste) is not bold. `color` on a
  heading, a list item and a table cell is written.
- What the screen does not show is not written: `<style>`, `<script>`, `<template>`, `hidden`,
  `display:none`, `visibility:hidden`, `mso-hide:all`.
- A table's `<caption>` is written, as a centered paragraph before the table. Text typed in a figure
  beside its picture, and a second picture in a figure, are written.
- `<dl>`, `<section>`, `<article>`, `<address>`, `<details>`, `<center>` and the other blocks of a
  pasted page each end their line; their text used to be run together.
- Alignment on a `<div>` or `<center>` around paragraphs is passed to them. A new line in
  `white-space: pre-wrap` text is a line break. Column widths in px, pt, `width="120"` and `<col>`
  are used.
- Control characters never reach the RTF (0x0B and 0x1C frame an HL7 message). A picture that cannot
  be embedded and has no description is written as `[Image: image]`, not as its data URL.
- Loose text after a table starts a plain paragraph. Text typed before a pasted wrapper (the `<b>`
  around a Google Docs paste, a `<span>` around a list) ends its line before the wrapper's first
  block; it used to be run into it ("Diagnosis:Benign nevus").

**Size estimate**

- `estimateRtfBytes` takes the options `htmlToRtf` does (`fontFamily`, `fontSize`), and is no longer
  below the real size for paragraphs in a quotation, lists nested deeper than one level, or many
  distinct colors.

**Markdown**

- A list written straight inside a list is kept. `<sup>`, `<sub>` and `<del>` are kept. Loose text
  before a block, and each `<div>`, is its own paragraph. A `<br>` is a hard break. A quotation of
  several paragraphs stays one quotation. `**bold **` with the space inside is written so that it
  renders. `- ` and `1. ` at the start of a list item, and `&copy;` typed as text, are escaped. A
  table's caption, text in a figure, and the blocks of a pasted page are written; hidden elements
  are not.
- With the rule that code stays code (the changeset beside this one), three things are written
  differently from what that changeset says. A code block inside a heading is a code span on the
  heading's line, and inside bold text or a link it is the block alone, with no marks around it.
  Underline around a quotation, a list or a table is written on the text inside, not dropped. An
  empty line in a paragraph is a `<br>` at the end of the line before it, so no tag stands alone
  on a line; `<ins>`, `<sup>` and `<sub>` go around the text itself as `<u>` does.
- Found by rendering the export with an outside Markdown reader. In each of these a line of the
  document could come out as HTML in a viewer that allows it; the first three were so in 1.9.0.
  - Code right after code is one code span. Two spans back to back ran their backticks together
    (`` `a``b` ``); RTF makes that of code text that changes color.
  - A `|` is escaped in all text, not only in a table cell. Two typed lines such as
    `Stain | Result` and `--- | ---` were a table to a viewer that knows tables, which dropped
    text that did not fit its columns and cut a code span at its `|`.
  - A numbered list starts no lower than 0 and ends no higher than 999999999. `start="-3"` was
    written as `-3.`, which is no list marker.
  - A line that holds white space alone (a no-break space, a tab) is written as `&nbsp;`, so the
    `<br>` after it is not first on its line. A tab at the start of a line is written as `&#9;`:
    as a tab it made the line a code block.
