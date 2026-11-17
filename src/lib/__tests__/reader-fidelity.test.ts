import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RtfViewer from '../RtfViewer.svelte';
import { rtfToHtml, readRtfFile, DEFAULT_MAX_RTF_BYTES } from '../rtf-parser.js';
import { htmlToRtf } from '../rtf-writer.js';

/**
 * What rtfToHtml makes of links, code, headings, rules, page breaks, single characters and
 * table cells, in RTF from this library and from Word and TextEdit, and what it refuses to read
 * at all. The rule throughout: what the reader shows is what the RTF says, and what it cannot
 * show faithfully it leaves as plain text rather than guess. Invented text.
 */

const R = String.raw;
/** \uN with its one-character fallback, built by hand: a raw template would read the escape itself. */
const u = (code: number, fallback = '?') => `\\u${code}${fallback}`;
const read = (body: string, fontSize?: number) => rtfToHtml(`{\\rtf1\\ansi\\ansicpg1252\\deff0 ${body}}`, { fontSize });
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const back = (html: string) => rtfToHtml(htmlToRtf(el(html)));

describe('links (#3.4)', () => {
	const field = (address: string, text = 'click') => `{\\field{\\*\\fldinst HYPERLINK "${address}"}{\\fldrslt ${text}}}`;

	it('a web link is an <a> that opens in a tab of its own; a mail or phone link is a plain <a>', () => {
		expect(read(`${field('https://x.test/a')}\\par`)).toBe('<p><a href="https://x.test/a" target="_blank" rel="noopener noreferrer">click</a></p>');
		expect(read(`${field('mailto:lab@x.test')} ${field('tel:+15551234')}\\par`)).toBe(
			'<p><a href="mailto:lab@x.test">click</a> <a href="tel:+15551234">click</a></p>'
		);
	});

	it('the link the writer sends comes back without the underline and color the writer adds to it', () => {
		expect(back('<p>see <a href="https://x.test/a">the note</a>.</p>')).toBe(
			'<p>see <a href="https://x.test/a" target="_blank" rel="noopener noreferrer">the note</a>.</p>'
		);
	});

	it('formatting inside the link is kept, and the link is one element around all of it', () => {
		const html = read(`${field('https://x.test/a', 'a \\b bold\\b0  and \\i it\\i0')}\\par`);
		expect(el(html).querySelectorAll('a').length).toBe(1);
		expect(el(html).querySelector('a')!.innerHTML).toBe('a <strong>bold</strong> and <em>it</em>');
	});

	it('Word\'s field: the instruction in a group of its own, the text in the Hyperlink style', () => {
		const html = read(R`{\colortbl;\red5\green99\blue193;}{\field{\*\fldinst {\rtlch \ltrch HYPERLINK "https://x.test/report" }}{\fldrslt {\cs15\ul\cf1 the report}}}\par`);
		const a = el(html).querySelector('a')!;
		expect(a.getAttribute('href')).toBe('https://x.test/report');
		// Word's own link color is the document's to keep; the underline is the link's.
		expect(a.innerHTML).toBe('<span style="color:rgb(5,99,193)">the report</span>');
	});

	it('an address without quotes, and one with a tooltip switch after it', () => {
		expect(el(read(R`{\field{\*\fldinst HYPERLINK https://x.test/a }{\fldrslt t}}\par`)).querySelector('a')!.getAttribute('href')).toBe('https://x.test/a');
		expect(el(read(R`{\field{\*\fldinst HYPERLINK "https://x.test/a" \\o "tip"}{\fldrslt t}}\par`)).querySelector('a')!.getAttribute('href')).toBe('https://x.test/a');
	});

	it('an address is escaped as an attribute and as a URL', () => {
		const html = read(`${field('https://x.test/a?b=1&c=<2>')}\\par`);
		expect(html).toContain('href="https://x.test/a?b=1&amp;c=%3C2%3E"');
	});

	it('a link that runs over two paragraphs is a link in each', () => {
		const html = read(R`{\field{\*\fldinst HYPERLINK "https://x.test/"}{\fldrslt one\par two}}\par after\par`);
		expect(Array.from(el(html).querySelectorAll('p')).map((p) => p.querySelectorAll('a').length)).toEqual([1, 1, 0]);
	});

	const refused: Record<string, string> = {
		'javascript:': 'javascript:alert(1)',
		'javascript: in capitals with a space before it': ' JaVaScRiPt:alert(1)',
		'data:': 'data:text/html,<script>alert(1)</script>',
		'vbscript:': 'vbscript:msgbox(1)',
		'file:': 'file:///etc/passwd',
		'a relative path': '../../x.exe',
		'a network path': R`\\\\server\\share\\x.exe`,
		'a web address with a backslash': R`https://x.test\\@evil.test/`,
		'nothing': ''
	};
	for (const [name, address] of Object.entries(refused)) {
		it(`${name} is not a link: its text stays, as text`, () => {
			const html = read(`before ${field(address)} after\\par`);
			expect(el(html).querySelector('a')).toBeNull();
			expect(el(html).textContent).toBe('before click after');
			expect(html).not.toMatch(/javascript:|vbscript:|data:text|file:/i);
		});
	}

	it('a link to a bookmark, and a field that is no link, keep their text only', () => {
		expect(read(R`{\field{\*\fldinst HYPERLINK \\l "section2"}{\fldrslt see below}} page {\field{\*\fldinst PAGE}{\fldrslt 3}}\par`)).toBe('<p>see below page 3</p>');
	});

	it('an address with a \\u escape in it is not guessed at', () => {
		const html = read(`{\\field{\\*\\fldinst HYPERLINK "https://x.test/caf${u(233)}"}{\\fldrslt menu}}\\par`);
		expect(el(html).querySelector('a')).toBeNull();
		expect(html).toBe('<p>menu</p>');
	});
});

