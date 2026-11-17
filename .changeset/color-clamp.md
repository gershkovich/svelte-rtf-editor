---
'svelte-rtf-editor': patch
---

`rtfToHtml` holds a color table component outside 0 to 255 to the nearest end of the range:
`\red999\green-5` reads as `rgb(255,0,0)`. Through 1.8.2 the value went into the HTML as it was. A
browser shows such a color clamped, but where the style kept the raw value, `htmlToRtf` dropped the
color on save.
