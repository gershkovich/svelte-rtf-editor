---
'svelte-rtf-editor': patch
---

`rtfToHtml` reads `\'80` to `\'9f` as Windows-1252, the code page of RTF's `\ansi` text: curly
quotes and apostrophes, dashes, the ellipsis, the euro sign and the rest of that range. Through
1.7.0 they were read as invisible control characters, so `It\'92s`, the apostrophe TextEdit and
many Windows programs write, showed as "Its".
