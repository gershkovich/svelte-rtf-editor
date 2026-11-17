import { describe, it, expect } from 'vitest';
import { htmlToRtf } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { htmlToMarkdown } from '../utils.js';

/**
 * What htmlToRtf is expected to write for the HTML an editor can hold, including what a paste
 * brings in: the document as a whole, blocks, lists, tables and links. Character formatting,
 * paragraph formatting, fonts, tabs and pictures have test files of their own. htmlToMarkdown is
 * at the end.
 *
 * A test marked `it.fails` states the expected behavior for something that is still open; the
 * title names the issue. It passes while the bug is there and turns red when the bug is fixed,
 * which is the cue to drop `.fails`. Invented text.
 */

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** The RTF after the header, without the closing brace. */
const body = (html: string) => {
	const rtf = htmlToRtf(el(html));
	return rtf.slice(rtf.indexOf('\\pard\\f0\\fs24 ') + '\\pard\\f0\\fs24 '.length, -1);
};
const count = (text: string, part: string) => text.split(part).length - 1;
/** Every \cellx position in one row's definition. */
const edges = (row: string) => Array.from(row.matchAll(/\\cellx(\d+)/g)).map((m) => Number(m[1]));
const rows = (rtf: string) => rtf.split('\\trowd').slice(1);

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const EVERYTHING =
	'<h1>Title</h1><h2>Section</h2><h3>Part</h3>' +
	'<p>plain <strong>bold</strong> <em>italic</em> <u>under</u> <s>struck</s> x<sup>2</sup> H<sub>2</sub>O <code>code</code></p>' +
	'<p style="text-align:center">centered café \u{1F600} 漢字 \\ { }</p>' +
	'<p style="margin-left:36pt;margin-right:36pt;text-indent:-36pt">A.<span style="white-space:pre">\t</span>hanging</p>' +
	'<p>a <span style="color:rgb(255,0,0)">red</span> <span style="font-size:9pt">small</span> <a href="https://x.test/a">link</a><br>second line</p>' +
	'<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>' +
	'<blockquote>quoted</blockquote><pre>line 1\nline 2</pre><hr>' +
	'<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>' +
	`<figure><img src="${PNG}" style="width:10px;height:auto" alt="dot"><figcaption>caption</figcaption></figure>` +
	'<p><br></p><p>end\r\nof text</p>';

describe('the document as a whole', () => {
	const rtf = htmlToRtf(el(EVERYTHING));

	it('is one RTF group: it opens with {\\rtf1 and its braces balance', () => {
		expect(rtf.startsWith('{\\rtf1\\ansi')).toBe(true);
		expect(rtf.endsWith('}')).toBe(true);
		let depth = 0;
		let lowest = Infinity;
		for (let i = 0; i < rtf.length; i++) {
			if (rtf[i] === '\\') {
				i++; // an escaped character, or the start of a control word
				continue;
			}
			if (rtf[i] === '{') depth++;
			if (rtf[i] === '}') depth--;
			if (i < rtf.length - 1) lowest = Math.min(lowest, depth);
		}
		expect(depth).toBe(0);
		expect(lowest).toBeGreaterThanOrEqual(1);
	});

	it('is plain ASCII on a single line, so it fits a CR-terminated transport', () => {
		expect(rtf).toMatch(/^[\x20-\x7e]*$/);
	});

	it('declares the code page and a fallback count that match its \\u escapes', () => {
		expect(rtf).toContain('\\ansicpg1252');
		expect(rtf).toContain('\\uc1');
		expect(rtf).toContain("\\u233\\'3f");
	});

	it('loses none of the text', () => {
		const letters = (html: string) => (el(html).textContent || '').replace(/[\s •—]|\d\./g, '');
		expect(letters(rtfToHtml(rtf))).toBe(letters(EVERYTHING));
	});

	it('an empty document is still a valid one', () => {
		expect(htmlToRtf(el(''))).toMatch(/^\{\\rtf1.*\}$/);
		expect(body('<p></p>')).toBe('\\par ');
	});
});

