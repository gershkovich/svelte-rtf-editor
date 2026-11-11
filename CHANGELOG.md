# svelte-rtf-editor

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
