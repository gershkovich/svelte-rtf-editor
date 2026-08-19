# svelte-rtf-editor

RTF viewer and rich-text editor components for **Svelte 5**.

[![npm](https://img.shields.io/npm/v/svelte-rtf-editor)](https://www.npmjs.com/package/svelte-rtf-editor)
[![license](https://img.shields.io/npm/l/svelte-rtf-editor)](./LICENSE)

---

## Features

- **`RtfViewer`** — Renders an RTF string as formatted HTML with a one-click "Copy RTF" button
- **`InkEditor`** — Full rich-text editor that reads and writes RTF, built on `contenteditable`
  - Formatting toolbar: bold, italic, underline, strikethrough, font colour
  - Block-level controls: headings (H1–H3), paragraph, blockquote, code block
  - Images: upload, paste or drag-and-drop, with a description below each picture, drag-to-resize and left/centre/right placement — embedded in the RTF, not linked
  - Import an RTF file from disk; export as RTF, HTML, or Markdown
  - Optional auto-save to `localStorage`
  - Word count and character count status bar
  - Keyboard shortcuts (`Ctrl+S` to save, `Ctrl+B/I/U` for formatting)
- **Utility functions** — `rtfToHtml`, `htmlToRtf`, `readRtfFile`, `htmlToMarkdown`, `downloadFile`
- Zero runtime dependencies — just Svelte 5 as a peer dependency

---

## Installation

```bash
npm install svelte-rtf-editor
```

---

## Usage

### Read-only RTF viewer

```svelte
<script>
  import { RtfViewer } from 'svelte-rtf-editor';

  const rtf = String.raw`{\rtf1\ansi {\b Hello}, {\i world}!}`;
</script>

<RtfViewer content={rtf} />
```

The viewer renders the RTF as HTML and places a **Copy RTF** button in the top-right corner.

---

### Rich-text editor

```svelte
<script>
  import { InkEditor } from 'svelte-rtf-editor';

  let html = '';
</script>

<InkEditor
  placeholder="Start writing…"
  onchange={({ html: h }) => (html = h)}
/>
```

#### Getting RTF out of the editor

Bind a reference to the component with `bind:this` and call `getRTF()`:

```svelte
<script>
  import { InkEditor } from 'svelte-rtf-editor';

  let editor;

  function save() {
    const rtf = editor.getRTF();
    console.log(rtf); // {\rtf1\ansi ...}
  }
</script>

<InkEditor bind:this={editor} />
<button onclick={save}>Save</button>
```

#### Pre-loading content

Pass an HTML string as `content`. If the content is already RTF, convert it first:

```svelte
<script>
  import { InkEditor, rtfToHtml } from 'svelte-rtf-editor';

  const rtfFromServer = String.raw`{\rtf1\ansi {\b Hello}}`;
  const html = rtfToHtml(rtfFromServer);
</script>

<InkEditor content={html} autosave={false} />
```

---

## API

### `<RtfViewer>`

| Prop      | Type     | Default | Description                              |
|-----------|----------|---------|------------------------------------------|
| `content` | `string` | —       | Raw RTF string to parse and display      |

---

### `<InkEditor>`

#### Props

| Prop            | Type       | Default                      | Description                                               |
|-----------------|------------|------------------------------|-----------------------------------------------------------|
| `content`       | `string`   | `'<p></p>'`                  | Initial HTML content                                      |
| `placeholder`   | `string`   | `'Start writing something beautiful...'` | Placeholder text when editor is empty     |
| `autosave`      | `boolean`  | `true`                       | Save content to `localStorage` on change                  |
| `storageKey`    | `string`   | `'ink-editor-content'`       | `localStorage` key used for auto-save                     |
| `showToolbar`   | `boolean`  | `true`                       | Show the formatting toolbar                               |
| `showStatusBar` | `boolean`  | `true`                       | Show the word/character count bar                         |
| `minHeight`     | `string`   | `'40vh'`                     | CSS `min-height` of the editing area                      |
| `readonly`      | `boolean`  | `false`                      | Disable editing                                           |
| `maxImageEdge`  | `number`   | `1600`                       | Longest edge (px) an inserted image is scaled down to; `0` keeps full size |
| `maxImageBytes` | `number`   | `524288`                     | Encoded byte ceiling per image; oversized pictures are re-encoded until they fit. `0` disables |
| `maxImageDisplayWidth` | `number` | `624`                 | Width (px) a newly inserted image is displayed at, unless the column is narrower — 6.5in of page. `0` fills the column |

#### Callback props

| Prop       | Payload                                      | Description                                 |
|------------|----------------------------------------------|---------------------------------------------|
| `onchange` | `{ html, text, wordCount, charCount, estimatedRtfBytes }` | Fired on every content change |
| `onsave`   | `{ html }`                                   | Fired on auto-save or `Ctrl+S`              |
| `onimport` | `{ html }`                                   | Fired after a successful RTF file import    |

#### Methods (via `bind:this`)

```ts
editor.getHTML()          // → string  — current editor HTML
editor.getText()          // → string  — plain text (no tags)
editor.setHTML(html)      // → void    — replace content programmatically
editor.getMarkdown()      // → string  — Markdown conversion of content
editor.getRTF()           // → string  — RTF conversion of content
editor.getRtfSize()       // → number  — exact byte size of that RTF
editor.clear()            // → void    — clear the editor
editor.focus()            // → void    — focus the editor
editor.exportFile(format) // → void    — download as 'html' | 'md' | 'rtf'
editor.importRtf()        // → void    — open the file picker to import .rtf
```

---

## Utility functions

```ts
import {
  rtfToHtml, htmlToRtf, estimateRtfBytes, readRtfFile, htmlToMarkdown, downloadFile
} from 'svelte-rtf-editor';
```

| Function                              | Description                                        |
|---------------------------------------|----------------------------------------------------|
| `rtfToHtml(rtf: string): string`      | Parse an RTF string and return an HTML string      |
| `htmlToRtf(html: string): string`     | Convert an HTML string to RTF                      |
| `estimateRtfBytes(el: HTMLElement): number` | Approximate RTF size of a DOM element without converting it |
| `readRtfFile(file: File): Promise<string>` | Read a `.rtf` File object and return HTML     |
| `htmlToMarkdown(el: HTMLElement): string` | Convert a DOM element's content to Markdown   |
| `downloadFile(name, content, mime): void` | Trigger a file download in the browser        |

---

## Theming

The components use CSS custom properties with sensible fallbacks, so they work out of the box but are easy to customise. Override these in your own CSS:

```css
:root {
  --text:        #2c2520;
  --text-muted:  #8a7e72;
  --surface:     #f2f0ec;
  --border:      #e5e2dc;
  --ink:         #1a1714;
  --accent:      #6e56cf;
  --accent-soft: #ede9fe;
  --radius-sm:   5px;
  --transition:  150ms ease;
}
```

---

## Keyboard shortcuts

| Shortcut   | Action            |
|------------|-------------------|
| `Ctrl+B`   | Bold              |
| `Ctrl+I`   | Italic            |
| `Ctrl+U`   | Underline         |
| `Ctrl+K`   | Insert link       |
| `Ctrl+S`   | Save (fires `onsave`) |
| `Backspace` / `Delete` | Remove the selected image |

---

## Working with images

Three ways to add a picture:

- **Toolbar** — the image button opens a dialog where you can pick one or several files from disk, or paste an image address
- **Paste** — paste an image straight from the clipboard (a screenshot, for example)
- **Drag and drop** — drop image files anywhere in the editing area; they are inserted where you dropped them

Each picture is inserted as a `<figure>` with a `<figcaption>` under it. Click the caption line and type to describe the image — the description travels with the picture through every export. Insert as many images as a document needs.

Click an image to select it. A frame appears with corner handles you can drag to resize (the aspect ratio is kept and the width is capped at the editor's text width), buttons for 25% / 50% / 100% width, left / centre / right placement, a shortcut to its description, and a remove button.

### How images are stored

Images are held inline as base64 data URLs, so a document is self-contained — it auto-saves, exports and re-imports with the pictures intact, and needs no image server.

- **RTF export** writes each picture as a real `\pict` group (`\pngblip` / `\jpegblip`) sized with `\picwgoal` / `\pichgoal`, so it opens with the images in Word, TextEdit and other RTF readers. The description follows as an italic line, tagged with an ignorable `{\*\inkcap}` destination that this library uses to re-attach it to the figure on import; other readers simply skip the tag.
- **RTF import** decodes `\pict` PNG and JPEG data (including pictures wrapped in `{\*\shppict}`) back into images at their stored size. Picture formats a browser cannot display — metafiles and device-dependent bitmaps — are skipped.
- **Formats**: PNG and JPEG are embedded as-is. Anything else (GIF, WebP, SVG, …) is re-encoded to PNG when inserted, since RTF carries no other bitmap types. Animated images keep their first frame.
- **Images added by address** are fetched and inlined so they survive export. When the fetch is blocked (CORS or offline) the address is kept and the picture still displays, but it exports as an `[Image: …]` placeholder instead of picture data — the editor says so at insert time rather than letting it go unnoticed until the document is read downstream.
- **Size**: RTF stores picture data as hexadecimal — two characters per byte — so an embedded image costs twice its file size in the document. Resizing an image in the editor changes its display size only; two caps applied at insert time are what bound the payload:
  - `maxImageEdge` (1600 px) scales the picture down so neither edge exceeds it.
  - `maxImageBytes` (512 KB, so roughly 1 MB of document per image) is the ceiling that actually matters. A picture over it is re-encoded until it fits: a PNG is tried as PNG first so screenshots and diagrams stay sharp, falls back to JPEG only when it is too heavy *and* has no transparency to lose, then steps down through 80%, 64% and 50% of the target size. Whichever candidate fits first is kept.

  Set either to `0` to disable it. Both caps are applied by re-encoding through a `<canvas>`, so they only take effect in a browser — in a runtime without one (SSR, jsdom/happy-dom tests) the original bytes are passed through untouched. Do not rely on them to bound a payload assembled server-side.
- **Page fit**: a newly inserted picture is displayed at `maxImageDisplayWidth` (624 px) rather than filling the editor. RTF records the display size in twips — 624 px × 15 = 9360 twips = 6.5 in, the text width of a Letter page with 1 in margins — so pictures arrive sized to the page they will be printed or filed on, not to the width of the browser window. Resize handles still go up to the full column width when a picture deserves it.

### Sending RTF over a transport

`htmlToRtf` output is written to survive being carried inside another format — an HL7 `OBX-5` field, a JSON string, a CSV cell:

- **One line.** The document contains no CR or LF anywhere — not in picture data, and not in text either: a newline inside text content is collapsed to the space a browser would have rendered (RTF readers ignore raw CR/LF, so `Hello\nworld` used to render as "Helloworld"). `<pre>` blocks keep their line structure as `\line`.
- **Uppercase hex.** Picture bytes are written as uppercase hex, so a PNG begins with the `89504E470D0A1A0A` signature that receivers commonly match on.
- **Format read from the bytes.** `\pngblip` vs `\jpegblip` is decided by sniffing the image's leading bytes, never by its declared MIME type — an operating system assigns `File.type` from the file extension, so a WebP saved as `.png` claims to be PNG. Bytes that are neither PNG nor JPEG are re-encoded on insert, or exported as a text placeholder rather than as a blip whose declared type contradicts its content.
- **Sized for the pipe.** `maxImageBytes` bounds each picture, and the payload is roughly twice that in hex. Lower it to fit a field-length limit.

Some receivers require the whole field on one unbroken line when it carries an image — that is why the writer emits no line breaks at all, rather than wrapping picture data the way many RTF writers do.

### Knowing how big a document is

The transport cares about the size of the finished RTF, and pictures make that unpredictable. Two ways to read it:

```svelte
<script>
  let editor;
  let size = 0;
</script>

<!-- an estimate on every change, cheap enough for a live indicator -->
<InkEditor bind:this={editor} onchange={({ estimatedRtfBytes }) => (size = estimatedRtfBytes)} />

<!-- the exact figure, when it is time to send -->
<button onclick={() => console.log(editor.getRtfSize())}>Check size</button>
```

`getRtfSize()` does the full conversion — call it when a decision depends on it, not on every keystroke. `estimatedRtfBytes` counts picture data exactly (two characters per byte, which is what dominates) and approximates the rest, leaving an error of a few hundred bytes at most. The output is ASCII, so bytes and characters are the same number.

The library reports the size and stops there; whether an oversized document may be sent is the host application's decision.

Escaping for the carrying format is the integration layer's job, not the editor's. For HL7 v2 that means escaping the whole string's delimiters — `\` → `\E\`, `|` → `\F\`, `^` → `\S\`, `&` → `\T\`, `~` → `\R\` — because ordinary typed text ("Smith & Jones") reaches the RTF unescaped.

---

## Contributing & releasing

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelog generation.

### Making changes

After making code changes, describe them with a changeset:

```bash
npm run changeset
# → interactive prompt: pick patch / minor / major, write a short description
```

Commit both your code and the generated `.changeset/*.md` file together.

### Publishing a new version

When ready to cut a release:

```bash
# 1. Consume pending changesets — bumps package.json and updates CHANGELOG.md
npm run version

# 2. Commit the version bump
git add .
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git push

# 3. Create a GitHub release — this triggers CI to build and publish to npm
VERSION=$(node -p "require('./package.json').version")
gh release create "v$VERSION" --title "v$VERSION" --generate-notes
```

Requires the [GitHub CLI](https://cli.github.com/) (`brew install gh`, then `gh auth login` once).
The `--generate-notes` flag has GitHub auto-generate release notes from commits since the last tag.

### Version bump rules

| Change type | Bump |
|---|---|
| Bug fix | `patch` — 0.1.0 → 0.1.1 |
| New feature (backwards compatible) | `minor` — 0.1.0 → 0.2.0 |
| Breaking change | `major` — 0.1.0 → 1.0.0 |

### First-time npm publish

The npm Trusted Publisher (OIDC) setup requires the package to exist on npm before it can be configured. For the very first publish, run locally:

```bash
npm login
npm run prepack
npm publish --access public
```

Then go to `npmjs.com/package/svelte-rtf-editor` → **Settings** → **Trusted Publishers** and add the GitHub Actions publisher pointing at this repo's `publish.yml`. All subsequent releases will go through CI automatically.

---

## Local development

Clone this repo and link it to your project for instant iteration without publishing:

```bash
# In svelte-rtf-editor/
npm run prepack   # builds dist/
npm link

# In your project/
npm link svelte-rtf-editor
```

Re-run `npm run prepack` in this repo after any change. When done:

```bash
# In your project/
npm unlink svelte-rtf-editor
npm install svelte-rtf-editor
```

---

## License

MIT
