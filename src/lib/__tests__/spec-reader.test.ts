import { describe, it, expect } from 'vitest';
import { rtfToHtml } from '../rtf-parser.js';
import { htmlToRtf } from '../rtf-writer.js';

/**
 * What rtfToHtml is expected to do with RTF it did not write itself: characters, character and
 * paragraph formatting, headings, lists, links, tables, damaged input, and the escaping that
 * RtfViewer's {@html} depends on.
 *
 * A test marked `it.fails` states the expected behavior for something that is still open; the
 * title names the issue. It passes while the bug is there and turns red when the bug is fixed,
 * which is the cue to drop `.fails`. Invented text.
 */

const R = String.raw;
/** \uN with its one-character fallback, built by hand: a raw template would read ሴ itself. */
const u = (code: number, fallback = '?') => `\\u${code}${fallback}`;
const doc = (body: string) => `{\\rtf1\\ansi\\ansicpg1252\\deff0 ${body}}`;
const read = (body: string) => rtfToHtml(doc(body));
const dom = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const el = dom;

describe('characters', () => {
	it('\\uN is a signed 16-bit number: negative values are U+8000 and up', () => {
		expect(read(`${u(233)} ${u(-24576)}\\par`)).toBe('<p>é ꀀ</p>');
	});

	it('the two halves of a surrogate pair make one character', () => {
		expect(read(`${u(-10179)}${u(-8704)}\\par`)).toBe('<p>\u{1F600}</p>');
	});

	it('\\ucN says how many fallback characters follow each \\u', () => {
		expect(read(`\\uc2 ${u(8364, 'EU')}ro \\uc0 ${u(8364, '')}x \\uc1 ${u(8364)}y\\par`)).toBe('<p>€ro €x €y</p>');
	});

	it("a \\'xx fallback after \\u is skipped like any other character", () => {
		expect(read(`${u(233, "\\'e9")} ok\\par`)).toBe('<p>é ok</p>');
	});

	it("\\'xx above 0x9F is the Latin-1 character", () => {
		expect(read(R`caf\'e9 \'b5m\par`)).toBe('<p>café µm</p>');
	});

	it.fails("NEW: \\'80 to \\'9f are Windows-1252, not C1 controls (the apostrophe TextEdit writes as \\'92)", () => {
		expect(read(R`It\'92s \'93quoted\'94 \'85 \'80 5\par`)).toBe('<p>It’s “quoted” … € 5</p>');
	});

	it.fails("#3.10: a \\' with no hex digits after it adds no NUL character", () => {
		expect(rtfToHtml("{\\rtf1\\ansi abc\\'")).not.toContain('\u0000');
		expect(rtfToHtml("{\\rtf1\\ansi abc\\'zz def\\par}")).not.toContain('\u0000');
	});

	it('escaped backslash and braces are text', () => {
		expect(read(R`a \\ b \{ c \}\par`)).toBe('<p>a \\ b { c }</p>');
	});

	it('named symbols: quotes, dashes, bullet, non-breaking space and hyphen', () => {
		expect(read(R`\lquote a\rquote  \ldblquote b\rdblquote  c\endash d\emdash e \bullet  f\~g h\_i\par`)).toBe(
			'<p>‘a’ “b” c–d—e • f g h‑i</p>'
		);
	});

	it.fails('NEW: a formatted character outside the BMP stays one character, in one element', () => {
		const html = rtfToHtml(htmlToRtf(el('<p><b>\u{1F600}</b></p>')));
		expect(html).toBe('<p><strong>\u{1F600}</strong></p>');
	});
});

describe('character formatting', () => {
	it('\\plain ends bold, italic, underline, strikethrough, size and color', () => {
		// 13 pt: a size of its own, but below the smallest heading.
		const html = rtfToHtml(R`{\rtf1\ansi{\colortbl;\red255\green0\blue0;}\b\i\ul\strike\fs26\cf1 a\plain b\par}`);
		const p = dom(html).querySelector('p')!;
		expect(p.textContent).toBe('ab');
		expect(p.querySelector('strong, em, u, s')!.textContent).toBe('a');
		expect(p.lastChild!.nodeType).toBe(Node.TEXT_NODE);
		expect(p.lastChild!.textContent).toBe('b');
	});

	it('formatting set inside a group ends with the group', () => {
		expect(read(R`{\b bold} plain\par`)).toBe('<p><strong>bold</strong> plain</p>');
	});

	it('\\b0, \\i0, \\ul0, \\ulnone and \\strike0 turn their format off', () => {
		expect(read(R`\b a\b0 b\i c\i0 d\ul e\ul0 f\ul g\ulnone h\strike i\strike0 j\par`)).toBe(
			'<p><strong>a</strong>b<em>c</em>d<u>e</u>f<u>g</u>h<s>i</s>j</p>'
		);
	});

	it.fails('#3.5: \\pard resets the paragraph, not the characters: bold carries on', () => {
		expect(read(R`\b bold\pard  still bold\par`)).toBe('<p><strong>bold</strong><strong> still bold</strong></p>');
	});

	it('super- and subscript, ended by \\nosupersub', () => {
		expect(read(R`x\super 2\nosupersub  H\sub 2\nosupersub O\par`)).toBe('<p>x<sup>2</sup> H<sub>2</sub>O</p>');
	});
});

