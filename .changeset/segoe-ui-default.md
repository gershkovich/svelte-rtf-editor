---
'svelte-rtf-editor': minor
---

The default font is **Segoe UI** 12 pt, where it was Arial 12 pt. It is what the editor and the
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
