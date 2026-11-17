import { describe, it, expect } from 'vitest';
import { htmlToRtf } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * Save, reload, save: what a document goes through each time it is stored as RTF and opened
 * again. For every construct the editor supports, one of two things is expected:
 *
 * - "unchanged": the RTF written after a reload is the RTF written before it;
 * - "settles": the first reload may change how it is written, but from then on it is the same
 *   save after save, so a document does not drift.
 *
 * Every construct must settle. A construct that should be unchanged and is not yet is marked
 * `it.fails`, with the issue in its title: it turns red when the bug is fixed, which is the cue
 * to drop `.fails`. Invented text.
 */

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const write = (html: string) => htmlToRtf(el(html));
const reload = (rtf: string) => write(rtfToHtml(rtf));

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Constructs that are written the same before and after a reload. */
const UNCHANGED: Record<string, string> = {
	'bold, italic, underline, strikethrough, super- and subscript':
		'<p>plain <strong>bold</strong> <em>italic</em> <u>under</u> <s>struck</s> x<sup>2</sup> H<sub>2</sub>O</p>',
	'two paragraphs and a blank line between': '<p>one</p><p><br></p><p>two</p>',
	'a line break inside a paragraph': '<p>one<br>two</p>',
	'alignment': '<p style="text-align:center">c</p><p style="text-align:right">r</p><p style="text-align:justify">j</p>',
	'left, right and hanging indents': '<p style="margin-left:36pt;margin-right:36pt;text-indent:-36pt">hang</p><p style="margin-left:48px">in</p>',
	'a typed tab': '<p>A.<span style="white-space:pre">\t</span>B</p>',
	'colored text': '<p>a <span style="color:rgb(255,0,0)">red</span> b</p>',
	'text at a size of its own': '<p>a <span style="font-size:9pt">small</span> b</p>',
	'accents, an emoji, CJK and curly quotes': '<p>café \u{1F600} 漢字 “q”</p>',
	'a backslash and braces': '<p>a \\ b { c } d</p>',
	'a table with a header row': '<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>',
	'a table with column widths': '<table><tr><td style="width:25%">a</td><td style="width:75%">b</td></tr></table>',
	'bold text in a table cell': '<table><tr><td><strong>a</strong></td><td>b</td></tr></table>',
	'a picture with a caption': `<figure><img src="${PNG}" style="width:10px;height:auto" alt=""><figcaption>cap</figcaption></figure>`,
	'a centered picture': `<figure style="text-align:center"><img src="${PNG}" style="width:10px;height:auto" alt=""></figure>`
};

/** Constructs a reload rewrites once, in a way that reads the same, and then leaves alone. */
const SETTLES: Record<string, string> = {
	'formats nested in each other': '<p><strong>a <em>b <u>c</u></em></strong> d</p>',
	'a quotation': '<blockquote>quoted</blockquote>'
};

/** Constructs that should be unchanged and are not yet: the reload loses or rewrites something. */
const OPEN: Record<string, string> = {
	'#3.7: headings (they come back with a size span inside)': '<h1>One</h1><h2>Two</h2><h3>Three</h3><p>Body</p>',
	'#3.6: a bullet list (it comes back as paragraphs that start with a bullet character)': '<ul><li>one</li><li>two</li></ul>',
	'#3.6: a numbered list': '<ol><li>one</li><li>two</li></ol>',
	'#3.8: a rule (it comes back as a paragraph of dashes)': '<p>a</p><hr><p>b</p>',
	'#3.4: a link (its address is lost)': '<p><a href="https://x.test/a">click</a></p>',
	'NEW: a code block (its monospace font is lost)': '<pre>line 1\nline 2</pre>',
	'NEW: inline code (its monospace font is lost)': '<p>a <code>b</code> c</p>'
};

describe('written the same before and after a reload', () => {
	for (const [name, html] of Object.entries(UNCHANGED)) {
		it(name, () => {
			const first = write(html);
			expect(reload(first)).toBe(first);
		});
	}

	for (const [name, html] of Object.entries(OPEN)) {
		it.fails(name, () => {
			const first = write(html);
			expect(reload(first)).toBe(first);
		});
	}
});

describe('no drift: the second reload changes nothing', () => {
	for (const [name, html] of Object.entries({ ...UNCHANGED, ...SETTLES, ...OPEN })) {
		it(name.replace(/ \(.*\)$/, ''), () => {
			const second = reload(write(html));
			expect(reload(second)).toBe(second);
			expect(reload(reload(second))).toBe(second);
		});
	}
});

describe('a reload keeps every character of the text', () => {
	const letters = (html: string) => (el(html).textContent || '').replace(/[\s •—]|\d\./g, '');

	for (const [name, html] of Object.entries({ ...UNCHANGED, ...SETTLES, ...OPEN })) {
		it(name.replace(/ \(.*\)$/, ''), () => {
			expect(letters(rtfToHtml(write(html)))).toBe(letters(html));
		});
	}
});
