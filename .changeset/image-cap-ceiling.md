---
'svelte-rtf-editor': patch
---

`maxImageBytes` is a ceiling: no picture goes into the document over it (#21, item 30). Through
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