describe('paragraphs', () => {
	it('\\par ends a paragraph and \\line breaks a line inside one', () => {
		expect(read(R`one\line two\par three\par`)).toBe('<p>one<br>two</p>\n<p>three</p>');
	});

	it('the last paragraph needs no \\par', () => {
		expect(read(R`one\par two`)).toBe('<p>one</p>\n<p>two</p>');
	});

	it.fails('NEW: \\sect ends the paragraph before a section break', () => {
		expect(read(R`A\sect B\par`)).toBe('<p>A</p>\n<p>B</p>');
	});

	it('alignment: \\qc, \\qr, \\qj', () => {
		expect(read(R`\pard\qc c\par\pard\qr r\par\pard\qj j\par\pard l\par`)).toBe(
			'<p style="text-align:center">c</p>\n<p style="text-align:right">r</p>\n<p style="text-align:justify">j</p>\n<p>l</p>'
		);
	});

	it('a \\row inside a group still ends the table for the indents', () => {
		const html = read(R`\pard\li720 A\par \trowd\cellx3000 \pard\intbl\li200 c1\cell {\row} After\par`);
		expect(html.endsWith('<p>After</p>')).toBe(true);
	});
});

describe('headings', () => {
	it('a bold paragraph set at twice the body size is an <h1>, at 1.5 an <h2>, at 7/6 an <h3>', () => {
		const html = read(R`\pard\b\fs48 One\b0\fs24\par\pard\b\fs36 Two\b0\fs24\par\pard\b\fs28 Three\b0\fs24\par\pard Body\par`);
		expect(Array.from(dom(html).children).map((c) => `${c.tagName}:${c.textContent}`)).toEqual(['H1:One', 'H2:Two', 'H3:Three', 'P:Body']);
	});

	it('a heading the writer sent comes back at the same level', () => {
		const html = rtfToHtml(htmlToRtf(el('<h1>One</h1><h2>Two</h2><h3>Three</h3><p>Body</p>')));
		expect(Array.from(dom(html).children).map((c) => `${c.tagName}:${c.textContent}`)).toEqual(['H1:One', 'H2:Two', 'H3:Three', 'P:Body']);
	});

	it.fails('#3.7: a heading the writer sent comes back with no size of its own inside it', () => {
		expect(rtfToHtml(htmlToRtf(el('<h1>One</h1>')))).not.toContain('font-size');
	});

	it.fails('#3.7: one large word does not make its paragraph a heading', () => {
		const html = read(R`normal text \fs48 BIG\fs24  more normal\par`);
		expect(html.startsWith('<p>')).toBe(true);
	});

	it.fails('#3.7: a heading with mixed formatting keeps no size span inside it', () => {
		const html = read(R`\pard\b\fs28 Title \i it\i0\b0\fs24\par`);
		expect(html.startsWith('<h3>')).toBe(true);
		expect(html).not.toContain('font-size');
	});
});