describe('code: text in a monospace font', () => {
	const FONTS = R`{\fonttbl{\f0\fswiss Arial;}{\f1\fmodern Courier New;}}`;

	it('inside a paragraph it is <code>', () => {
		expect(read(`${FONTS}run \\f1 ls -la\\f0  now\\par`)).toBe('<p>run <code>ls -la</code> now</p>');
		expect(back('<p>a <code>b</code> c</p>')).toBe('<p>a <code>b</code> c</p>');
	});

	it('a paragraph set wholly in it, at the code block size, is <pre> with its lines and spaces', () => {
		expect(back('<pre>if (x) {\n    y();\n}</pre>')).toBe('<pre>if (x) {\n    y();\n}</pre>');
		expect(read(`${FONTS}\\pard\\f1\\fs20   two spaces\\line\\tab a tab\\f0\\fs24\\par`)).toBe('<pre>  two spaces\n\ta tab</pre>');
	});

	it('a whole line of code at the body size is a paragraph of <code>, not a block', () => {
		expect(read(`${FONTS}\\pard\\f1 whole line\\f0\\par`)).toBe('<p><code>whole line</code></p>');
	});

	it('a code block keeps bold and color inside it, and its indent', () => {
		expect(back('<pre>a <b>b</b> c</pre>')).toBe('<pre>a <strong>b</strong> c</pre>');
		expect(back('<pre style="margin-left:48px">x</pre>')).toBe('<pre style="margin-left:36pt">x</pre>');
	});

	it('code inside bold text, and bold text inside code', () => {
		expect(back('<p><b>a <code>b</code></b></p>')).toBe('<p><strong>a </strong><strong><code>b</code></strong></p>');
		expect(back('<p><code>a <i>b</i></code></p>')).toBe('<p><code>a </code><em><code>b</code></em></p>');
	});

	it('TextEdit\'s font table, with no group around each font', () => {
		const html = rtfToHtml(R`{\rtf1\ansi\ansicpg1252\cocoartf2761{\fonttbl\f0\fswiss\fcharset0 Helvetica;\f1\fmodern\fcharset0 Courier;}\pard\f0\fs24 run \f1 ls\f0  now\par}`);
		expect(html).toBe('<p>run <code>ls</code> now</p>');
	});

	it('Word\'s font table: a name after a {\\*\\panose} group, a fixed pitch (\\fprq1)', () => {
		const html = rtfToHtml(R`{\rtf1\ansi\deff0{\fonttbl{\f0\froman\fprq2{\*\panose 02020603050405020304}Times New Roman;}{\f37\fnil\fprq1{\*\panose 020b0609020204030204}Lucida Sans Typewriter;}}a \f37 b\f0  c\par}`);
		expect(html).toBe('<p>a <code>b</code> c</p>');
	});

	it('in a document whose own font is monospace, nothing is code: it is all just text', () => {
		const html = rtfToHtml(R`{\rtf1\ansi\deff0{\fonttbl{\f0\fmodern Courier New;}{\f1\fmodern Consolas;}}\f0\fs20 Final diagnosis:\par \f1 Benign.\par}`);
		expect(html).not.toMatch(/<(code|pre)\b/);
		expect(el(html).textContent).toBe('Final diagnosis:\nBenign.');
	});

	it('\\plain goes back to the document\'s font', () => {
		expect(read(`${FONTS}\\f1 code\\plain  text\\par`)).toBe('<p><code>code</code> text</p>');
	});

	it('a font the table does not list is not code', () => {
		expect(read(`${FONTS}\\f9 text\\par`)).toBe('<p>text</p>');
	});
});

