---
'svelte-rtf-editor': minor
---

Fixes from a review of the editor in a real browser, and two defaults that change.

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
  - A document's own `id`s are kept, unless the page already uses that `id` outside an editor or
    it names something on `document` or `window`.
  - Text Word marked hidden (`mso-hide: all`) is hidden on screen as it is left out of the RTF.
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