describe('lists, rules and links the writer sent', () => {
	it.fails('#3.6: a bullet list reads back as <ul>, a numbered one as <ol>', () => {
		const html = rtfToHtml(htmlToRtf(el('<ul><li>one</li><li>two</li></ul><ol><li>x</li></ol>')));
		const d = dom(html);
		expect(Array.from(d.querySelectorAll('ul > li')).map((li) => li.textContent)).toEqual(['one', 'two']);
		expect(Array.from(d.querySelectorAll('ol > li')).map((li) => li.textContent)).toEqual(['x']);
	});

	it('#3.6, the part that holds: a list item keeps its indents, so it does not drift on each save', () => {
		const first = htmlToRtf(el('<ul><li>one</li></ul>'));
		const second = htmlToRtf(el(rtfToHtml(first)));
		expect(first).toContain('\\li720\\fi-360');
		expect(second).toContain('\\li720\\fi-360');
		expect(htmlToRtf(el(rtfToHtml(second)))).toBe(second);
	});

	it.fails('#3.8: a rule reads back as <hr>', () => {
		expect(rtfToHtml(htmlToRtf(el('<p>a</p><hr><p>b</p>')))).toBe('<p>a</p>\n<hr>\n<p>b</p>');
	});

	it.fails('#3.4: a link reads back with its address', () => {
		const html = rtfToHtml(htmlToRtf(el('<p><a href="https://x.test/a">click</a></p>')));
		expect(dom(html).querySelector('a')?.getAttribute('href')).toBe('https://x.test/a');
	});

	it('a field that is not a web, mail or phone link never becomes a link', () => {
		const html = read(R`{\field{\*\fldinst HYPERLINK "javascript:alert(1)"}{\fldrslt click}}\par`);
		expect(dom(html).querySelector('a')).toBeNull();
		expect(html).toContain('click');
		expect(html).not.toContain('javascript:');
	});
});

describe('tables', () => {
	const cells = (html: string) =>
		Array.from(dom(html).querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => c.textContent));

	it('rows and cells, with column widths from \\cellx', () => {
		const html = read(R`\trowd\cellx2880\cellx8640 \intbl a\cell b\cell\row \trowd\cellx2880\cellx8640 \intbl c\cell d\cell\row`);
		expect(cells(html)).toEqual([['a', 'b'], ['c', 'd']]);
		const first = dom(html).querySelector('td') as HTMLElement;
		expect(first.style.width).toBe('33.3%');
	});

	it('a header row (a bottom border on its cells) reads as <th>', () => {
		const html = read(R`\trowd\clbrdrb\brdrs\cellx4320\clbrdrb\brdrs\cellx8640 \intbl H1\cell H2\cell\row \trowd\cellx4320\cellx8640 \intbl a\cell b\cell\row`);
		expect(dom(html).querySelectorAll('th').length).toBe(2);
		expect(dom(html).querySelectorAll('td').length).toBe(2);
	});

	it('a cell keeps its alignment', () => {
		const html = read(R`\trowd\cellx4320\cellx8640 \pard\intbl\qr 1.5\cell \pard\intbl\qc mid\cell\row`);
		const [a, b] = Array.from(dom(html).querySelectorAll<HTMLElement>('td'));
		expect([a.style.textAlign, b.style.textAlign]).toEqual(['right', 'center']);
	});

	it('text after the table is a paragraph again', () => {
		const html = read(R`\trowd\cellx8640 \intbl a\cell\row \pard after\par`);
		expect(html.endsWith('</table>\n<p>after</p>')).toBe(true);
	});

	it.fails('#3.9: \\intbl with no \\row does not swallow the paragraphs after it', () => {
		const html = read(R`\intbl x\par \pard after\par more\par`);
		expect(dom(html).querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
		expect(html).toContain('<p>more</p>');
	});

	it.fails('#3.10: a row that is started again does not keep the abandoned row\'s cell alignment', () => {
		const html = read(R`\trowd\cellx4320 \pard\intbl\qc lost\cell \trowd\cellx4320\cellx8640 \pard\intbl a\cell b\cell\row`);
		const first = dom(html).querySelector('td') as HTMLElement;
		expect(first.textContent).toBe('a');
		expect(first.style.textAlign).toBe('');
	});

	it.fails('#2: \\clvmgf and \\clvmrg read back as one cell with rowspan', () => {
		const html = read(R`\trowd\clvmgf\cellx2880\cellx5760 \intbl Group\cell a\cell\row \trowd\clvmrg\cellx2880\cellx5760 \intbl \cell c\cell\row`);
		const d = dom(html);
		expect(d.querySelector('td')!.getAttribute('rowspan')).toBe('2');
		expect(cells(html)).toEqual([['Group', 'a'], ['c']]);
	});

	it.fails('#2: a cell that spans two of the columns below it reads back with colspan', () => {
		const html = read(R`\trowd\cellx5760\cellx8640 \intbl wide\cell c\cell\row \trowd\cellx2880\cellx5760\cellx8640 \intbl a\cell b\cell c\cell\row`);
		expect(dom(html).querySelector('td')!.getAttribute('colspan')).toBe('2');
	});
});