describe('headings (#3.7)', () => {
	it('a heading the writer sent is the element and nothing inside it but its text', () => {
		expect(back('<h1>One</h1><h2>Two</h2><h3>Three</h3>')).toBe('<h1>One</h1>\n<h2>Two</h2>\n<h3>Three</h3>');
		expect(back('<h2>Final <em>diagnosis</em></h2>')).toBe('<h2>Final <em>diagnosis</em></h2>');
	});

	it('a size on part of a paragraph is that part\'s size, not a heading', () => {
		expect(read(R`normal text \fs48 BIG\fs24  more normal\par`)).toBe('<p>normal text <span style="font-size:24pt">BIG</span> more normal</p>');
		expect(read(R`\b\fs48 Lead\b0\fs24  then body text\par`)).toBe('<p><strong><span style="font-size:24pt">Lead</span></strong> then body text</p>');
	});

	it('spaces set at another size do not stop a paragraph being a heading', () => {
		expect(read(R`\pard\b\fs36 Two\fs24  \fs36 words\b0\fs24\par`)).toBe('<h2>Two words</h2>');
	});

	it('a heading larger than its level keeps that size, so it is written back as large', () => {
		const html = read(R`\pard\b\fs32 Sixteen point\b0\fs24\par`);
		expect(html).toBe('<h3><span style="font-size:16pt">Sixteen point</span></h3>');
		expect(htmlToRtf(el(html))).toContain('\\fs28\\b \\fs32 Sixteen point\\fs28 \\b0\\fs24\\par ');
	});

	it('at another body size a heading must be bold; at 12 pt its size is enough', () => {
		expect(read(R`\pard\fs40 large\fs20\par`, 10)).toBe('<p><span style="font-size:20pt">large</span></p>');
		expect(read(R`\pard\b\fs40 large\b0\fs20\par`, 10)).toBe('<h1>large</h1>');
		expect(read(R`\pard\fs48 large\fs24\par`)).toBe('<h1>large</h1>');
	});

	it('a heading is bold throughout, so text in it that differs only in bold is one piece', () => {
		// Written again a heading is all bold; read as three pieces it then became one, and
		// the document changed on its second save as well as its first.
		const html = read(R`\pard\fs48\super a\b b\b0 c\nosupersub\fs24\par`);
		expect(html).toBe('<h1><sup>abc</sup></h1>');
		const saved = htmlToRtf(el(html));
		expect(htmlToRtf(el(rtfToHtml(saved)))).toBe(saved);
	});

	it('a heading keeps its alignment and indents', () => {
		expect(back('<h2 style="text-align:center">Centered</h2>')).toBe('<h2 style="text-align:center">Centered</h2>');
	});

	it('a picture with large text beside it is a paragraph', () => {
		const html = read(R`\pard\fs48 {\pict\pngblip\picw1\pich1 89504e470d0a1a0a} big\fs24\par`);
		expect(html.startsWith('<p>')).toBe(true);
	});
});