describe('text', () => {
	it('a backslash and braces are escaped', () => {
		expect(body('<p>a \\ b { c }</p>')).toBe('\\pard a \\\\ b \\{ c \\}\\par ');
	});

	it('text that looks like a control word stays text', () => {
		expect(rtfToHtml(htmlToRtf(el('<p>\\par \\b not bold {\\i}</p>')))).toBe('<p>\\par \\b not bold {\\i}</p>');
	});

	it('a line break in the source is a space, as on screen; a <br> is \\line', () => {
		expect(body('<p>a\r\nb<br>c</p>')).toBe('\\pard a b\\line c\\par ');
	});

	it('a non-breaking space is kept', () => {
		expect(body('<p>a&nbsp;b</p>')).toBe("\\pard a\\u160\\'3fb\\par ");
	});

	it('markup characters need no escaping in RTF', () => {
		expect(body('<p>&lt;tag&gt; &amp; "q"</p>')).toBe('\\pard <tag> & "q"\\par ');
	});
});

describe('blocks', () => {
	it('a blank paragraph is one empty line', () => {
		expect(body('<p>a</p><p><br></p><p>b</p>')).toBe('\\pard a\\par \\par \\pard b\\par ');
	});

	it.fails('NEW: the <br> a browser leaves at the end of a paragraph adds no line', () => {
		expect(body('<p>text<br></p>')).toBe('\\pard text\\par ');
	});

	it.fails('NEW: <h4>, <h5> and <h6> (pasted text) are paragraphs of their own', () => {
		const html = rtfToHtml(htmlToRtf(el('<h4>title</h4><p>x</p>')));
		expect(Array.from(el(html).children).map((c) => c.textContent)).toEqual(['title', 'x']);
	});

	it('a bullet list: one hanging paragraph per item, with a bullet and a tab', () => {
		expect(body('<ul><li>one</li><li>two</li></ul>')).toBe(
			'\\pard\\li720\\fi-360\\bullet\\tab one\\par \\pard\\li720\\fi-360\\bullet\\tab two\\par '
		);
	});

	it('a numbered list counts from 1', () => {
		expect(body('<ol><li>a</li><li>b</li></ol>')).toBe('\\pard\\li720\\fi-360 1.\\tab a\\par \\pard\\li720\\fi-360 2.\\tab b\\par ');
	});

	it.fails('#3.13: <ol start="5"> counts from 5', () => {
		expect(body('<ol start="5"><li>a</li><li>b</li></ol>')).toContain('5.\\tab a');
	});

	it.fails('#3.13: a nested list is its own paragraphs, indented further, with no empty one after', () => {
		const rtf = body('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
		expect(rtf).toContain('\\tab a\\par ');
		expect(rtf).toContain('\\li1440');
		expect(rtf).not.toContain('\\par \\par ');
	});

	it.fails('NEW: a list item that holds a paragraph (<li><p>, pasted from Word or Docs) is written like one that holds text', () => {
		expect(body('<ul><li><p>x</p></li></ul>')).toBe(body('<ul><li>x</li></ul>'));
	});

	it('a code block is monospace, smaller, with each line break kept', () => {
		expect(body('<pre>line 1\nline 2</pre>')).toBe('\\pard\\f1\\fs20 line 1\\line line 2\\f0\\fs24\\par ');
	});

	it('a rule is a centered line of dashes', () => {
		expect(body('<hr>')).toBe(`\\pard\\qc ${'\\emdash'.repeat(20)}\\par `);
	});

	it('loose text and inline elements straight in the editor are written without a paragraph of their own', () => {
		expect(body('hello <b>world</b>')).toBe('hello \\b world\\b0 ');
	});
});

describe('tables', () => {
	it('every row of a plain grid has the same column edges, ending at the page width', () => {
		const rtf = body('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table>');
		const [first, second] = rows(rtf).map(edges);
		expect(first).toEqual([2880, 5760, 8640]);
		expect(second).toEqual(first);
		expect(count(rtf, '\\cell}') + count(rtf, '\\cell{')).toBe(6);
		expect(count(rtf, '\\row')).toBe(2);
	});

	it('a column keeps the width its cells give it', () => {
		expect(edges(body('<table><tr><td style="width:25%">a</td><td style="width:75%">b</td></tr></table>'))).toEqual([2160, 8640]);
	});

	it('a header row gets a bottom border on each cell', () => {
		const [head, data] = rows(body('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>'));
		expect(count(head, '\\clbrdrb\\brdrs')).toBe(2);
		expect(count(data, '\\clbrdrb')).toBe(0);
	});

	it.fails('#3.13: in a row with one <th>, only that cell gets the header border', () => {
		expect(count(body('<table><tr><th>h</th><td>d</td></tr></table>'), '\\clbrdrb')).toBe(1);
	});

	it.fails('#3.13: a <thead> written after <tbody> is still the first row', () => {
		const rtf = body('<table><tbody><tr><td>body</td></tr></tbody><thead><tr><th>head</th></tr></thead></table>');
		expect(rtf.indexOf('head')).toBeLessThan(rtf.indexOf('body'));
	});

	it.fails('NEW: a cell\'s own alignment (<td style="text-align:right">, as rtfToHtml writes it) is written', () => {
		expect(body('<table><tr><td style="text-align:right">1.5</td><td>b</td></tr></table>')).toContain('\\qr');
	});

	it.fails('NEW: a right-aligned cell read from RTF is written back right-aligned', () => {
		const html = rtfToHtml('{\\rtf1\\ansi \\trowd\\cellx4320\\cellx8640 \\pard\\intbl\\qr 1.5\\cell \\pard\\intbl b\\cell\\row}');
		expect((el(html).querySelector('td') as HTMLElement).style.textAlign).toBe('right');
		expect(htmlToRtf(el(html))).toContain('\\qr');
	});

	it.fails('#2: rowspan keeps one set of column edges, with \\clvmgf on the first row and \\clvmrg below it', () => {
		const rtf = body('<table><tr><td rowspan="2">Group</td><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>');
		const [first, second] = rows(rtf);
		expect(edges(second)).toEqual(edges(first));
		expect(first).toContain('\\clvmgf');
		expect(second).toContain('\\clvmrg');
	});

	it.fails('#2: a colspan cell ends at the right edge of the last column it covers', () => {
		const rtf = body('<table><tr><td colspan="2">wide</td><td>c</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>');
		expect(edges(rows(rtf)[0])).toEqual([5760, 8640]);
	});

	it.fails('#2: a table inside a cell does not open a row inside that cell', () => {
		expect(body('<table><tr><td><table><tr><td>in</td></tr></table></td></tr></table>')).not.toContain('\\fi0 {\\trowd');
	});
});

describe('links', () => {
	it('a web link is a HYPERLINK field with the text underlined', () => {
		expect(body('<p><a href="https://x.test/a">click</a></p>')).toBe(
			'\\pard {\\field{\\*\\fldinst HYPERLINK "https://x.test/a"}{\\fldrslt\\ul\\cf1 click\\cf0\\ulnone }}\\par '
		);
	});

	it.fails('#3.13: a link has a color of its own, so it can be told from underlined text', () => {
		const rtf = htmlToRtf(el('<p><a href="https://x.test/a">click</a></p>'));
		const table = rtf.match(/\{\\colortbl[^}]*\}/)![0];
		expect(table).not.toBe('{\\colortbl;\\red0\\green0\\blue0;}');
	});
});

