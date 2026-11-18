---
'svelte-rtf-editor': minor
---

The editor's toolbar has a font size list. A size chosen there is given to the selected text, or,
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
