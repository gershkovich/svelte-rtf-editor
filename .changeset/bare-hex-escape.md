---
'svelte-rtf-editor': patch
---

`rtfToHtml` drops a damaged `\'` (one without two hex digits after it) and reads what follows as
usual. Through 1.8.0 it became an invisible NUL character, or a control character when one digit
followed: `abc\'zz` held a NUL, and `a\'9z b` held a tab.