describe('rules and page breaks (#3.8)', () => {
	it('the rule the writer sends is <hr> again', () => {
		expect(back('<p>a</p><hr><p>b</p>')).toBe('<p>a</p>\n<hr>\n<p>b</p>');
	});

	it('only that line is a rule: not fewer dashes, not left-aligned ones, not bold ones, not dashes with text', () => {
		const dashes = (n: number) => '\\emdash'.repeat(n);
		expect(read(`\\pard\\qc ${dashes(19)}\\par`)).not.toContain('<hr');
		expect(read(`\\pard ${dashes(20)}\\par`)).not.toContain('<hr');
		expect(read(`\\pard\\qc\\b ${dashes(20)}\\b0\\par`)).not.toContain('<hr');
		expect(read(`\\pard\\qc ${dashes(20)} end\\par`)).not.toContain('<hr');
		expect(read(`\\pard\\qc ${dashes(20)}\\par`)).toBe('<hr>');
	});

	it('a rule saved by an earlier version, as twenty escaped dashes, is a rule too', () => {
		expect(read(`\\pard\\qc ${u(8212).repeat(20)}\\par`)).toBe('<hr>');
	});

	it('\\page is a rule that says it is a page break, and goes back as \\page', () => {
		const html = read(R`A\par \page B\par`);
		expect(html).toBe('<p>A</p>\n<hr style="break-after:page">\n<p>B</p>');
		const saved = htmlToRtf(el(html));
		expect(saved).toContain('\\pard A\\par \\page \\pard B\\par ');
		expect(saved).not.toContain('\\emdash');
		expect(rtfToHtml(saved)).toBe(html);
	});

	it('\\page in the middle of a paragraph ends the text before it', () => {
		expect(read(R`A\page B\par`)).toBe('<p>A</p>\n<hr style="break-after:page">\n<p>B</p>');
	});

	it('\\sect ends a paragraph', () => {
		expect(read(R`A\sect B\par`)).toBe('<p>A</p>\n<p>B</p>');
		expect(read(R`A\par\sect B\par`)).toBe('<p>A</p>\n<p><br></p>\n<p>B</p>');
	});
});

describe('characters', () => {
	it("\\'xx in capitals, and the Latin-1 bytes above \\'9f", () => {
		expect(read(R`\'E9\'e9 \'A0\'ff\par`)).toBe('<p>éé  ÿ</p>');
	});

	it("a \\' that is not followed by two hex digits is dropped, and what follows is kept", () => {
		expect(rtfToHtml("{\\rtf1\\ansi abc\\'")).toBe('<p>abc</p>');
		expect(rtfToHtml("{\\rtf1\\ansi abc\\'zz def\\par}")).toBe('<p>abczz def</p>');
		expect(rtfToHtml("{\\rtf1\\ansi abc\\'4z def\\par}")).toBe('<p>abc4z def</p>');
	});

	it("no NUL reaches the HTML: not from \\'00, not from \\u0", () => {
		const html = read(`a\\'00b${u(0)}c\\par`);
		expect(html).toBe('<p>abc</p>');
	});

	it('a \\u out of range is no character, and does not stop the document being read', () => {
		expect(read(`a${u(9999999)}b${u(-99999)}c\\par`)).toBe('<p>abc</p>');
	});

	it('a code point above U+FFFF given whole, as some writers do, is that character', () => {
		expect(read(`${u(128512)}\\par`)).toBe('<p>\u{1F600}</p>');
	});

	it('half of a surrogate pair by itself is shown as the replacement character, not as broken text', () => {
		expect(read(`a${u(-10179)}b ${u(-8704)}c\\par`)).toBe('<p>a�b �c</p>');
		expect(read(`${u(-10179)}\\par next\\par`)).toBe('<p>�</p>\n<p>next</p>');
	});

	it('a pair in formatted text is one character in one element', () => {
		expect(read(`\\b ${u(-10179)}${u(-8704)}\\b0\\par`)).toBe('<p><strong>\u{1F600}</strong></p>');
		expect(back('<p><span style="color:rgb(255,0,0)">a\u{1F600}b</span></p>')).toBe('<p><span style="color:rgb(255,0,0)">a\u{1F600}b</span></p>');
	});

	it("accented text in one format is one element, whether its letters come as \\'xx or \\u", () => {
		expect(read(R`\b caf\'e9 au lait\b0\par`)).toBe('<p><strong>café au lait</strong></p>');
		expect(back('<p><em>naïve café</em></p>')).toBe('<p><em>naïve café</em></p>');
	});

	it("the fallback after \\u is skipped whether it is a letter or a \\'xx, even one that decodes to nothing", () => {
		expect(read(`${u(8364, "\\'80")}5 ${u(8364, "\\'00")}6 \\uc2 ${u(8364, "\\'80\\'80")}7\\par`)).toBe('<p>€5 €6 €7</p>');
	});

	it('a named symbol has the formatting of the text around it', () => {
		expect(read(R`\b a\emdash b\b0  c\endash d\par`)).toBe('<p><strong>a—b</strong> c–d</p>');
	});

	it('a size does not show on spaces, so spaces at another size go with the text beside them', () => {
		expect(read(R`\b a\fs36  \fs24 b\b0\par`)).toBe('<p><strong>a b</strong></p>');
		expect(read(R`\fs36  \fs24 a\par`)).toBe('<p>a</p>');
		// Spaces in another format are still their own: an underlined blank is a signature line.
		expect(read(R`Signed: \ul      \ulnone  MD\par`)).toBe('<p>Signed: <u>     </u> MD</p>');
	});

	it('black text and text with a color the table does not have are the same as uncolored text', () => {
		expect(read(R`{\colortbl;\red0\green0\blue0;}\i\cf1 a\cf0 b\cf7 c\i0\par`)).toBe('<p><em>abc</em></p>');
	});

	it('non-breaking and em spaces at the ends of a paragraph are text, and are kept', () => {
		expect(read(R`\~\~indented\~\par`)).toBe('<p>  indented </p>');
		expect(htmlToRtf(el(read(R`\~\~indented\par`)))).toContain("\\pard \\u160\\'3f\\u160\\'3findented\\par ");
	});
});