describe('htmlToMarkdown', () => {
	const md = (html: string) => htmlToMarkdown(el(html));

	it('headings, emphasis, links, code, lists, quotes and rules', () => {
		expect(md('<h1>T</h1><p>a <strong>b</strong> <em>c</em> <a href="https://x.test/">l</a> <code>k</code></p>')).toBe(
			'# T\n\na **b** *c* [l](https://x.test/) `k`\n\n'
		);
		expect(md('<ul><li>x</li></ul><ol><li>y</li><li>z</li></ol>')).toBe('- x\n\n1. y\n2. z\n\n');
		expect(md('<blockquote>q</blockquote><pre>c\nd</pre><hr>')).toBe('> q\n\n```\nc\nd\n```\n\n\n---\n\n');
	});

	it('a picture with a caption', () => {
		expect(md('<figure><img src="a.png" alt="dot"><figcaption>cap</figcaption></figure>')).toBe('![dot](a.png)\n\n*cap*\n\n');
	});

	it.fails('#3.13: a table is written as a Markdown table', () => {
		expect(md('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>')).toBe(
			'| H1 | H2 |\n| --- | --- |\n| a | b |\n\n'
		);
	});

	it.fails('#3.13: characters that mean something in Markdown are escaped in text', () => {
		expect(md('<p>1*2*3 _x_ # [y]</p>')).toBe('1\\*2\\*3 \\_x\\_ \\# \\[y\\]\n\n');
	});

	it.fails('NEW: an unsafe link is written as its text alone, as in the RTF', () => {
		expect(md('<p><a href="javascript:alert(1)">x</a></p>')).toBe('x\n\n');
	});
});
