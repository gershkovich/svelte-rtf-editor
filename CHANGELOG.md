# svelte-rtf-editor

## 1.10.0

### Minor Changes

- 1467371: The editor's toolbar has a font size list. A size chosen there is given to the selected text, or,
  with nothing selected, to what is typed next. It is written to the RTF as `\fsN` and read back.

  - `fontSizes` sets the sizes offered (default 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28 and 36 pt;
    the body size is always among them; `[]` leaves the list out). `editor.setFontSize(points)` does
    the same from a host's own toolbar.
  - The list shows the size at the caret. Text set back to the size of the text around it follows
    `fontSize` again.
  - A change of size is undone and redone like any other edit.
  - `htmlToRtf` reads `<font size="1">` to `<font size="7">` as the sizes a browser shows them at.
    Pasted from an older page or from mail, such text was shown at its size and written at the body
    size.

- 888e965: Fixes for what a review of 1.9.0 against outside readers and outside input found (#21, items 1 to 29;
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

- c860ea5: Fixes from a review of the editor in a real browser, and two defaults that change.

  **Changed defaults**

  - `autosave` is now **off** unless asked for. With it on by default and one `storageKey` for
    every document, a draft left in the browser was shown in place of the `content` given: the
    last report edited, where the next one should be. To keep auto-save, pass `autosave` and give
    each document its own `storageKey`.
  - HTML from outside is made safe before it is shown: the `content` prop, `setHTML()`, a draft
    restored from `localStorage` and what a paste brings. Scripts, event handlers, `<iframe>`,
    `<svg>`, `javascript:` links, `class`, and styles such as `position: fixed` are taken out.
    `sanitizeHtml` is exported. If you relied on any of those surviving `setHTML`, they no longer
    do.
    - Sizes that would put an element outside the page go too: a margin below zero, a margin,
      padding or width over 2200 px, a width or height on anything but a picture, a table, its cells
      or a rule. The editing area clips what it holds, and a table wider than it scrolls inside it.
    - `<button>`, `<textarea>`, `<select>`, `<input>` and `<math>` are taken out and the words they
      showed are kept as text. A formula with a fraction, a power or a root is written `[formula]`.
      Words that were hidden are not kept, and elements side by side leave their words a space
      apart.
    - A document's own `id`s are kept, unless the page already uses that `id` outside an editor or
      it names something on `document` or `window`. A link keeps no `id`.
    - Text Word marked hidden (`mso-hide: all`) is hidden on screen as it is left out of the RTF,
      and is not pasted.
    - Words are not put out of sight: a first line that starts further left than its paragraph is
      moved in, and a text size under half a pixel, are taken out. A hanging indent stays as written.
    - A list read from RTF keeps a margin below zero of up to half an inch, which is how it carries
      an indent smaller than a list's own. It is the one margin below zero that is kept.
    - A style attribute that is all read and kept stays exactly as it was written
      (`border: 1px solid black` is not rewritten).
  - `onchange`'s `html`, `text` and `estimatedRtfBytes` are the document as it is when the handler
    first reads them, not a copy made when the change happened. Read them in the handler; a
    payload kept and read after a later edit gives the later document.
  - The empty document is `<p><br></p>`, where it was `<p></p>`, and an empty `<p>` in what is
    given gets its line break. It still counts no words and no characters.

  **Fixed**

  - The link dialog did not take the keyboard: after Ctrl+K the address was typed into the
    document, over the selected text. And Enter in its address field made the link and then
    replaced the linked text with a new line. Both dialogs now take focus, keep Tab inside, give
    focus back on Escape, and are announced as dialogs.
  - In a new document the first words typed landed outside the empty paragraph, and the RTF
    carried that paragraph as a blank line the screen did not show.
  - The writer wrote numbers no reader accepts: `\blueNaN` for `<font color="#abcd">`, `\red999`,
    `\fs199998`, and indents and picture sizes of ten digits and more. Colors are 0 to 255, a size
    is at most 1638 pt, and a length at most 22 inches.
  - `htmlToRtf` and `htmlToMarkdown` ran out of stack on elements nested a few thousand deep,
    lists straight inside lists among them.
  - `rtfToHtml` reads a picture's type from its bytes where they say it, and shows no picture wider
    than 22 inches.
  - A picture fetched from an address is given up at 25 MB as it arrives, where the whole of it
    was read first when the server did not say its size.
  - The viewer's Copy button no longer says "Copied" when the clipboard refused.

  **Faster**

  - `onchange`'s `html`, `text` and `estimatedRtfBytes` are worked out when the handler reads
    them. With eight pictures in a document a keystroke took 116 ms; it takes a few.
  - `estimateRtfBytes` no longer escapes the whole data URL of a picture that has no description.

  **Accessibility**

  - The editing area is a labelled multi-line text box (`ariaLabel`, default "Document"), the
    toolbar a toolbar, the buttons that are on or off (Bold, Italic, Underline, Strikethrough, Copy
    format) say which, and the error message is an alert.

  **Tooling** (nothing in the published package changes)

  - SvelteKit 3, Vite 8, TypeScript 6 and happy-dom 21, which clears the advisories `npm audit`
    reported against the older ones. CI runs on Node 22 with its actions pinned to commits, holds
    coverage to a floor, and runs browser tests (`npm run test:e2e`).

- 4b00447: The default font is **Segoe UI** 12 pt, where it was Arial 12 pt. It is what the editor and the
  viewer show and what `htmlToRtf` names in the RTF when no `fontFamily` is given.

  - To keep Arial, pass `fontFamily="Arial"` to `InkEditor` and `RtfViewer`, and
    `{ fontFamily: 'Arial' }` to `htmlToRtf` and `estimateRtfBytes` where you call them yourself.
  - A document is written in the font of the editor that saves it. A report saved in Arial, opened
    and saved again by an editor left at the default, comes out in Segoe UI.
  - On a system without Segoe UI the screen shows the system's sans-serif font; the RTF names
    Segoe UI all the same.

  The default is named in one place, `DEFAULT_FONT_FAMILY`. The size estimate counted the font name
  as a difference from the length of "Arial"; it now counts the name itself, so it holds whatever
  the default is.

### Patch Changes

- cc93a43: `maxImageBytes` is a ceiling: no picture goes into the document over it (#21, item 30). Through
  1.9.0 the steps that shrink a picture stopped at half size, and a picture that still did not fit was
  inserted anyway with nothing said. A 4000×3000 photograph under a limit of 20 KB went in at 36 KB,
  and a PNG with transparency under the default 512 KB went in at 1022 KB, which is 2 MB of RTF.

  - A picture over the limit is now made smaller until it fits, each step sized from how far over the
    last one was, down to 16 px on its longest edge. The same photograph is 14 KB under a 20 KB limit.
  - A picture with transparency that does not fit as a PNG at half size or more is laid on white and
    written as a JPEG at full size. It was never tried as a JPEG. One that fits as a PNG keeps its
    transparency, as before.
  - A picture that cannot be brought under the limit is not inserted, and the editor says so. That
    takes a limit of a few hundred bytes, or a picture the browser cannot redraw. Picture data pasted
    with text that cannot be brought under it is taken out of the paste, with a message.
  - Pictures within the limit, and the first four steps, are handled exactly as before.

  Found in review of the above:

  - With `maxImageEdge={0}`, a picture with more pixels than the browser's canvas holds (268 million
    in Chromium, about 16.7 million in Safari on a phone) came back as an empty picture: the canvas
    answers `data:,` instead of failing, and that passed as fitting any limit. This was so in 1.9.0
    too. Such a picture is now brought down to a size the canvas holds, half the area at a time, and
    an answer that is not a PNG or JPEG is never returned.
  - A picture the browser cannot open (a TIFF, a damaged file) was refused as too large when it was
    over the limit, and inserted as a broken picture when under it. It is now never inserted, and
    the editor says that it could not be opened, for a file, for picture data in the dialog and for
    picture data pasted with text.
  - A pasted picture that is left out takes its figure and caption with it, and the link, paragraph
    or list item that held nothing else. The caption and an empty paragraph used to stay, and went
    into the RTF. Text that shared its paragraph stays. That covers the caption Chromium leaves in a
    figure of its own when it moves the picture into the line before it; a caption Chromium has
    turned into ordinary text of a line stays, since it cannot be told from the words around it. The
    picture also stops being the selected picture, and the caret is left in a line it can type in.
    A caption goes with its picture also where Chromium left it inside the wrapper the figure came
    in, and stays while another picture pasted with it is still there. An empty line that the paste
    took the place of is put back when nothing of the paste is left.
  - One paste with a picture left out and a picture that will export as a placeholder now says both.
    A message that says more than one thing stays up longer than four seconds.

  Where there is no canvas (SSR, a test DOM), a picture over `maxImageBytes` is now refused instead of
  passed through; one within it is passed through as before.

- 626d7fc: In the Markdown export, code stays code. `htmlToMarkdown` escapes text and writes code as it is, so
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

- b97ddfd: **Tooling** (nothing in the published package changes)

  - Vitest 5 and `@changesets/cli` 3, the tools that run the tests and write this changelog. The
    files in `dist/` are byte for byte what the older tools built. TypeScript stays at 6: SvelteKit,
    `svelte-check` and `svelte-package` do not run with TypeScript 7 yet.

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