describe('line breaks at the end of a paragraph', () => {
	it('\\line before \\par leaves an empty last line, which is shown and written back', () => {
		const html = read(R`text\line\par next\par`);
		expect(html).toBe('<p>text<br><br></p>\n<p>next</p>');
		expect(htmlToRtf(el(html))).toContain('\\pard text\\line \\par \\pard next\\par ');
	});

	it('a paragraph that is one line break is two lines, as in the RTF', () => {
		const saved = htmlToRtf(el(read(R`a\par\line\par b\par`)));
		expect(saved).toContain('\\pard a\\par \\pard \\line \\par \\pard b\\par ');
		expect(htmlToRtf(el(rtfToHtml(saved)))).toBe(saved);
	});
});

describe('\\pard and character formatting (#3.5)', () => {
	it('bold, italic, underline and strikethrough carry on past \\pard, until \\plain', () => {
		expect(read(R`\b one\par\pard two\par\pard\plain three\par`)).toBe('<p><strong>one</strong></p>\n<p><strong>two</strong></p>\n<p>three</p>');
	});

	it('\\pard still ends the alignment and the indents', () => {
		expect(read(R`\pard\qc\li720 a\par\pard b\par`)).toBe('<p style="text-align:center;margin-left:36pt">a</p>\n<p>b</p>');
	});

	it('what the writer sends is unchanged by it: every format is restated after \\pard', () => {
		const html = '<p><strong>bold</strong></p><p>plain</p><h2>Head</h2><p><em>it</em> plain</p><blockquote>q</blockquote><p>plain</p>';
		expect(back(html)).toBe(
			'<p><strong>bold</strong></p>\n<p>plain</p>\n<h2>Head</h2>\n<p><em>it</em> plain</p>\n<p style="margin-left:36pt"><em>q</em></p>\n<p>plain</p>'
		);
	});
});

