import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { tableModel, columnShares } from '../table-model.js';

/**
 * What htmlToRtf makes of HTML the editor's own buttons never produce but a paste does: Google
 * Docs' formatting written as styles, a web page's <section> and <dl>, hidden elements, a
 * table's caption, a figure with text typed in it, control characters. The rule is the one the
 * rest of the writer follows: the RTF says what the screen shows, no more (hidden text, a
 * stylesheet) and no less (a caption, a line break, bold set by a style). Found by pasting from
 * real programs and by reading the RTF with Apple's reader (issue 21). Invented text.
 */

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** The RTF after the header, without the closing brace. */
const body = (html: string | HTMLElement) => {
	const rtf = htmlToRtf(typeof html === 'string' ? el(html) : html);
	return rtf.slice(rtf.indexOf('\\pard\\f0\\fs24 ') + '\\pard\\f0\\fs24 '.length, -1);
};
const back = (html: string) => rtfToHtml(htmlToRtf(el(html)));
/** A one-pixel PNG. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_HEX = '89504E470D0A1A0A';
const img = (attrs = '') => `<img src="data:image/png;base64,${PNG}"${attrs}>`;
const pict = (rtf: string) => rtf.replace(/\{\\pict[^}]*\}/g, '[pict]');
const cellRtf = (text: string, align = '') => `{\\pard\\intbl${align} \\f0 \\sa0 \\li0 \\fi0 ${text}\\cell}`;

describe('formatting set by a style (issue 21, items 3 and 4)', () => {
	it('a Google Docs paste is not bold: its wrapper is <b style="font-weight:normal">', () => {
		expect(body('<b style="font-weight:normal" id="docs-internal-guid-1"><p>plain</p><p>text</p></b>')).toBe('\\pard plain\\par \\pard text\\par ');
	});

	it('bold, italic, underline and strikethrough on a <span> are written', () => {
		expect(body('<p><span style="font-weight:700">bold</span> <span style="font-weight:bold">b</span> <span style="font-style:italic">it</span></p>')).toBe(
			'\\pard \\b bold\\b0  \\b b\\b0  \\i it\\i0 \\par '
		);
		expect(body('<p><span style="text-decoration:underline">u</span> <span style="text-decoration:line-through">s</span> <span style="text-decoration: underline line-through">both</span></p>')).toBe(
			'\\pard \\ul u\\ulnone  \\strike s\\strike0  \\ul \\strike both\\strike0 \\ulnone \\par '
		);
	});

	it('superscript and subscript on a <span> are written: 10 to the third is not 103', () => {
		expect(body('<p>10<span style="vertical-align:super">3</span>/mm, H<span style="vertical-align:sub">2</span>O</p>')).toBe(
			'\\pard 10\\super 3\\nosupersub /mm, H\\sub 2\\nosupersub O\\par '
		);
		expect(back('<p>10<span style="vertical-align:super">3</span></p>')).toBe('<p>10<sup>3</sup></p>');
	});

	it('a weight of 600 and up is bold; 400 and 500 are not', () => {
		const weight = (w: string) => body(`<p><span style="font-weight:${w}">x</span></p>`);
		expect([weight('600'), weight('900'), weight('bolder')]).toEqual(['\\pard \\b x\\b0 \\par ', '\\pard \\b x\\b0 \\par ', '\\pard \\b x\\b0 \\par ']);
		expect([weight('400'), weight('500'), weight('normal'), weight('lighter')]).toEqual(['\\pard x\\par ', '\\pard x\\par ', '\\pard x\\par ', '\\pard x\\par ']);
	});

	it('a style can take the formatting off again, and what was in force comes back after', () => {
		expect(body('<p><b>bold <span style="font-weight:normal">plain</span> bold</b></p>')).toBe('\\pard \\b bold \\b0 plain\\b  bold\\b0 \\par ');
		expect(body('<p><i>it <span style="font-style:normal">up</span> it</i></p>')).toBe('\\pard \\i it \\i0 up\\i  it\\i0 \\par ');
		expect(body('<p><sup>up <span style="vertical-align:baseline">level</span></sup></p>')).toBe('\\pard \\super up \\nosupersub level\\super \\nosupersub \\par ');
		// In a heading, which is bold: Docs writes its headings with a weight of 400 inside.
		expect(body('<h2><span style="font-weight:400">Head</span></h2>')).toBe('\\pard\\f0\\fs36\\b \\b0 Head\\b \\b0\\fs24\\par ');
	});

	it('a tag whose own style says otherwise follows the style', () => {
		expect(body('<p><i style="font-style:normal">a</i><u style="text-decoration:none">b</u><s style="text-decoration:none">c</s><sup style="vertical-align:baseline">d</sup></p>')).toBe(
			'\\pard abcd\\par '
		);
	});

	it('a line under text cannot be taken off by a span inside it, as on screen', () => {
		expect(body('<p><u>under <span style="text-decoration:none">still under</span></u></p>')).toBe('\\pard \\ul under still under\\ulnone \\par ');
	});

	it('what is already in force is not written twice', () => {
		expect(body('<p><b>a<span style="font-weight:bold">b</span><strong>c</strong></b></p>')).toBe('\\pard \\b abc\\b0 \\par ');
	});

	it('several on one element are written together and taken off in reverse', () => {
		expect(body('<p><span style="color:red;font-size:18pt;font-weight:bold;font-style:italic">x</span></p>')).toBe(
			'\\pard \\cf2 \\fs36 \\b \\i x\\i0 \\b0 \\fs24 \\cf0 \\par '
		);
	});

	it('<ins> is underlined, and <cite>, <var> and <dfn> are italic, as a browser shows them', () => {
		expect(body('<p><ins>new</ins> <cite>title</cite> <var>n</var> <dfn>term</dfn></p>')).toBe(
			'\\pard \\ul new\\ulnone  \\i title\\i0  \\i n\\i0  \\i term\\i0 \\par '
		);
	});

	it('a link and code take a style as well', () => {
		expect(body('<p><code style="font-weight:bold">x</code></p>')).toBe('\\pard \\b \\f1 x\\f0 \\b0 \\par ');
		expect(body('<p><a href="https://x.test/" style="font-weight:bold">x</a></p>')).toContain('\\b {\\field{\\*\\fldinst HYPERLINK "https://x.test/"}{\\fldrslt\\ul\\cf1 x\\cf0\\ulnone }}\\b0 ');
	});

	it('a block\'s own style is its text\'s: a bold paragraph, an italic list item', () => {
		expect(body('<p style="font-weight:bold">all bold</p>')).toBe('\\pard \\b all bold\\b0 \\par ');
		expect(body('<ul><li style="font-style:italic">item</li></ul>')).toBe('\\i \\pard\\li720\\fi-360\\bullet\\tab item\\par \\i0 ');
	});

	it('a real Docs paragraph: its styles on spans inside the wrapper', () => {
		const docs =
			'<b style="font-weight:normal;" id="docs-internal-guid-2">' +
			'<p dir="ltr" style="line-height:1.38;"><span style="font-size:12pt;font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;">Margins are </span>' +
			'<span style="font-size:12pt;font-weight:700;font-style:normal;text-decoration:none;vertical-align:baseline;">negative</span>' +
			'<span style="font-size:12pt;font-weight:400;font-style:italic;text-decoration:underline;vertical-align:baseline;"> (see note)</span></p></b>';
		expect(back(docs)).toBe('<p>Margins are <strong>negative</strong><u><em> (see note)</em></u></p>');
	});
});

describe('color on a heading, a list item and a table cell (issue 21, item 24)', () => {
	it('is written, and ends with the block', () => {
		expect(body('<h2 style="color:red">Head</h2><p>after</p>')).toBe('\\pard\\f0\\fs36\\b \\cf2 Head\\cf0 \\b0\\fs24\\par \\pard after\\par ');
		expect(body('<ul><li style="color:red">item</li><li>plain</li></ul>')).toBe(
			'\\cf2 \\pard\\li720\\fi-360\\bullet\\tab item\\par \\cf0 \\pard\\li720\\fi-360\\bullet\\tab plain\\par '
		);
		expect(body('<table><tr><td style="color:red">cell</td><td>x</td></tr></table>')).toContain(`{${cellRtf('\\cf2 cell')}${cellRtf('x')}}`);
	});

	it('comes back as the color of that text', () => {
		expect(back('<ul><li style="color:red">item</li></ul>')).toBe('<ul><li><span style="color:rgb(255,0,0)">item</span></li></ul>');
		expect(back('<h2 style="color:red">Head</h2>')).toBe('<h2><span style="color:rgb(255,0,0)">Head</span></h2>');
	});
});

describe('what the screen does not show is not written (issue 21, item 6)', () => {
	it('a hidden element: display:none, the hidden attribute, visibility:hidden, Word\'s mso-hide', () => {
		expect(body('<p>shown <span style="display:none">reviewer note</span><span hidden>x</span><span style="visibility:hidden">y</span><span style="mso-hide:all">z</span>end</p>')).toBe(
			'\\pard shown end\\par '
		);
		expect(body('<p>a</p><p hidden>gone</p><div style="display:none"><p>gone</p></div><p>b</p>')).toBe('\\pard a\\par \\pard b\\par ');
	});

	it('a stylesheet, a script and a template are not text', () => {
		expect(body('<style>p { color: red }</style><p>text</p><script>alert(1)</script><template><p>never</p></template>')).toBe('\\pard text\\par ');
	});

	it('a hidden element between loose text and a block does not start a line of its own', () => {
		expect(body('<p>a</p><style>x{}</style>loose<span hidden>h</span><p>b</p>')).toBe('\\pard a\\par loose\\par \\pard b\\par ');
	});

	it('a hidden list item, table cell and table caption', () => {
		expect(body('<ul><li>x</li><li hidden>gone</li><li>y</li></ul>')).toBe('\\pard\\li720\\fi-360\\bullet\\tab x\\par \\pard\\li720\\fi-360\\bullet\\tab y\\par ');
		const table = body('<table><caption hidden>gone</caption><tr><td>a</td><td style="display:none">gone</td></tr><tr hidden><td>gone</td><td>gone</td></tr></table>');
		expect(table).not.toContain('gone');
		expect(table).toContain(`{${cellRtf('a')}${cellRtf('')}}`);
	});
});

describe('a table\'s caption (issue 21, item 8)', () => {
	it('is a centered paragraph before the table, as a browser shows it', () => {
		const rtf = body('<table><caption>Table 1. <b>Results</b></caption><tr><td>a</td></tr></table>');
		expect(rtf).toBe(`\\pard\\qc Table 1. \\b Results\\b0 \\par {\\trowd\\trgaph120\\cellx8640\\trkeep\\intbl{${cellRtf('a')}}\\intbl\\lastrow\\row}`);
	});

	it('keeps an alignment of its own, and the indent of what the table is in', () => {
		expect(body('<table><caption style="text-align:left">left</caption><tr><td>a</td></tr></table>')).toContain('\\pard left\\par {\\trowd');
		expect(body('<blockquote style="border-left-style:none;margin-left:1in"><table><caption>c</caption><tr><td>a</td></tr></table></blockquote>')).toContain('\\pard\\qc\\li1440 c\\par {\\trowd');
	});

	it('of a table inside a cell is a line in that cell', () => {
		expect(body('<table><tr><td><table><caption>inner</caption><tr><td>a</td><td>b</td></tr></table></td></tr></table>')).toContain(
			'\\fi0 \\pard\\intbl\\qc inner\\par \\pard\\intbl a\\tab b\\cell}'
		);
	});

	it('text a script put in a table outside any cell is written before the table, not dropped', () => {
		const root = el('<table><tbody><tr><td>a</td></tr></tbody></table>');
		root.querySelector('table')!.insertBefore(document.createTextNode('stray text'), root.querySelector('tbody'));
		root.querySelector('tr')!.appendChild(document.createElement('span')).textContent = 'in the row';
		const rtf = body(root);
		expect(rtf).toContain('\\pard stray text');
		expect(rtf).toContain('in the row');
		expect(rtf.indexOf('in the row')).toBeLessThan(rtf.indexOf('\\trowd'));
		expect(estimateRtfBytes(root)).toBeGreaterThanOrEqual(htmlToRtf(root).length);
	});

	it('the size estimate counts the paragraph such text is written as, table after table', () => {
		const root = el('<table><tbody><tr><td>a</td></tr></tbody></table>'.repeat(40));
		for (const table of Array.from(root.querySelectorAll('table'))) table.insertBefore(document.createTextNode('x'), table.firstChild);
		expect(estimateRtfBytes(root)).toBeGreaterThanOrEqual(htmlToRtf(root).length);
	});

	it('reads back as a paragraph and a table, and is saved the same again', () => {
		const html = back('<table><caption>Table 1</caption><tr><td>a</td></tr></table>');
		expect(html.startsWith('<p style="text-align:center">Table 1</p>\n<table')).toBe(true);
		expect(htmlToRtf(el(html))).toBe(htmlToRtf(el('<table><caption>Table 1</caption><tr><td>a</td></tr></table>')));
	});
});

describe('a figure with more than its picture (issue 21, items 9 and 10)', () => {
	it('text typed beside the picture is kept, with the picture and the caption', () => {
		const rtf = pict(body(`<figure>typed before ${img()} typed after<figcaption>Caption</figcaption></figure>`));
		expect(rtf).toBe('\\pard\\ql typed before [pict] typed after\\par {\\*\\inkcap}\\pard\\ql\\i Caption\\i0\\par ');
	});

	it('every picture in a figure is written', () => {
		const rtf = body(`<figure style="text-align:center">${img()}${img()}<figcaption>Two views</figcaption></figure>`);
		expect(rtf.match(/\\pict/g)?.length).toBe(2);
		expect(pict(rtf)).toBe('\\pard\\qc [pict][pict]\\par {\\*\\inkcap}\\pard\\qc\\i Two views\\i0\\par ');
	});

	it('the editor\'s own figure, one picture and its caption, is written as it always was', () => {
		expect(pict(body(`<figure>${img()}<figcaption>Caption</figcaption></figure>`))).toBe('\\pard\\ql [pict]\\par {\\*\\inkcap}\\pard\\ql\\i Caption\\i0\\par ');
		// White space and a wrapper around the picture are not "more".
		expect(pict(body(`<figure>\n  <a href="https://x.test/">${img()}</a>\n  <figcaption>Caption</figcaption>\n</figure>`))).toBe(
			'\\pard\\ql [pict]\\par {\\*\\inkcap}\\pard\\ql\\i Caption\\i0\\par '
		);
	});

	it('reads back with every word and both pictures', () => {
		const html = back(`<figure>before ${img()}${img()} after<figcaption>Cap</figcaption></figure>`);
		expect(html.match(/<img /g)?.length).toBe(2);
		expect(el(html).textContent).toBe('before  after\nCap');
	});
});

describe('a picture that cannot be embedded (issue 21, item 22)', () => {
	it('with no description is not written as its data', () => {
		const gif = 'R0lGODlhAQABAAAAACw=';
		const rtf = body(`<p><img src="data:image/gif;base64,${gif}"></p>`);
		expect(rtf).toBe('\\pard \\i [Image: image]\\i0 \\par ');
		expect(rtf).not.toContain(gif);
	});

	it('is written as its description, or as its address where that is one', () => {
		expect(body('<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Gross photo"></p>')).toBe('\\pard \\i [Image: Gross photo]\\i0 \\par ');
		expect(body('<p><img src="https://x.test/a.png"></p>')).toBe('\\pard \\i [Image: https://x.test/a.png]\\i0 \\par ');
	});

	it('picture data with a parameter before ";base64" is a picture', () => {
		expect(body(`<p><img src="data:image/png;name=scan.png;base64,${PNG}"></p>`)).toContain(`\\pngblip\\picw1\\pich1\\picwgoal15\\pichgoal15 ${PNG_HEX}`);
	});
});

describe('control characters (issue 21, item 23)', () => {
	it('never reach the RTF: the bytes that frame an HL7 message are among them', () => {
		const root = el('<p></p>');
		root.querySelector('p')!.textContent = 'a\x0bb\x1cc\x00d\x7fe\x0cf\x1bg';
		const rtf = htmlToRtf(root);
		expect(body(root)).toBe('\\pard a bcde fg\\par ');
		// eslint-disable-next-line no-control-regex
		expect(/[\x00-\x08\x0b-\x1f\x7f]/.test(rtf)).toBe(false);
	});

	it('in a picture\'s description and in a code block too', () => {
		const root = el('<p><img src="https://x.test/a.png"></p><pre></pre>');
		root.querySelector('img')!.setAttribute('alt', 'gross\x1c photo');
		root.querySelector('pre')!.textContent = 'line\x0b one\nline\x1c two';
		// eslint-disable-next-line no-control-regex
		expect(/[\x00-\x08\x0b-\x1f\x7f]/.test(htmlToRtf(root))).toBe(false);
		expect(body(root)).toContain('[Image: gross photo]');
		expect(body(root)).toContain('line  one\\line line two');
	});

	it('the estimate counts what is written', () => {
		const root = el('<p></p>');
		root.querySelector('p')!.textContent = 'a\x0bb\x1cc'.repeat(50);
		expect(estimateRtfBytes(root)).toBeGreaterThanOrEqual(htmlToRtf(root).length);
	});
});

describe('blocks a pasted page is made of (issue 21, item 14)', () => {
	it('a definition list: each term and each description is a line', () => {
		expect(body('<dl><dt>Specimen</dt><dd>Colon</dd><dt>Margins</dt><dd>Negative</dd></dl>')).toBe(
			'\\pard Specimen\\par \\pard Colon\\par \\pard Margins\\par \\pard Negative\\par '
		);
	});

	it('<section>, <article>, <address>, <header>, <footer>, <main>, <aside>, <nav>, <details> and <summary> each end their line', () => {
		const tags = ['section', 'article', 'address', 'header', 'footer', 'main', 'aside', 'nav', 'fieldset', 'form'];
		for (const tag of tags) {
			expect(body(`<${tag}>one</${tag}><${tag}>two</${tag}>`), tag).toBe('\\pard one\\par \\pard two\\par ');
		}
		expect(body('<details open><summary>Summary</summary>Body text</details>')).toBe('\\pard Summary\\par Body text\\par ');
	});

	it('holding paragraphs, such a block adds no line of its own', () => {
		expect(body('<section><p>a</p><p>b</p></section><p>c</p>')).toBe('\\pard a\\par \\pard b\\par \\pard c\\par ');
	});

	it('text before one ends its line first, and text after one starts its own', () => {
		expect(body('lead<section>one</section>tail')).toBe('lead\\par \\pard one\\par tail');
	});

	it('in a table cell they stay in the cell', () => {
		expect(body('<table><tr><td><section>one</section><section>two</section></td></tr></table>')).toContain('\\fi0 one\\par \\pard\\intbl two\\cell}');
	});

	it('reads back as its lines, every word apart', () => {
		expect(back('<dl><dt>Specimen</dt><dd>Colon</dd></dl><section>one</section>')).toBe('<p>Specimen</p>\n<p>Colon</p>\n<p>one</p>');
	});
});

describe('alignment handed down by a block around others (issue 21, item 24)', () => {
	it('a <div> that centers the paragraphs in it: each is centered, and one with its own keeps its own', () => {
		const rtf = body('<div style="text-align:center"><p>one</p><h2>head</h2><pre>code</pre><p style="text-align:right">r</p><p style="text-align:left">l</p></div><p>after</p>');
		expect(rtf).toBe(
			'\\pard\\qc one\\par \\pard\\qc\\f0\\fs36\\b head\\b0\\fs24\\par \\pard\\qc\\f1\\fs20 code\\f0\\fs24\\par \\pard\\qr r\\par \\pard\\ql l\\par \\pard after\\par '
		);
	});

	it('<center> and align="center" do the same', () => {
		expect(body('<center><p>one</p><p>two</p></center>')).toBe('\\pard\\qc one\\par \\pard\\qc two\\par ');
		expect(body('<center>loose</center>')).toBe('\\pard\\qc loose\\par ');
		expect(body('<div align="right"><p>one</p></div>')).toBe('\\pard\\qr one\\par ');
	});

	it('it reaches through a block that sets none, and a block set left stops it', () => {
		expect(body('<div style="text-align:center"><div><p>in</p></div><div style="text-align:left"><p>out</p></div></div>')).toBe('\\pard\\qc in\\par \\pard out\\par ');
	});

	it('loose text in the block, and the cells of a table in it, take it too', () => {
		expect(body('<div style="text-align:center">loose<p>p</p>tail</div>')).toBe('\\pard\\qc loose\\par \\pard\\qc p\\par \\pard\\qc tail\\par ');
		expect(body('<div style="text-align:right"><table><tr><td>1.0</td></tr></table></div>')).toContain(cellRtf('1.0', '\\qr'));
	});

	it('a list in it stays left-aligned, so that it is still read back as a list', () => {
		const html = '<div style="text-align:center"><p>title</p><ul><li>item</li></ul></div>';
		expect(body(html)).toBe('\\pard\\qc title\\par \\pard\\li720\\fi-360\\bullet\\tab item\\par ');
		expect(back(html)).toBe('<p style="text-align:center">title</p>\n<ul><li>item</li></ul>');
	});

	it('the paragraph after the block is not centered', () => {
		expect(back('<div style="text-align:center"><p>one</p><p>two</p></div><p>after</p>')).toBe(
			'<p style="text-align:center">one</p>\n<p style="text-align:center">two</p>\n<p>after</p>'
		);
	});
});

describe('line breaks kept by white-space (issue 21, item 24)', () => {
	it('in pre-wrap, pre-line and pre text a new line is a line break', () => {
		for (const ws of ['pre-wrap', 'pre-line', 'pre', 'break-spaces']) {
			expect(body(`<p style="white-space:${ws}">line one\nline two\r\nline three</p>`), ws).toBe('\\pard line one\\line line two\\line line three\\par ');
		}
	});

	it('anywhere else it is the space a browser shows', () => {
		expect(body('<p>line one\nline two</p>')).toBe('\\pard line one line two\\par ');
		expect(body('<p style="white-space:normal">line one\nline two</p>')).toBe('\\pard line one line two\\par ');
	});

	it('the estimate counts each of them', () => {
		const root = el(`<div style="white-space:pre-wrap">${'x\n'.repeat(200)}</div>`);
		expect(estimateRtfBytes(root)).toBeGreaterThanOrEqual(htmlToRtf(root).length);
	});
});

describe('tables: where a table ends and what follows it (issue 21, items 17, 20 and 21)', () => {
	it('only the last row of a table says it is the last', () => {
		const rtf = body('<table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>');
		expect(rtf.split('\\trowd').slice(1).map((row) => row.includes('\\lastrow'))).toEqual([false, false, true]);
		expect(rtf.endsWith('\\intbl\\lastrow\\row}')).toBe(true);
	});

	it('a cell ends with \\cell inside its group and no \\par, and a cell merged from above is empty', () => {
		const rtf = body('<table><tr><td rowspan="2">G</td><td>a</td></tr><tr><td>b</td></tr></table>');
		expect(rtf).not.toMatch(/\\par(?![a-z])/);
		expect(rtf).toContain(`{${cellRtf('G')}${cellRtf('a')}}`);
		expect(rtf).toContain(`{${cellRtf('')}${cellRtf('b')}}`);
	});

	it('loose text after a table starts a plain paragraph, not one shaped like the paragraph before the table', () => {
		const rtf = body('<p style="text-align:center;margin-left:1in">centered</p><table><tr><td>a</td></tr></table>loose');
		expect(rtf.endsWith('\\row}\\pard loose')).toBe(true);
		expect(back('<p style="text-align:center;margin-left:1in">centered</p><table><tr><td>a</td></tr></table>loose').endsWith('</table>\n<p>loose</p>')).toBe(true);
	});

	it('loose text after a block that only holds blocks does not take the last of them\'s alignment', () => {
		expect(body('<div><p style="text-align:center">c</p></div>tail')).toBe('\\pard\\qc c\\par \\pard tail');
	});

	it('inside an indented block, that loose text keeps the block\'s indent', () => {
		expect(body('<blockquote style="border-left-style:none;margin-left:1in"><table><tr><td>a</td></tr></table>loose</blockquote>').endsWith('\\row}\\pard\\li1440 loose\\par ')).toBe(true);
	});
});

describe('column widths given as lengths (issue 21, item 24)', () => {
	const shares = (html: string) => {
		const table = el(html).querySelector('table')!;
		return columnShares(tableModel(table), table).map((s) => Math.round(s * 1000) / 1000);
	};
	const edges = (html: string) => Array.from(body(html).split('\\trkeep')[0].matchAll(/\\cellx(\d+)/g)).map((m) => Number(m[1]));

	it('pixels, points and the bare width attribute: the columns in proportion', () => {
		expect(shares('<table><tr><td style="width:60px">a</td><td style="width:180px">b</td></tr></table>')).toEqual([0.25, 0.75]);
		expect(shares('<table><tr><td style="width:36pt">a</td><td style="width:1in">b</td></tr></table>')).toEqual([0.333, 0.667]);
		expect(shares('<table><tr><td width="100">a</td><td width="300">b</td></tr></table>')).toEqual([0.25, 0.75]);
		expect(edges('<table><tr><td style="width:60px">a</td><td style="width:180px">b</td></tr></table>')).toEqual([2160, 8640]);
	});

	it('<col> and <colgroup> give a column its width, and span counts', () => {
		expect(shares('<table><colgroup><col width="100"><col width="300"></colgroup><tr><td>a</td><td>b</td></tr></table>')).toEqual([0.25, 0.75]);
		expect(shares('<table><colgroup><col style="width:50%"><col span="2" style="width:25%"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>')).toEqual([0.5, 0.25, 0.25]);
		expect(shares('<table><colgroup span="2" width="100"></colgroup><colgroup><col width="200"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>')).toEqual([0.25, 0.25, 0.5]);
		// A <col> with no width of its own has its group's.
		expect(shares('<table><colgroup width="100"><col><col></colgroup><colgroup><col width="200"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>')).toEqual([0.25, 0.25, 0.5]);
	});

	it('a cell\'s own width comes before its column\'s', () => {
		expect(shares('<table><colgroup><col width="100"><col width="100"></colgroup><tr><td style="width:300px">a</td><td>b</td></tr></table>')).toEqual([0.75, 0.25]);
	});

	it('a <col> a script put straight in the table counts as well', () => {
		const table = el('<table><tr><td>a</td><td>b</td></tr></table>').querySelector('table')!;
		for (const width of ['100', '300']) {
			const col = document.createElement('col');
			col.setAttribute('width', width);
			table.insertBefore(col, table.firstChild);
		}
		expect(columnShares(tableModel(table), table)).toEqual([0.75, 0.25]);
	});

	it('a column with no width is as wide as the average of those that have one', () => {
		// 100, the average of 100 and 300, and 300: a sixth, a third and a half.
		expect(shares('<table><tr><td style="width:100px">a</td><td>b</td><td style="width:300px">c</td></tr></table>')).toEqual([0.167, 0.333, 0.5]);
	});

	it('against a table width that is a length, lengths and percentages are measured together', () => {
		expect(shares('<table style="width:400px"><tr><td style="width:100px">a</td><td style="width:25%">b</td><td>c</td></tr></table>')).toEqual([0.25, 0.25, 0.5]);
	});

	it('with percentages and no table width, a length cannot be compared and is left out, as before', () => {
		expect(shares('<table><tr><td style="width:25%">a</td><td style="width:300px">b</td></tr></table>')).toEqual([0.25, 0.75]);
		expect(shares('<table><tr><td style="width:25%">a</td><td>b</td></tr></table>')).toEqual([0.25, 0.75]);
	});

	it('percent widths, which is what the reader writes, are unchanged', () => {
		expect(shares('<table><tr><td style="width:33.33%">a</td><td style="width:33.34%">b</td><td style="width:33.33%">c</td></tr></table>')).toEqual([0.333, 0.333, 0.333]);
	});
});

describe('found by a second reader of this change', () => {
	it('text typed before a pasted wrapper is not run into the wrapper\'s first paragraph', () => {
		expect(body('Diagnosis:<b style="font-weight:normal" id="docs-internal-guid-1"><p>Benign nevus</p><p>Margins clear</p></b>')).toBe(
			'Diagnosis:\\par \\pard Benign nevus\\par \\pard Margins clear\\par '
		);
		expect(back('Diagnosis:<b style="font-weight:normal"><p>Benign nevus</p></b>')).toBe('<p>Diagnosis:</p>\n<p>Benign nevus</p>');
		expect(body('Findings:<span><ul><li>benign</li></ul></span>')).toBe('Findings:\\par \\pard\\li720\\fi-360\\bullet\\tab benign\\par ');
		expect(back('Findings:<span><ul><li>benign</li></ul></span>')).toBe('<p>Findings:</p>\n<ul><li>benign</li></ul>');
		expect(body('<div>Diagnosis:<span><div>Benign</div></span>Comment</div>')).toBe('\\pard Diagnosis:\\par \\pard Benign\\par Comment\\par ');
		// A wrapper that is itself the first thing in its block follows nothing.
		expect(body('<b style="font-weight:normal"><p>first</p></b>')).toBe('\\pard first\\par ');
		expect(body('<p>before</p><span><p>first</p></span>')).toBe('\\pard before\\par \\pard first\\par ');
	});

	it('what is hidden in a figure is not written: a caption, part of a caption, a picture', () => {
		expect(pict(body(`<figure>${img()}<figcaption hidden>SECRET</figcaption></figure>`))).toBe('\\pard\\ql [pict]\\par ');
		expect(pict(body(`<figure>${img()}<figcaption>Fig 1<span style="display:none">SECRET</span></figcaption></figure>`))).toBe(
			'\\pard\\ql [pict]\\par {\\*\\inkcap}\\pard\\ql\\i Fig 1\\i0\\par '
		);
		expect(body(`<figure><div hidden>${img()}</div><figcaption>Only a caption</figcaption></figure>`)).toBe('{\\*\\inkcap}\\pard\\ql\\i Only a caption\\i0\\par ');
	});

	it('the space between two words stays when a hidden block stands between them', () => {
		expect(body('<b>Margins:</b> <div hidden>x</div><b>negative</b>')).toBe('\\b Margins:\\b0  \\b negative\\b0 ');
	});

	it('text shown again inside a visibility:hidden element is written, and only that', () => {
		expect(body('<div style="visibility:hidden">h<span style="visibility:visible">VISIBLE</span> h2</div><p style="visibility:hidden">gone</p>')).toBe('\\pard VISIBLE\\par ');
	});

	it('a <br> before a hidden element at the end of a paragraph adds no empty line, and an empty element in a table no paragraph', () => {
		expect(body('<p>text<br><span hidden>x</span></p>')).toBe('\\pard text\\par ');
		const root = el('<table><tbody><tr><td>a</td></tr></tbody></table>');
		root.querySelector('table')!.insertBefore(document.createElement('form'), root.querySelector('tbody'));
		expect(body(root).startsWith('{\\trowd')).toBe(true);
	});

	it('four thousand comments in a row do not take seconds to write', () => {
		const root = el(`<p>a</p>${' <!--x-->'.repeat(4000)}b`);
		const start = performance.now();
		const rtf = htmlToRtf(root);
		expect(performance.now() - start).toBeLessThan(2000);
		expect(rtf).toContain('\\pard a\\par ');
	});

	const sizes: Record<string, string> = {
		'a picture given by its address, straight in the editor': '<img src="https://x.test/i.png" alt="">',
		'the same after loose text': 'Scan: <img src="https://x.test/i.png" alt="">',
		'an indented figure whose picture is given by its address': '<figure style="margin-left:40px"><img src="https://x.test/a.png" alt="a"><figcaption>c</figcaption></figure>',
		'two such figures in a quotation': `<blockquote>${'<figure><img src="https://x.test/a.png" alt="a"><figcaption>c</figcaption></figure>'.repeat(2)}</blockquote>`,
		'picture data that is not base64, with a long description': `<p><img src="data:image/svg+xml,%3Csvg/%3E" alt="${'a'.repeat(147)}"></p>`,
		'a small GIF with a long description': `<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" alt="${'a'.repeat(300)}"></p>`,
		'a <font> that names two colors': '<p><font color="blue" style="color:rgb(255,254,253)">a</font></p>',
		'line breaks of the source in one node after another': '<p><span>a\n</span>\n<span>\n</span>\n<span>\n</span>\n<span>\nb</span></p>'
	};
	for (const [name, html] of Object.entries(sizes)) {
		it(`the size estimate is not below the real size for ${name}`, () => {
			const root = el(html);
			expect(estimateRtfBytes(root)).toBeGreaterThanOrEqual(htmlToRtf(root).length);
		});
	}

	it('nor for very large sizes on a very large body size', () => {
		const root = el(`<p>${'<span style="font-size:300pt">x</span>'.repeat(5)}</p>`);
		expect(estimateRtfBytes(root, { fontSize: 1000 })).toBeGreaterThanOrEqual(htmlToRtf(root, { fontSize: 1000 }).length);
	});
});

describe('the size estimate (issue 21)', () => {
	const sizes = (html: string, options = {}) => {
		const root = el(html);
		return { estimate: estimateRtfBytes(root, options), actual: htmlToRtf(root, options).length };
	};
	const cases: Record<string, string> = {
		'fifty paragraphs in a quotation with no margin of its own': `<blockquote>${'<p>x</p>'.repeat(50)}</blockquote>`,
		'a quotation inside a quotation': `<blockquote><blockquote>${'<p>x</p>'.repeat(50)}</blockquote></blockquote>`,
		'lists two levels deep': `<ul>${'<li>a<ul><li>b</li><li>c</li></ul></li>'.repeat(40)}</ul>`,
		'sixty items six levels deep': `${'<ul><li>x'.repeat(6)}${'<li>y</li>'.repeat(60)}${'</li></ul>'.repeat(6)}`,
		'a list twenty levels deep': `${'<ul><li>x'.repeat(20)}${'</li></ul>'.repeat(20)}`,
		'list items that start with a heading': `<ul>${'<li><h2>head</h2>text</li>'.repeat(30)}</ul>`,
		'list items that hold a code block': `<ul>${'<li><pre>code</pre></li>'.repeat(30)}</ul>`,
		'a list in a quotation': `<blockquote><ul>${'<li>a</li>'.repeat(50)}</ul></blockquote>`,
		'sixty colors set with <font>': `<p>${Array.from({ length: 60 }, (_, i) => `<font color="#${(0xc8c8ff + i * 0x000100).toString(16)}">x</font>`).join('')}</p>`,
		'sixty light colors': `<p>${Array.from({ length: 60 }, (_, i) => `<span style="color:rgb(${200 + (i % 50)},${255 - i},255)">x</span>`).join('')}</p>`,
		'a hundred and twenty colors, each inside another': `<p>${Array.from({ length: 120 }, (_, i) => `<span style="color:rgb(255,${100 + i},255)">x`).join('')}${'</span>'.repeat(120)}</p>`,
		'formatting set by styles': `<p>${'<span style="font-weight:700;font-style:italic;text-decoration:underline line-through;vertical-align:super">x</span>'.repeat(40)}</p>`,
		'formatting taken off by styles inside bold': `<p><b>${'<span style="font-weight:400;font-style:normal">x</span>'.repeat(40)}</b></p>`,
		'colored headings, items and cells': '<h2 style="color:red">Head</h2><ul><li style="color:green">item</li></ul><table><tr><td style="color:blue">cell</td></tr></table>',
		'tables with captions': '<table><caption>Table 1</caption><tr><td>a</td></tr></table>'.repeat(20),
		'figures with text beside the picture': '<figure>before <img src="https://x.test/a.png" alt="a"> after<figcaption>cap</figcaption></figure>'.repeat(20),
		'blocks of a pasted page': '<dl><dt>Specimen</dt><dd>Colon</dd></dl><section>one</section><article><p>two</p></article><center><p>three</p></center>'.repeat(10),
		'paragraphs centered by a block around them, in a table cell too': `<div style="text-align:center">${'<p>x</p>'.repeat(30)}<table><tr>${'<td>y</td>'.repeat(10)}</tr></table></div>`,
		'loose text after tables': '<table><tr><td>a</td></tr></table>loose'.repeat(20)
	};
	for (const [name, html] of Object.entries(cases)) {
		it(`is not below the real size for ${name}`, () => {
			const { estimate, actual } = sizes(html);
			expect(estimate).toBeGreaterThanOrEqual(actual);
			// And not far above it. These are documents of one-letter paragraphs, where the few
			// spare bytes counted for each element are a large share; over is the safe direction.
			expect(estimate - actual).toBeLessThan(Math.max(300, actual * 0.6));
		});
	}

	it('takes the font and the body size the document will be written with', () => {
		const html = '<h1>Head</h1><p>text</p><pre>code</pre><h2>Two</h2>'.repeat(10);
		for (const options of [{ fontFamily: 'Times New Roman' }, { fontFamily: 'A Very Long Font Family Name Indeed' }, { fontFamily: 'Courier New' }, { fontSize: 60 }, { fontSize: 600 }]) {
			const { estimate, actual } = sizes(html, options);
			expect(estimate, JSON.stringify(options)).toBeGreaterThanOrEqual(actual);
			expect(estimate - actual, JSON.stringify(options)).toBeLessThan(300);
		}
		// Without them, a long font name was simply not counted.
		const root = el('<p>x</p>');
		expect(estimateRtfBytes(root, { fontFamily: 'A Very Long Font Family Name Indeed' })).toBeGreaterThan(estimateRtfBytes(root));
	});
});
