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

#### Callback props

| Prop       | Payload                                      | Description                                 |
|------------|----------------------------------------------|---------------------------------------------|
| `onchange` | `{ html, text, wordCount, charCount }`       | Fired on every content change               |
| `onsave`   | `{ html }`                                   | Fired on auto-save or `Ctrl+S`              |
| `onimport` | `{ html }`                                   | Fired after a successful RTF file import    |

#### Methods (via `bind:this`)

```ts
editor.getHTML()          // → string  — current editor HTML
editor.getText()          // → string  — plain text (no tags)
editor.setHTML(html)      // → void    — replace content programmatically
editor.getMarkdown()      // → string  — Markdown conversion of content
editor.getRTF()           // → string  — RTF conversion of content
editor.clear()            // → void    — clear the editor
editor.focus()            // → void    — focus the editor
editor.exportFile(format) // → void    — download as 'html' | 'md' | 'rtf'
editor.importRtf()        // → void    — open the file picker to import .rtf
```

---

## Utility functions

```ts
import { rtfToHtml, htmlToRtf, readRtfFile, htmlToMarkdown, downloadFile } from 'svelte-rtf-editor';
```

| Function                              | Description                                        |
|---------------------------------------|----------------------------------------------------|
| `rtfToHtml(rtf: string): string`      | Parse an RTF string and return an HTML string      |
| `htmlToRtf(html: string): string`     | Convert an HTML string to RTF                      |
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
- **Images added by address** are fetched and inlined so they survive export. When the fetch is blocked (CORS or offline) the address is kept and the picture still displays, but it exports as an `[Image: …]` placeholder instead of picture data.

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