describe('table cells and the paragraphs around them (#3.9)', () => {
	it('\\intbl with no \\row: \\pard ends the table, and the paragraphs after it are paragraphs', () => {
		expect(read(R`\intbl x\par \pard after\par more\par`)).toBe('<p>x</p>\n<p>after</p>\n<p>more</p>');
	});

	it('\\intbl with no \\row and no \\pard: every paragraph is at least a line of its own', () => {
		// They were run together into one word: "xaftermore".
		expect(read(R`\intbl x\par after\par more\par`)).toBe('<p>x<br>after<br>more</p>');
	});

	it('a blank line that was owed is kept when the table is left', () => {
		expect(read(R`\intbl x\par\par \pard after\par`)).toBe('<p>x</p>\n<p><br></p>\n<p>after</p>');
	});

	it('a \\pard inside a cell that is followed by \\intbl stays in the cell', () => {
		const html = read(R`\trowd\cellx8640 \pard\intbl one\par \pard\intbl two\par \pard\intbl three\cell\row \pard after\par`);
		expect(el(html).querySelector('td')!.innerHTML).toBe('one<br>two<br>three');
		expect(html.endsWith('<p>after</p>')).toBe(true);
	});

	it('an empty paragraph inside a cell is an empty line there', () => {
		const html = read(R`\trowd\cellx8640 \pard\intbl one\par \pard\intbl \par \pard\intbl two\cell\row`);
		expect(el(html).querySelector('td')!.innerHTML).toBe('one<br><br>two');
	});

	it('the paragraph mark that ends a cell\'s last paragraph adds no line', () => {
		const html = read(R`\trowd\cellx4320\cellx8640 {\pard\intbl a\par}\cell {\pard\intbl b\par}\cell\row`);
		expect(Array.from(el(html).querySelectorAll('td')).map((td) => td.innerHTML)).toEqual(['a', 'b']);
	});

	const cellsOf = (html: string) =>
		Array.from(el(html).querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => c.innerHTML));

	it('a row the file ends in the middle of, with no \\row, keeps its cells', () => {
		// The cells were dropped: their text was nowhere in the HTML.
		const html = read(R`before\par \trowd\cellx4320\cellx8640 \intbl a\cell b\cell`);
		expect(cellsOf(html)).toEqual([['a', 'b']]);
		expect(html.startsWith('<p>before</p>\n<table')).toBe(true);
	});

	it('text after a row\'s last \\cell is a cell, not the start of the paragraph after the table', () => {
		const html = read(R`\trowd\cellx4320\cellx8640 \intbl a\cell b\row after\par`);
		expect(cellsOf(html)).toEqual([['a', 'b']]);
		expect(html.endsWith('<p>after</p>')).toBe(true);
	});

	it('between a row\'s first \\cell and its \\row, a \\pard with no \\intbl is still the next cell', () => {
		const html = read(R`\trowd\cellx4320\cellx8640 \intbl a\cell\pard b\par c\cell\row after\par`);
		expect(cellsOf(html)).toEqual([['a', 'b<br>c']]);
		expect(html.endsWith('<p>after</p>')).toBe(true);
	});

	it('a row that is never ended keeps its cell, and the text after it is not lost', () => {
		const html = read(R`\trowd\cellx4320\cellx8640 \intbl a\cell \pard after\par more\par`);
		expect(cellsOf(html)).toEqual([['a']]);
		expect(html.endsWith('<p>after<br>more</p>')).toBe(true);
	});

	it('a table Word wrote, with every row\'s definition before its cells and again before \\row', () => {
		const row = (a: string, b: string) =>
			`\\trowd\\trgaph108\\cellx4320\\cellx8640\\pard\\plain\\ql\\intbl {${a}\\cell ${b}\\cell }\\pard\\plain\\ql\\intbl {\\trowd\\trgaph108\\cellx4320\\cellx8640\\row }`;
		const html = read(`${row('Site', 'Result')}${row('Margin', 'Negative')}\\pard\\plain after\\par`);
		expect(Array.from(el(html).querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => c.textContent))).toEqual([
			['Site', 'Result'],
			['Margin', 'Negative']
		]);
		expect(html.endsWith('<p>after</p>')).toBe(true);
	});
});

