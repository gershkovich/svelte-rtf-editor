# svelte-rtf-editor

## 1.9.0

### Minor Changes

- 44e6e8f: Tables with merged cells, lists, links and code now survive a save and a reload, and a set of
  places where text was lost or changed is fixed (#2, #3). Ordinary content (paragraphs, bold, italic,
  headings, lists one level deep, quotes, code, rules, tables with no merged cells, figures) is
  written as before, with one exception: a document that holds a link now has the link color in its
  color table.

  **Tables (#2)**

  - `htmlToRtf` works out a table's columns once and writes every row against the same `\cellx`
    edges. Through 1.8.3 each row was divided by its own number of cells, so a table with `rowspan`
    or `colspan` came out with columns that did not line up, and the merged cell covered one row.
  - `rowspan` is written as `\clvmgf` and `\clvmrg`, `colspan` as one cell that ends at the right
    edge of the last column it covers. `rtfToHtml` reads both back, and `\clmgf` / `\clmrg` too.
  - Only a `<th>` gets the header border, not every cell of its row. `<thead>` is written first and
    `<tfoot>` last, wherever the source has them. A cell's own `text-align` is written; through 1.8.3
    a right-aligned cell read from RTF was written back left-aligned.
  - A table inside a table cell is written as lines of text in that cell, its cells a tab apart. It
    used to open a row inside the cell, which is not valid RTF.
  - A row whose definition is repeated before `\row`, which is how Word writes every row, keeps its
    cells. Through 1.8.3 such a table was read with every row empty.
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

  **From the review of this release**

  - Text typed straight into the editor before a list, a heading, a table, a code block, a rule or a
    quotation ends its own line. Chromium leaves the first line typed into the editor as loose text
    (`Diagnosis:<ul>…`), and through 1.8.3 it ran into the block's first line: "Diagnosis:• x", or
    "Margins:" inside the table's first cell.
  - A table cell is read as a header only with a bottom border and no other. Word and TextEdit put
    all four borders on every cell of a gridded table, and those cells were read as headers.
  - Pasted pictures are fetched at the same time, each given up after 15 seconds or at 25 MB, so one
    slow site no longer holds up the rest. A picture pasted as data in a format RTF cannot carry
    (GIF, WebP, SVG), or larger than `maxImageBytes`, is converted and scaled as the image dialog
    does, or the editor says it will export as a placeholder.
  - `RtfViewer` and `InkEditor` take `maxRtfBytes`, so a host whose reports carry large pictures can
    raise the size limit, and the message gives sizes in MB. A viewer given no content yet shows an
    empty document, not an error.
  - A table with tens of thousands of columns reads in a fraction of a second. A font is taken for a
    monospace one only by a whole word (Roboto Mono, not Monotype Corsiva), and a list marker is never
    code. "01." and "02." stay as typed rather than becoming a list.
  - `htmlToMarkdown`: a pipe in code, a code block or a link address no longer ends a table cell, a
    table inside a cell is written as its text, a caption or picture description is escaped so it
    cannot carry a link, a picture address must be a web address, a relative path or picture data, a
    figure with no picture keeps its content, and a table or list inside a list item stays in it.

## 1.8.3

### Patch Changes

- 5977f50: `rtfToHtml` holds a color table component outside 0 to 255 to the nearest end of the range:
  `\red999\green-5` reads as `rgb(255,0,0)`. Through 1.8.2 the value went into the HTML as it was. A
  browser shows such a color clamped, but where the style kept the raw value, `htmlToRtf` dropped the
  color on save.

## 1.8.2

### Patch Changes

- b4f628b: `rtfToHtml` no longer throws "Maximum call stack size exceeded" on RTF with thousands of nested
  groups. Groups nested deeper than 500 are folded into the group at that depth: their text is kept,
  and their formatting ends where that group ends. Real documents nest a few dozen deep at most.

## 1.8.1

### Patch Changes

- 6cf3f0f: `rtfToHtml` drops a damaged `\'` (one without two hex digits after it) and reads what follows as
  usual. Through 1.8.0 it became an invisible NUL character, or a control character when one digit
  followed: `abc\'zz` held a NUL, and `a\'9z b` held a tab.

## 1.8.0

### Minor Changes

- 0b3f4c9: Hanging indent and right indent, the two RTF paragraph indents the editor could not set. Four
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

### Patch Changes

- 8d26a1e: `rtfToHtml` reads `\'80` to `\'9f` as Windows-1252, the code page of RTF's `\ansi` text: curly
  quotes and apostrophes, dashes, the ellipsis, the euro sign and the rest of that range. Through
  1.7.0 they were read as invisible control characters, so `It\'92s`, the apostrophe TextEdit and
  many Windows programs write, showed as "Its".

## 1.7.0

### Minor Changes

- f3b473b: Increase and Decrease indent: toolbar buttons, `Ctrl+]` / `Ctrl+[` (`Cmd` on a Mac), and Tab or
  Shift+Tab over several selected lines. Each step moves the paragraphs 0.5 in, written to RTF as
  `\li720`; lists move as a whole. Paragraph alignment now reaches the RTF (`\qc`, `\qr`, `\qj`):
  through 1.6.0 a centered or right-aligned paragraph was written left-aligned. Indented blocks
  pasted from Chromium (a blockquote with `border: none`) or Firefox (margin-left) are read as indents, not
  as italic quotations.

  A Quote block or a picture moves as a whole, an indent pasted from Chromium can be decreased, and
  Undo also takes back the paragraph a loose line was given. Text after a centered or indented block
  no longer inherits that layout in the RTF.

- 734c5b3: `htmlToRtf` writes a paragraph's own formatting: `margin-left` as `\li`, `text-indent` as `\fi`,
  `margin-top` and `margin-bottom` as `\sb` and `\sa`, `break-after: avoid` as `\keepn`, and the stops
  in `data-rtf-tab-stops` as `\tx`. A paragraph without them writes exactly as before. A blank line
  after a formatted paragraph now restates `\pard`, so it does not take on that paragraph's indent. A `<div>` that wraps paragraphs passes its left indent to them and no longer adds a blank line after
  them.

## 1.6.0

### Minor Changes

- 8ee755d: Tab indents in the editor instead of moving focus to the next control. Tab inserts a tab, written to
  RTF as `\tab`; Shift+Tab removes one tab from the start of the line; Esc, then Tab, moves focus out.
  RTF read back keeps `\tab` as a tab (it was an em space, written out again as `\u8195`), except after
  a list marker.

## 1.5.3

### Patch Changes

- Fixes to the RTF `htmlToRtf` writes, each of which made a receiving system show something other than what the editor showed (#3). Ordinary content (paragraphs, bold, italic, headings, lists, quotes, code, rules, links, sizes, tables, figures, accented characters) is written byte for byte as in 1.5.2. Over 3,000 random nested documents, every letter now carries the bold, italic, underline, strikethrough, size, color, super- or subscript and font its HTML gives it.

  - **Closing a format restores the enclosing one.** An inner `</b>` inside an outer `<b>` ended both, so the rest of the line arrived plain; the same for italic, underline and strikethrough, superscript and subscript, and code inside code. A heading inside bold text ended the bold after it. A sized word inside a heading returned to the body size instead of the heading's, and a colored word inside a colored paragraph returned to the automatic color.
  - **Blocks inside a table cell stay in the cell.** A list, heading, quote, code block, rule or figure in a cell wrote a bare `\pard`, which ended the row early. Two paragraphs in one cell ran together, and so did a line typed after loose text (`abc<div>def</div>`, the shape Chrome makes on Enter), in a cell or out of one; each is its own paragraph now. An empty line in a cell is one line.
  - **Characters from U+8000 up are written as signed `\uN`**, as RTF requires, so Word and Epic no longer read an emoji or a CJK character as a different one.
  - **Links must be absolute web, mail or phone addresses.** `htmlToRtf` writes any other link, including a relative or network (`\\server\share`) path, `javascript:`, `data:` or `file:`, as its text alone, and writes an accepted address in its parsed, percent-encoded form, so a quote in it can no longer add field switches. The editor's link dialog refuses an unsafe address and says why. `isSafeLinkUrl` is exported.
  - **`estimateRtfBytes` no longer undercounts** on any input we tried, including 3,000 random documents. Non-ASCII text is counted at its escaped length; links, rules, line breaks, lines in code blocks, inline formatting, colors, color-table entries, sizes, blocks in table cells and header rows are counted. It errs high, by at most about 20% on a small document.

## 1.5.2

### Patch Changes

- Two fixes to RTF that is loaded into the editor and saved again.

  - **No stray space at the start of paragraphs.** `rtfToHtml` puts a newline between paragraphs. Once that HTML was set in the editor, `htmlToRtf` wrote the newline as a space, so every paragraph after the first began with one: a one-character indent on each line in the receiving system. Since 1.4.0. Whitespace between blocks is now skipped, as a browser skips it.
  - **Sizes are read against the screen's size, not guessed from the document.** 1.5.0 guessed the body size from whichever size most of the text was set in. That misread short documents (a heading over one short line lost its heading), turned lines a little larger than a 9 or 10 pt body into headings, and, at a non-default editor size, added an empty sized span on every save. `rtfToHtml(rtf, { fontSize })` now takes the size of the screen the HTML will be shown on. `InkEditor`'s RTF import and `RtfViewer` pass their own `fontSize`. At the default, 12 pt, a document reads as it did in 1.4.0, with one difference: a size set on spaces alone no longer turns a paragraph into a heading. At another size, a heading must also be bold, as every heading the writer emits is, so ordinary 12 pt text shown in a 10 pt editor stays a paragraph.

- Underline, strikethrough and highlight on a run of spaces are kept, so an underlined signature blank survives.

## 1.5.1

### Patch Changes

- `rtfToHtml` keeps the size text is written at again. In 1.5.0, text at the document's body size lost its size, so a report written entirely at 9 pt showed at the viewer's 12 pt, larger than the RTF it came from. Text at any size other than 12 pt now carries its `font-size`, as it did in 1.4.0. Headings are still recognized relative to the body size, which is the 1.5.0 fix: a 14 pt document no longer reads back as all headings.

## 1.5.0

### Minor Changes

- The document font and size can now be set, and default to Arial 12 pt (#4).

  `htmlToRtf(el, { fontFamily, fontSize })` sets the font the RTF declares and its body size in points. `InkEditor` and `RtfViewer` take `fontFamily` and `fontSize` props. The editor passes them to `getRTF()`, `getRtfSize()` and the RTF export, and uses them for the text on screen, so the editor shows what the receiving system will show. `DEFAULT_FONT_FAMILY` and `DEFAULT_FONT_SIZE` are exported.

  Callers that set nothing get different output. The RTF used to declare Helvetica for body text and Georgia for headings, and now declares Arial for both. On screen, the editor used to show DM Sans at 16 px with serif headings, and now shows Arial 12 pt, with headings in the same font. Headings keep their ratio to the body: at 12 pt, h1 is 24 pt, h2 18 pt and h3 14 pt, which matches what the RTF had before. The body size, 12 pt, is unchanged. Code is still written in Courier New, now as `\f1` instead of `\f2`.

  Other on-screen changes, so the editor matches the RTF:

  - Code is shown in Courier New at 5/6 of the body size. It was JetBrains Mono at 14 px.
  - Captions are shown at body size. They were 13 px.
  - Headings no longer shrink on screens narrower than 700 px.
  - `RtfViewer` now shows documents in Arial 12 pt. It used to inherit the page's font and size. Pass `fontFamily` and `fontSize` to change it.

  A font list such as `'Arial, sans-serif'` keeps only its first family. Sizes are rounded to the half-point RTF measures in, and kept between 1 and 1638 pt, on screen and in the RTF alike.

  `rtfToHtml` now finds a document's body size from the text itself, and recognizes headings relative to it. A document written at 10 or 14 pt reads back with its headings and paragraphs intact. Before, every paragraph of a 14 pt document read back as a heading.

## 1.4.0

### Minor Changes

- 9c872bc: Images now work end to end in the editor. Pictures can be added by file upload (one or many at a time), clipboard paste, drag-and-drop or address; each is inserted as a figure with a description line below it. Selecting an image shows a frame with drag-to-resize corner handles, width presets and left/centre/right placement.

  Images are embedded rather than linked: `htmlToRtf` now writes real `\pict` picture groups (`\pngblip`/`\jpegblip`, sized with `\picwgoal`/`\pichgoal`) instead of an `[Image: …]` text placeholder, and `rtfToHtml` decodes `\pict` data — including pictures wrapped in `{\*\shppict}` — back into images at their stored size, with their descriptions re-attached.

  `htmlToRtf` output is also made safe to carry inside another format (an HL7 `OBX-5` field, a JSON string): the document is emitted on a single line with no CR or LF anywhere — including newlines inside text content, which are collapsed to the space a browser would render (RTF ignores raw CR/LF, so they previously rendered as nothing while still emitting bytes a CR-terminated transport treats as a record separator) — and picture bytes are written as uppercase hex so a PNG starts with the `89504E470D0A1A0A` signature receivers match on. The blip type is now sniffed from those bytes rather than taken from the declared MIME type, so a mislabelled image (a WebP saved as `.png`) is re-encoded or placeholdered instead of being written as a `\pngblip` nothing can decode. Inserted pictures are bounded by two new props, since RTF costs two characters per image byte: `maxImageEdge` (1600 px) scales them down, and `maxImageBytes` (512 KB) re-encodes anything still too heavy — PNG first so screenshots stay sharp, JPEG only when the image is large and has no transparency to lose, then progressively smaller — until it fits.

  A third, `maxImageDisplayWidth` (624 px), sizes a newly inserted picture to the page rather than to the editor: RTF records the display size in twips, so a browser-wide picture was written as `\picwgoal` 12 in and overflowed the 6.5 in text column of the page it landed on. Resize handles still reach the full column width.

  The editor also reports how large the document will be as RTF, since that is what a size-limited transport cares about: `getRtfSize()` returns the exact byte count, and the `onchange` payload carries an `estimatedRtfBytes` cheap enough to update on every keystroke (picture data is counted exactly; the rest is approximated within a few hundred bytes). `estimateRtfBytes` is exported as a utility for callers holding HTML rather than an editor instance. Reporting only — the library does not refuse oversized documents.

## 1.3.0

### Minor Changes

- updated the formatting for tables

## 1.2.0

### Minor Changes

- Added support for rendering tables

## 1.1.0

### Minor Changes

- Removed background color tool

## 1.0.3

### Patch Changes

- Fixed issue where coloring was not set correctly

## 1.0.2

### Patch Changes

- Added testing framework, fixed issue with new line being skipped

## 1.0.1

### Patch Changes

- Updates to git URLs in package.json

## 1.0.0

### Major Changes

- Stable 1.0.0 version

## 0.2.0

### Minor Changes

- Initial release of RTF viewer and rich-text editor components for Svelte 5