describe('input that is damaged, hostile or not RTF', () => {
	it('an empty string, plain text and an unclosed group all return HTML without throwing', () => {
		expect(rtfToHtml('')).toBe('<p></p>');
		expect(rtfToHtml('not rtf at all')).toBe('<p>not rtf at all</p>');
		expect(rtfToHtml('{\\rtf1}')).toBe('<p></p>');
		expect(rtfToHtml('{\\rtf1 unclosed {\\b bold')).toBe('<p>unclosed <strong>bold</strong></p>');
	});

	it('a stray closing brace does not end the document early or throw', () => {
		expect(rtfToHtml('{\\rtf1 a} b}')).toContain('a');
	});

	it.fails('#3.10: deeply nested groups do not overflow the stack', () => {
		const depth = 30000;
		expect(() => rtfToHtml(`{\\rtf1 ${'{'.repeat(depth)}x${'}'.repeat(depth)}}`)).not.toThrow();
	});

	it.fails('#3.10: color components are kept within 0 to 255', () => {
		const html = rtfToHtml(R`{\rtf1\ansi{\colortbl;\red999\green-5\blue0;}\cf1 x\par}`);
		expect(html).toContain('color:rgb(255,0,0)');
	});

	it('a color index with no entry in the table is ignored', () => {
		expect(rtfToHtml(R`{\rtf1\ansi{\colortbl;\red255\green0\blue0;}\cf7 x\par}`)).toBe('<p>x</p>');
	});
});

describe('the HTML is safe to hand to {@html} (RtfViewer)', () => {
	const ALLOWED_TAGS = new Set([
		'P', 'BR', 'STRONG', 'EM', 'U', 'S', 'SUP', 'SUB', 'SPAN', 'H1', 'H2', 'H3', 'HR',
		'TABLE', 'TBODY', 'TR', 'TD', 'TH', 'FIGURE', 'FIGCAPTION', 'IMG'
	]);
	const ALLOWED_ATTRIBUTES = new Set(['style', 'src', 'alt']);

	const hostile = [
		R`{\rtf1\ansi <script>alert(1)</script>\par}`,
		R`{\rtf1\ansi <img src=x onerror=alert(1)>\par}`,
		R`{\rtf1\ansi \'3cscript\'3ealert(1)\'3c/script\'3e\par}`,
		`{\\rtf1\\ansi ${u(60)}img src=x onerror=alert(1)${u(62)}\\par}`,
		R`{\rtf1\ansi{\fonttbl{\f0 "><img src=x onerror=alert(1)>;}}\f0 text\par}`,
		R`{\rtf1\ansi{\colortbl;\red1\green2\blue3" onmouseover="alert(1);}\cf1 text\par}`,
		R`{\rtf1\ansi " onmouseover="alert(1)" style="x\par}`,
		R`{\rtf1\ansi {\field{\*\fldinst HYPERLINK "javascript:alert(1)"}{\fldrslt click}}\par}`,
		R`{\rtf1\ansi {\pict\pngblip\picw1\pich1 "><script>alert(1)</script>}\par}`,
		R`{\rtf1\ansi \trowd\cellx100 \intbl <b onclick=alert(1)>x</b>\cell\row}`,
		R`{\rtf1\ansi &lt;script&gt; &amp;#60;script&amp;#62;\par}`
	];

	for (const rtf of hostile) {
		it(`only known elements and attributes come out of ${rtf.slice(0, 60)}`, () => {
			const html = rtfToHtml(rtf);
			for (const node of Array.from(dom(html).querySelectorAll('*'))) {
				expect(ALLOWED_TAGS.has(node.tagName), `<${node.tagName}> in ${html}`).toBe(true);
				for (const attr of Array.from(node.attributes)) {
					expect(ALLOWED_ATTRIBUTES.has(attr.name), `${attr.name} in ${html}`).toBe(true);
					expect(attr.value).not.toMatch(/javascript:|expression\(|url\(/i);
				}
				if (node.tagName === 'IMG') {
					expect(node.getAttribute('src')).toMatch(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/);
				}
			}
		});
	}

	it('text that looks like markup is escaped, and an entity in the text stays text', () => {
		expect(rtfToHtml(R`{\rtf1\ansi <b>x</b> &amp; "q"\par}`)).toBe('<p>&lt;b&gt;x&lt;/b&gt; &amp;amp; "q"</p>');
	});
});