describe('a document too large to read (#3.10)', () => {
	const big = (length: number) => `{\\rtf1\\ansi ${'x'.repeat(length)}}`;

	it('rtfToHtml refuses one over the limit before parsing any of it', () => {
		expect(DEFAULT_MAX_RTF_BYTES).toBe(50 * 1024 * 1024);
		expect(() => rtfToHtml(big(2000), { maxBytes: 1000 })).toThrow(RangeError);
		expect(() => rtfToHtml(big(2000), { maxBytes: 1000 })).toThrow(/too large/);
	});

	it('one at the limit is read, and 0 reads any size', () => {
		const rtf = big(100);
		expect(rtfToHtml(rtf, { maxBytes: rtf.length })).toContain('xxxx');
		expect(rtfToHtml(rtf, { maxBytes: 0 })).toContain('xxxx');
		expect(() => rtfToHtml(rtf, { maxBytes: rtf.length - 1 })).toThrow(RangeError);
	});

	it('readRtfFile refuses a file over the limit without reading it, and says how large it is', async () => {
		const file = new File([big(5 * 1024 * 1024)], 'report.rtf');
		await expect(readRtfFile(file, { maxBytes: 1024 * 1024 })).rejects.toThrow('This file is too large to import: 5.0 MB, and the limit is 1.0 MB');
	});

	it('readRtfFile reads a file under the limit', async () => {
		await expect(readRtfFile(new File([big(10)], 'report.rtf'))).resolves.toBe('<p>xxxxxxxxxx</p>');
	});

	it('a group nested 100,000 deep is read without running out of stack', () => {
		const depth = 100000;
		expect(rtfToHtml(`{\\rtf1 ${'{'.repeat(depth)}deep${'}'.repeat(depth)} after}`)).toBe('<p>deep after</p>');
	});

	it('formatting set in a deeply nested group still ends with its group', () => {
		expect(rtfToHtml(R`{\rtf1 a{\b b{\i c{\ul d}e}f}g}`)).toBe('<p>a<strong>b</strong><em><strong>c</strong></em><u><em><strong>d</strong></em></u><em><strong>e</strong></em><strong>f</strong>g</p>');
	});
});

describe('RtfViewer', () => {
	let host: HTMLDivElement | null = null;
	let component: Record<string, unknown> | null = null;

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
	});

	function view(content: string | null, extra: Record<string, unknown> = {}): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		component = mount(RtfViewer as any, { target: host, props: { content, ...extra } }) as Record<string, unknown>;
		flushSync();
		return host.querySelector('.rtf-viewer') as HTMLElement;
	}

	it('shows a list, a link, code and a merged table as what they are', () => {
		const rtf = htmlToRtf(
			el('<ul><li>one<ul><li>inner</li></ul></li></ul><p><a href="https://x.test/a">link</a> <code>code</code></p><table><tr><td rowspan="2">G</td><td>a</td></tr><tr><td>b</td></tr></table>')
		);
		const viewer = view(rtf);
		expect(viewer.querySelectorAll('ul').length).toBe(2);
		expect(viewer.querySelector('a')!.getAttribute('href')).toBe('https://x.test/a');
		expect(viewer.querySelector('code')!.textContent).toBe('code');
		expect(viewer.querySelector('td')!.getAttribute('rowspan')).toBe('2');
	});

	it('says so in place of a document that is too large, instead of failing to render', () => {
		const viewer = view(`{\\rtf1 ${'x'.repeat(DEFAULT_MAX_RTF_BYTES)}}`);
		const message = viewer.querySelector('.rtf-viewer-error');
		expect(message?.textContent).toMatch(/too large/);
		expect(message?.textContent).toMatch(/50\.0 MB/);
		expect(viewer.textContent).not.toContain('xxxx');
	});

	it('maxRtfBytes raises the limit for reports that carry large pictures, and 0 removes it', () => {
		const rtf = `{\\rtf1 ${'x'.repeat(2000)}}`;
		expect(view(rtf, { maxRtfBytes: 1000 }).querySelector('.rtf-viewer-error')?.textContent).toMatch(/too large/);
		unmount(component!);
		host!.remove();
		expect(view(rtf, { maxRtfBytes: 0 }).textContent).toContain('xxxx');
	});

	it('a report that has not loaded yet shows as empty, not as an error', () => {
		const viewer = view(null);
		expect(viewer.querySelector('.rtf-viewer-error')).toBeNull();
		expect(viewer.textContent).not.toMatch(/Cannot read|null/);
	});
});

