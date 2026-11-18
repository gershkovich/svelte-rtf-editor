---
'svelte-rtf-editor': minor
---

`keepAttributes` and `keepClasses`: marks of the application's own stay on HTML that is set or pasted.

Since 1.10.0 the editor takes every attribute and class it does not know off HTML as it comes in, which also removed the marks an application puts on its own documents and reads back (`<p data-section="2">`) or styles by (`<pre class="summary">`). `<InkEditor keepAttributes={['data-section']} keepClasses={['summary']} />` keeps the ones named, and `sanitizeHtml(html, { keepAttributes, keepClasses })` does the same. Only attribute names that start with `data-` are kept, so the setting cannot let in `onclick`, `style` or `src`. The default is unchanged: none.
