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
 * Every construct must settle, and none may lose a character. Invented text.
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
	'bold text with accents and an emoji': '<p><strong>café \u{1F600} naïve</strong> <em>señor</em></p>',
	'a backslash and braces': '<p>a \\ b { c } d</p>',
	'a table with a header row': '<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>',
	'a table with column widths': '<table><tr><td style="width:25%">a</td><td style="width:75%">b</td></tr></table>',
	'bold text in a table cell': '<table><tr><td><strong>a</strong></td><td>b</td></tr></table>',
	'a picture with a caption': `<figure><img src="${PNG}" style="width:10px;height:auto" alt=""><figcaption>cap</figcaption></figure>`,
	'a centered picture': `<figure style="text-align:center"><img src="${PNG}" style="width:10px;height:auto" alt=""></figure>`,
	// Each of these lost or rewrote something on a reload before its fix.
	'#3.7: headings': '<h1>One</h1><h2>Two</h2><h3>Three</h3><p>Body</p>',
	'#3.6: a bullet list': '<ul><li>one</li><li>two</li></ul>',
	'#3.6: a numbered list': '<ol><li>one</li><li>two</li></ol>',
	'#3.6: a list inside a list item, three levels deep':
		'<ul><li>one<ul><li>inner<ol><li>deep</li><li>deeper</li></ol></li></ul></li><li>two</li></ul>',
	'#3.13: a numbered list that starts at 5': '<ol start="5"><li>five</li><li>six</li></ol>',
	'two lists with a blank line between': '<ul><li>a</li></ul><p><br></p><ul><li>b</li></ul>',
	'a list item with bold text and an empty item': '<ul><li><strong>a</strong> b</li><li><br></li><li>c</li></ul>',
	'#3.8: a rule': '<p>a</p><hr><p>b</p>',
	'a page break': '<p>a</p><hr style="break-after:page"><p>b</p>',
	'#3.4: a link': '<p><a href="https://x.test/a">click</a></p>',
	'a link with bold text in it, and a mail link': '<p>see <a href="https://x.test/a?b=1&amp;c=2">the <strong>note</strong></a> or <a href="mailto:lab@x.test">write</a></p>',
	'a code block': '<pre>line 1\nline 2</pre>',
	'a code block with indented lines and an empty one': '<pre>if (x) {\n    y();\n\n}</pre>',
	'inline code': '<p>a <code>b</code> c</p>',
	'#2: a cell down two rows': '<table><tr><td rowspan="2">Group</td><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
	'#2: a cell across two columns': '<table><tr><td colspan="2">wide</td><td>c</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>',
	'#2: a table with a header, a cell down two rows and a cell across two columns':
		'<table><tr><th>Group</th><th>Planet</th><th>Moons</th></tr>' +
		'<tr><td rowspan="2">Terrestrial</td><td>Earth</td><td>1</td></tr><tr><td>Mars</td><td>2</td></tr>' +
		'<tr><td rowspan="2">Giants</td><td colspan="2">many</td></tr><tr><td>Saturn</td><td>146</td></tr></table>',
	'#2: a cell across two columns and down two rows':
		'<table><tr><td rowspan="2" colspan="2">big</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>',
	'#3.13: a header cell beside a plain one': '<table><tr><th>h</th><td>d</td></tr></table>',
	'a right-aligned and a centered cell': '<table><tr><td style="text-align:right">1.5</td><td style="text-align:center">mid</td></tr></table>'
};

/** Constructs a reload rewrites once, in a way that reads the same, and then leaves alone. */
const SETTLES: Record<string, string> = {
	'formats nested in each other': '<p><strong>a <em>b <u>c</u></em></strong> d</p>',
	'a quotation': '<blockquote>quoted</blockquote>',
	// Pasted headings below h3 come back as the bold paragraphs they were written as.
	'<h4>, <h5> and <h6>': '<h4>four</h4><h5>five</h5><h6>six</h6><p>x</p>',
	// A cell is read as lines of text, so its paragraphs and lists come back as lines.
	'two paragraphs in a table cell': '<table><tr><td><p>one</p><p>two</p></td></tr></table>',
	'a list in a table cell': '<table><tr><td><ul><li>x</li><li>y</li></ul></td></tr></table>',
	'a table inside a table cell': '<table><tr><td>x<table><tr><td>in</td><td>in2</td></tr><tr><td>r2</td><td>r3</td></tr></table>y</td></tr></table>',
	'a list item that holds paragraphs, as Word pastes it': '<ul><li><p>one</p><p>more</p></li><li><p>two</p></li></ul>',
	'text after a list inside a list item': '<ul><li>a<ul><li>b</li></ul>tail</li><li>c</li></ul>',
	'a list written straight inside a list': '<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>',
	'formatting inside code': '<p><code>c <em>d</em></code> and <strong><code>e</code></strong></p>',
	'a heading with a word at another size': '<h3>T<span style="font-size:20pt">big</span></h3>',
	'a table with a short row': '<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>'
};

describe('written the same before and after a reload', () => {
	for (const [name, html] of Object.entries(UNCHANGED)) {
		it(name, () => {
			const first = write(html);
			expect(reload(first)).toBe(first);
		});
	}
});

describe('no drift: the second reload changes nothing', () => {
	for (const [name, html] of Object.entries({ ...UNCHANGED, ...SETTLES })) {
		it(name, () => {
			const second = reload(write(html));
			expect(reload(second)).toBe(second);
			expect(reload(reload(second))).toBe(second);
		});
	}
});

describe('a reload keeps every character of the text', () => {
	const letters = (html: string) => (el(html).textContent || '').replace(/[\s •—]|\d\./g, '');

	for (const [name, html] of Object.entries({ ...UNCHANGED, ...SETTLES })) {
		it(name, () => {
			expect(letters(rtfToHtml(write(html)))).toBe(letters(html));
		});
	}
});