describe('what reads as code, and what does not', () => {
	const fonts = R`{\fonttbl{\f0\fswiss Arial;}{\f1\fmodern Courier New;}{\f2\fnil American Typewriter;}{\f3\fnil Monotype Corsiva;}{\f4\fmodern Roboto Mono;}}`;
	const doc = (body: string) => rtfToHtml(`{\\rtf1\\ansi\\deff0${fonts} ${body}}`);

	it('a proportional font whose name only contains "mono" or "typewriter" is not code', () => {
		expect(doc(R`\f2 Hello\f0  world\par`)).toBe('<p>Hello world</p>');
		expect(doc(R`\f3 Hello\f0  world\par`)).toBe('<p>Hello world</p>');
	});

	it('Courier New and a "… Mono" family still are', () => {
		expect(doc(R`a \f1 b\f0  c\par`)).toContain('<code>b</code>');
		expect(doc(R`a \f4 b\f0  c\par`)).toContain('<code>b</code>');
	});

	it("Word's second-level bullet, set in Courier New, is a marker, not code", () => {
		const html = doc(R`{\listtext\pard\plain\f1 o\tab}\pard\plain\li1440\fi-360 Sub\par`);
		expect(html).not.toContain('<code>');
		expect(html).toContain('Sub');
	});
});

describe('a table with many columns reads in time', () => {
	it('one row of 60,000 cells with distinct edges reads in well under two seconds', () => {
		const n = 60000;
		let rtf = '{\\rtf1\\ansi \\trowd';
		for (let k = 0; k < n; k++) rtf += `\\cellx${100 + 31 * k}`;
		rtf += '\\pard\\intbl ' + 'x\\cell '.repeat(n) + '\\row}';
		const t0 = performance.now();
		const html = rtfToHtml(rtf);
		expect(performance.now() - t0).toBeLessThan(2000);
		expect(html.match(/<td/g)?.length).toBe(n);
	});
});

describe('deep nesting around many rows reads in time', () => {
	it('100,000 nested groups around 50,000 rows read in well under two seconds', () => {
		const depth = 100000;
		const rtf = `{\\rtf1\\ansi ${'{'.repeat(depth)}\\trowd\\cellx1000 ${'\\intbl x\\cell\\row '.repeat(50000)}${'}'.repeat(depth)}}`;
		const t0 = performance.now();
		rtfToHtml(rtf);
		expect(performance.now() - t0).toBeLessThan(2000);
	});
});

describe('a numbered line written with a leading zero', () => {
	it('"01.", "02." stay as typed instead of becoming a list that shows "1.", "2."', () => {
		const html = rtfToHtml(R`{\rtf1\ansi \pard\li720\fi-360 01.\tab First\par \pard\li720\fi-360 02.\tab Second\par}`);
		expect(html).not.toContain('<ol');
		expect(html).toContain('01.');
		expect(html).toContain('02.');
	});

	it('"1.", "2." still make a list', () => {
		expect(rtfToHtml(R`{\rtf1\ansi \pard\li720\fi-360 1.\tab First\par \pard\li720\fi-360 2.\tab Second\par}`)).toContain('<ol>');
	});
});

describe('what the second review found in the reader', () => {
	it('PostScript and joined names of monospace fonts are still code', () => {
		for (const name of ['CourierNewPSMT', 'SFMono-Regular', 'AndaleMono', 'PTMono-Regular', 'RobotoMono-Regular', 'DejaVuSansMono', 'LiberationMono']) {
			const html = rtfToHtml(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss Arial;}{\\f1\\fnil\\fcharset0 ${name};}} Run \\f1 npm test\\f0  now\\par}`);
			expect(html, name).toBe('<p>Run <code>npm test</code> now</p>');
		}
	});

	it('a hairline or triple border on another side makes a cell an ordinary one', () => {
		for (const style of ['brdrhair', 'brdrtriple', 'brdrsh']) {
			const html = rtfToHtml(`{\\rtf1\\ansi \\trowd\\clbrdrt\\${style}\\clbrdrb\\brdrs\\cellx8640\\intbl a\\cell\\row}`);
			expect(html, style).toContain('<td');
			expect(html, style).not.toContain('<th');
		}
	});

	it('a size just over the limit does not read as equal to it', () => {
		const rtf = `{\\rtf1 ${'x'.repeat(1024 * 1024)}}`;
		expect(() => rtfToHtml(rtf, { maxBytes: 1024 * 1024 })).toThrow('This document is too large to show: 1.1 MB, and the limit is 1.0 MB');
	});
});
