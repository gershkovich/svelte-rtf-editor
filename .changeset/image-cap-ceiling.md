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

Where there is no canvas (SSR, a test DOM), a picture over `maxImageBytes` is now refused instead of
passed through; one within it is passed through as before.
