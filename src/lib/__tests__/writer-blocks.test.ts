import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { htmlToMarkdown } from '../utils.js';

/**
 * Blocks the writer got wrong for HTML that a paste brings in or a browser leaves behind: the
 * <br> at the end of a paragraph, headings below <h3>, a page break, the color of a link. Then
 * the Markdown export, which shares the link check and the table grid with the RTF writer.
 * Invented text.
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
const colorTable = (html: string) => htmlToRtf(el(html)).match(/\{\\colortbl[^}]*\}/)![0];
const md = (html: string) => htmlToMarkdown(el(html));

describe('a <br> that shows as nothing is not written', () => {
	it('at the end of a paragraph, a heading, a list item, a table cell or loose text', () => {
		expect(body('<p>text<br></p>')).toBe('\\pard text\\par ');
		expect(body('<h2>head<br></h2>')).toBe('\\pard\\f0\\fs36\\b head\\b0\\fs24\\par ');
		expect(body('<ul><li>item<br></li></ul>')).toBe('\\pard\\li720\\fi-360\\bullet\\tab item\\par ');
		expect(body('<table><tr><td>cell<br></td></tr></table>')).toContain('\\fi0 cell\\par}\\cell');
		expect(body('loose<br>')).toBe('loose');
	});

	it('at the end of a paragraph inside bold or a span, where a browser also leaves it', () => {
		expect(body('<p><b>text<br></b></p>')).toBe('\\pard \\b text\\b0 \\par ');
		expect(body('<p><span style="color:red"><b>text<br></b></span></p>')).toContain('\\b text\\b0 ');
		expect(body('<p><span style="color:red"><b>text<br></b></span></p>')).not.toContain('\\line');
	});

	it('before a block, which starts a new line anyway', () => {
		expect(body('<div>text<br><p>next</p></div>')).toBe('\\pard text\\par \\pard next\\par ');
	});

	it('with only the spaces of the source after it', () => {
		expect(body('<p>text<br>\n</p>')).not.toContain('\\line');
	});

	it('an empty line that is bold (<p><b><br></b></p>) is one line, not two', () => {
		expect(body('<p>a</p><p><b><br></b></p><p>b</p>')).toBe('\\pard a\\par \\pard \\b \\b0 \\par \\pard b\\par ');
	});

	it('a <br> between two lines is still a line break, and so is the first of two at the end', () => {
		expect(body('<p>a<br>b</p>')).toBe('\\pard a\\line b\\par ');
		expect(body('<p>a<br><br></p>')).toBe('\\pard a\\line \\par ');
		expect(body('<p>a<br><br>b</p>')).toBe('\\pard a\\line \\line b\\par ');
		expect(body('<p>a<br><b>b</b></p>')).toBe('\\pard a\\line \\b b\\b0 \\par ');
	});

	it('a <br> followed by a non-breaking space or a typed tab is a line break', () => {
		expect(body('<p>a<br>&nbsp;</p>')).toContain('\\line ');
		expect(body('<p>a<br><span style="white-space:pre">\t</span></p>')).toContain('\\line \\tab ');
	});

	it('a code block keeps every line break it has', () => {
		expect(body('<pre>a<br>b<br></pre>')).toBe('\\pard\\f1\\fs20 a\\line b\\line \\f0\\fs24\\par ');
	});
});

describe('<h4>, <h5> and <h6>', () => {
	it('each is a bold paragraph of its own, at the size a browser shows it', () => {
		expect(body('<h4>four</h4><h5>five</h5><h6>six</h6><p>x</p>')).toBe(
			'\\pard\\f0\\fs24\\b four\\b0\\fs24\\par \\pard\\f0\\fs20\\b five\\b0\\fs24\\par \\pard\\f0\\fs16\\b six\\b0\\fs24\\par \\pard x\\par '
		);
	});

	it('they scale with the body size, as h1 to h3 do', () => {
		const rtf = htmlToRtf(el('<h4>four</h4><h6>six</h6>'), { fontSize: 9 });
		expect(rtf).toContain('\\pard\\f0\\fs18\\b four\\b0\\fs18\\par \\pard\\f0\\fs12\\b six\\b0\\fs18\\par ');
	});

	it('they take an alignment and an indent, and stay in a table cell', () => {
		expect(body('<h5 style="text-align:center;margin-left:48px">five</h5>')).toBe('\\pard\\qc\\li720\\f0\\fs20\\b five\\b0\\fs24\\par ');
		expect(body('<table><tr><td><h4>four</h4></td></tr></table>')).toContain('\\pard\\intbl\\f0\\fs24\\b four\\b0\\fs24\\par}\\cell');
	});

	it('they read back as the bold paragraphs they were written as, with every word', () => {
		expect(rtfToHtml(htmlToRtf(el('<h4>four</h4><h5>five</h5><p>x</p>')))).toBe(
			'<p><strong>four</strong></p>\n<p><strong><span style="font-size:10pt">five</span></strong></p>\n<p>x</p>'
		);
	});

	it('the size estimate covers them', () => {
		const dom = el('<h4>a</h4><h5>b</h5><h6>c</h6>'.repeat(10));
		expect(estimateRtfBytes(dom)).toBeGreaterThanOrEqual(htmlToRtf(dom).length);
	});
});

describe('a page break', () => {
	it('<hr style="break-after:page">, as the parser writes \\page, is written as \\page', () => {
		expect(body('<p>a</p><hr style="break-after:page"><p>b</p>')).toBe('\\pard a\\par \\page \\pard b\\par ');
		expect(body('<hr style="page-break-after: always">')).toBe('\\page ');
	});

	it('any other rule is the line of dashes, and so is a page break inside a table cell', () => {
		expect(body('<hr style="break-after:avoid">')).toContain('\\emdash');
		expect(body('<table><tr><td><hr style="break-after:page"></td></tr></table>')).toContain('\\pard\\intbl\\qc \\emdash');
	});
});

describe('the color of a link (#3.13)', () => {
	it('a document with a link has the link color first in its color table, so \\cf1 is that color', () => {
		expect(colorTable('<p><a href="https://x.test/a">click</a></p>')).toBe('{\\colortbl;\\red0\\green0\\blue255;\\red0\\green0\\blue0;}');
	});

	it('a document with no link, or only links that are not written as links, has the table it always had', () => {
		expect(colorTable('<p>text</p>')).toBe('{\\colortbl;\\red0\\green0\\blue0;}');
		expect(colorTable('<p><a href="javascript:alert(1)">x</a> <a href="/relative">y</a> <a>z</a></p>')).toBe('{\\colortbl;\\red0\\green0\\blue0;}');
	});

	it('other colors come after it, and black text beside a link is still black', () => {
		const html = '<p><a href="https://x.test/a">click</a> <span style="color:black">k</span> <span style="color:red">r</span> <span style="color:#00f">b</span></p>';
		expect(colorTable(html)).toBe('{\\colortbl;\\red0\\green0\\blue255;\\red0\\green0\\blue0;\\red255\\green0\\blue0;}');
		expect(body(html)).toContain('\\cf2 k\\cf0  \\cf3 r\\cf0  \\cf1 b\\cf0 ');
	});

	it('the size estimate covers the extra color', () => {
		const dom = el('<p><a href="https://x.test/a">a</a></p>');
		expect(estimateRtfBytes(dom)).toBeGreaterThanOrEqual(htmlToRtf(dom).length);
	});
});

describe('the size estimate is never below the real size', () => {
	// Each of these was written larger than it was counted. A document repeats the shape
	// often enough here that the few spare bytes of the header cannot hide the shortfall.
	const cases: Record<string, string> = {
		'paragraphs inside a list item': `<ul><li>${'<p>y</p>'.repeat(60)}</li></ul>`,
		'a numbered list that starts at a long number': `<ol start="100000">${'<li>z</li>'.repeat(200)}</ol>`,
		'blank lines in a code block': `<pre>${'x\n\n\n'.repeat(60)}</pre>`,
		'paragraphs that follow loose text': 'loose<p>x</p>'.repeat(60),
		'one paragraph that follows loose text, which first has to end that line': 'loose text<p>a paragraph</p>',
		'loose text after quotations, lists and rules': '<blockquote>q</blockquote>a<ul><li>i</li></ul>b<hr>c'.repeat(30),
		'text written straight into a list': `<ul>${'<li>a</li>loose'.repeat(40)}</ul>`,
		'a list nested four deep, with text after each list': '<ul><li>a<ul><li>b<ul><li>c<ul><li>d</li></ul>t</li></ul>t</li></ul>t</li></ul>'.repeat(10),
		'aligned cells with merged cells and short rows':
			'<table><tr><td rowspan="3" style="text-align:right">G</td><td align="center">a</td><td>b</td></tr><tr><td>c</td></tr><tr></tr></table>'.repeat(10)
	};
	for (const [name, html] of Object.entries(cases)) {
		it(name, () => {
			const dom = el(html);
			expect(estimateRtfBytes(dom)).toBeGreaterThanOrEqual(htmlToRtf(dom).length);
		});
	}
});

describe('htmlToMarkdown: links', () => {
	it('a web, mail or phone link is a link', () => {
		expect(md('<p><a href="https://x.test/a">l</a> <a href="mailto:lab@x.test">m</a></p>')).toBe('[l](https://x.test/a) [m](mailto:lab@x.test)\n\n');
	});

	it('any other address is written as its text alone, as in the RTF', () => {
		for (const href of ['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', '../x', '\\\\server\\share']) {
			expect(md(`<p>a <a href="${href}">text</a> b</p>`), href).toBe('a text b\n\n');
		}
		expect(md('<p><a>no address</a></p>')).toBe('no address\n\n');
	});

	it('a parenthesis in the address does not end the link early', () => {
		expect(md('<p><a href="https://x.test/a(b)c">l</a></p>')).toBe('[l](https://x.test/a%28b%29c)\n\n');
	});
});

describe('htmlToMarkdown: text that looks like Markdown', () => {
	it('emphasis, code, heading, link and HTML marks in text are escaped', () => {
		expect(md('<p>1*2*3 _x_ # [y]</p>')).toBe('1\\*2\\*3 \\_x\\_ \\# \\[y\\]\n\n');
		expect(md('<p>a `b` ~c~ &lt;b&gt; back\\slash</p>')).toBe('a \\`b\\` \\~c\\~ \\<b> back\\\\slash\n\n');
	});

	it('a line that starts with a dash, a plus, a number or > is not a list or a quotation', () => {
		expect(md('<p>- Benign.</p><p>+ plus</p><p>1. Left colon</p><p>2) right</p><p>&gt; p</p>')).toBe(
			'\\- Benign.\n\n\\+ plus\n\n1\\. Left colon\n\n2\\) right\n\n\\> p\n\n'
		);
		expect(md('<p>first<br>- second</p>')).toBe('first\n\\- second\n\n');
	});

	it('those marks in the middle of a line are left alone', () => {
		expect(md('<p>p &gt; 0.05, 3 - 2 = 1, stage 2. Done</p>')).toBe('p > 0.05, 3 - 2 = 1, stage 2. Done\n\n');
	});

	it('code is written as it is', () => {
		expect(md('<p><code>a*b_c</code></p><pre>x *y* [z]\n# not a heading</pre>')).toBe('`a*b_c`\n\n```\nx *y* [z]\n# not a heading\n```\n\n');
	});

	it('formatting made of elements is still Markdown', () => {
		expect(md('<p><strong>b*</strong> <em>i_</em></p>')).toBe('**b\\*** *i\\_*\n\n');
	});
});

describe('htmlToMarkdown: tables (#3.13)', () => {
	it('a table with a header row', () => {
		expect(md('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>')).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |\n\n');
	});

	it('a table with no header gets the empty one Markdown requires', () => {
		expect(md('<table><tr><td>a</td><td>b</td></tr></table>')).toBe('|   |   |\n| --- | --- |\n| a | b |\n\n');
	});

	it('formatting in a cell is kept; a pipe is escaped and a line break is a <br>', () => {
		expect(md('<table><tr><th>H</th></tr><tr><td><b>x</b> a|b</td></tr><tr><td>one<br>two</td></tr></table>')).toBe(
			'| H |\n| --- |\n| **x** a\\|b |\n| one<br>two |\n\n'
		);
	});

	it('a merged cell is written where it starts, and the cells it covers are left empty', () => {
		expect(md('<table><tr><th>G</th><th>P</th><th>M</th></tr><tr><td rowspan="2">T</td><td>Earth</td><td>1</td></tr><tr><td>Mars</td><td>2</td></tr><tr><td colspan="3">all</td></tr></table>')).toBe(
			'| G | P | M |\n| --- | --- | --- |\n| T | Earth | 1 |\n|  | Mars | 2 |\n| all |  |  |\n\n'
		);
	});

	it('the head is the first row, wherever the source has it', () => {
		expect(md('<table><tbody><tr><td>body</td></tr></tbody><thead><tr><th>head</th></tr></thead></table>')).toBe('| head |\n| --- |\n| body |\n\n');
	});

	it('text before and after a table stays apart from it', () => {
		expect(md('<p>before</p><table><tr><th>H</th></tr></table><p>after</p>')).toBe('before\n\n| H |\n| --- |\n\nafter\n\n');
	});
});

describe('htmlToMarkdown: lists and headings', () => {
	it('a numbered list starts where it says', () => {
		expect(md('<ol start="4"><li>x</li><li>y</li></ol>')).toBe('4. x\n5. y\n\n');
	});

	it('<h4> to <h6> are headings', () => {
		expect(md('<h4>a</h4><h5>b</h5><h6>c</h6>')).toBe('#### a\n\n##### b\n\n###### c\n\n');
	});
});

describe('text typed straight into the editor before a block ends its own line', () => {
	// Chromium leaves the first line typed into an empty editor as loose text, and the next line
	// becomes the block: "Diagnosis:<ul>…". \pard resets the formatting but ends no paragraph, so
	// without a \par the loose text ran into the block's first line.
	const texts = (html: string) => Array.from(el(rtfToHtml(htmlToRtf(el(html)))).querySelectorAll('p, li, h1, h2, h3, pre, td'))
		.map((e) => e.textContent?.replace(/\s+/g, ' ').trim());

	it.each([
		['a bullet list', 'Diagnosis:<ul><li>x</li></ul>', 'Diagnosis:\\par \\pard\\li720\\fi-360\\bullet\\tab x\\par '],
		['a numbered list', 'Diagnosis:<ol><li>x</li></ol>', 'Diagnosis:\\par \\pard\\li720\\fi-360 1.\\tab x\\par '],
		['a heading', 'Note<h2>Gross</h2>', 'Note\\par \\pard\\f0\\fs36\\b Gross\\b0\\fs24\\par '],
		['an <h5>', 'Note<h5>Gross</h5>', 'Note\\par \\pard'],
		['a code block', 'Note<pre>x</pre>', 'Note\\par \\pard'],
		['a rule', 'Note<hr>', 'Note\\par \\pard\\qc'],
		['a quotation', 'Note<blockquote><p>q</p></blockquote>', 'Note\\par \\i \\pard\\li720 q'],
		['a table', 'Margins:<table><tr><td>a</td><td>b</td></tr></table>', 'Margins:\\par {\\trowd']
	])('before %s', (_name, html, start) => {
		expect(body(html).startsWith(start)).toBe(true);
	});

	it('and a save and reload keeps the line apart from the block', () => {
		expect(texts('Diagnosis:<ul><li>x</li></ul>')).toEqual(['Diagnosis:', 'x']);
		expect(texts('Margins:<table><tr><td>a</td><td>b</td></tr></table>')).toEqual(['Margins:', 'a', 'b']);
		expect(texts('Note<h2>Gross</h2>Body')).toEqual(['Note', 'Gross', 'Body']);
	});

	it('inside a <div> and inside a table cell too', () => {
		expect(texts('<div>Diagnosis:<ul><li>x</li></ul></div>')).toEqual(['Diagnosis:', 'x']);
		expect(body('<table><tr><td>Result:<ul><li>x</li></ul></td></tr></table>')).toContain('Result:\\par \\pard\\intbl');
	});

	it('a block with nothing typed before it gets no blank line', () => {
		expect(body('<ul><li>x</li></ul>')).toBe('\\pard\\li720\\fi-360\\bullet\\tab x\\par ');
		expect(body('<p>a</p><h2>b</h2>')).not.toContain('\\par \\par ');
	});

	it('the size estimate still covers what is written', () => {
		for (const html of ['Diagnosis:<ul><li>x</li></ul>', 'Note<h2>Gross</h2>', 'Margins:<table><tr><td>a</td></tr></table>', 'a<hr>b<pre>c</pre>d<figure></figure>']) {
			expect(estimateRtfBytes(el(html))).toBeGreaterThanOrEqual(htmlToRtf(el(html)).length);
		}
	});
});

describe('htmlToMarkdown: a table keeps its columns, and nothing becomes a link it was not', () => {
	/** The cells of each row of a GFM table, split the way a GFM reader splits them. */
	const cells = (markdown: string) =>
		markdown
			.trim()
			.split('\n')
			.filter((l) => l.startsWith('|'))
			.map((l) => l.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim()));

	it('a pipe in code, a code block or a link address does not end the cell', () => {
		const rows = cells(md('<table><tr><td><code>ER|PR</code></td><td><a href="https://example.test/a|b">x</a></td><td><pre>a|b</pre></td></tr></table>'));
		expect(rows[2]).toHaveLength(3);
		expect(rows[2][0]).toBe('`ER\\|PR`');
		expect(rows[2][1]).toBe('[x](https://example.test/a%7Cb)');
		expect(rows[2][2]).toBe('`a\\|b`');
	});

	it('a table inside a cell is its text, so the cell after it stays in its column', () => {
		const rows = cells(md('<table><tr><td><table><tr><td>A</td><td>B</td></tr></table></td><td>Negative</td></tr></table>'));
		expect(rows[2]).toEqual(['A / B', 'Negative']);
	});

	it('a newline in a cell\'s text is a space, as on screen', () => {
		expect(cells(md('<table><tr><td>Tumor\nsize</td></tr></table>'))[2]).toEqual(['Tumor size']);
	});

	it('a caption or a description cannot carry a link, and a picture address must be one to load', () => {
		const caption = md('<figure><img src="https://example.test/x.png" alt="x"><figcaption>[open](javascript:alert(1))</figcaption></figure>');
		expect(caption).toContain('*\\[open\\](javascript:alert(1))*');
		// The "]" is escaped, so the description cannot close early: the address is the picture's.
		expect(md('<p><img src="https://example.test/x.png" alt="](javascript:alert(1))"></p>')).toBe('![\\](javascript:alert(1))](https://example.test/x.png)\n\n');
		expect(md('<p><img src="javascript:alert(1)" alt="dot"></p>')).toBe('dot\n\n');
	});

	it('a figure with no picture keeps what it holds', () => {
		expect(md('<figure><blockquote>Quoted text</blockquote><figcaption>cap</figcaption></figure>')).toBe('> Quoted text\n\n*cap*\n\n');
	});

	it('a table in a list item starts on its own line, inside the item', () => {
		const out = md('<ul><li>See<table><tr><th>A</th></tr><tr><td>1</td></tr></table></li></ul>');
		expect(out).toBe('- See\n\n  | A |\n  | --- |\n  | 1 |\n\n');
	});

	it('a list inside a list item is indented under it', () => {
		expect(md('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')).toBe('- a\n\n  - b\n- c\n\n');
	});

	it('a code block holding a fence is fenced with more backticks', () => {
		expect(md('<pre>```\nx</pre>')).toBe('````\n```\nx\n````\n\n');
	});
});

describe('content that has already ended its line adds no blank line before a block', () => {
	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
	const blank = (html: string) => rtfToHtml(htmlToRtf(el(html))).includes('<p><br></p>');

	it.each([
		['a picture straight in the editor', `<p>a</p><img src="${PNG}"><ul><li>y</li></ul>`],
		['a picture before a heading', `<img src="${PNG}"><h2>Gross</h2>`],
		['a picture before a table', `<img src="${PNG}"><table><tr><td>a</td></tr></table>`],
		['a Google Docs paste wrapper', '<b id="docs-internal-guid-1"><p>Diagnosis</p><ul><li>a</li></ul></b><ul><li>b</li></ul>'],
		['a span around a paragraph', '<span><p>a</p></span><ul><li>b</li></ul>'],
		['a span around a paragraph, before a paragraph', '<span><p>a</p></span><p>b</p>']
	])('after %s', (_name, html) => {
		expect(htmlToRtf(el(html))).not.toContain('\\par \\par ');
		expect(blank(html)).toBe(false);
	});

	it('text before a block with a comment between them still ends its line', () => {
		expect(body('Diagnosis:<!-- c --><ul><li>x</li></ul>').startsWith('Diagnosis:\\par \\pard')).toBe(true);
	});
});

describe('htmlToMarkdown: what the second review found', () => {
	it('a figure with no picture is a block of its own', () => {
		expect(md('<figure>Just text</figure><p>next</p>')).toBe('Just text\n\nnext\n\n');
		expect(md('<figure>Some text<figcaption>Cap</figcaption></figure>')).toBe('Some text\n\n*Cap*\n\n');
	});

	it('a tab the editor typed stays a tab', () => {
		expect(md('<p>Specimen:<span style="white-space:pre">\t</span>Left breast</p>')).toBe('Specimen:\tLeft breast\n\n');
	});

	it('JPEG data labeled image/jpg, and data wrapped over lines, are kept as pictures', () => {
		expect(md('<p><img src="data:image/jpg;base64,/9j/4AAQ" alt="j"></p>')).toBe('![j](data:image/jpg;base64,/9j/4AAQ)\n\n');
		expect(md('<p><img src="data:image/png;base64,iVBO\nRw0K" alt="p"></p>')).toBe('![p](data:image/png;base64,iVBORw0K)\n\n');
	});
});

describe('a figure with no picture, and a stray caption', () => {
	const paragraphs = (html: string) =>
		Array.from(el(rtfToHtml(htmlToRtf(el(html)))).children).map((c) => c.textContent?.trim());

	it('a figure with no picture is a paragraph of its own, wrapped or not', () => {
		expect(paragraphs('<figure>txt</figure><p>b</p>')).toEqual(['txt', 'b']);
		expect(paragraphs('<b><figure>txt</figure></b><p>b</p>')).toEqual(['txt', 'b']);
	});

	it('its caption is written once, below what it holds', () => {
		const rtf = htmlToRtf(el('<figure>Some text<figcaption>Cap</figcaption></figure>'));
		expect(rtf.split('Cap').length - 1).toBe(1);
		expect(paragraphs('<figure>Some text<figcaption>Cap</figcaption></figure>')).toEqual(['Some text', 'Cap']);
	});

	it('a caption outside a figure is text where it stands, and the paragraph after it is its own', () => {
		expect(paragraphs('<b>a<figcaption>c</figcaption></b><p>b</p>')).toEqual(['ac', 'b']);
	});

	it('in a list item, a wrapper that ends with a paragraph adds no blank line before a nested list', () => {
		const html = '<ul><li><b><p>a</p></b><ul><li>b</li></ul></li></ul>';
		expect(htmlToRtf(el(html))).not.toContain('\\par \\par ');
		expect(estimateRtfBytes(el(html))).toBeGreaterThanOrEqual(htmlToRtf(el(html)).length);
	});

	it('Markdown: a figure with no picture between text starts and ends its own block', () => {
		expect(md('x<figure>t</figure>y')).toBe('x\n\nt\n\ny');
	});
});

describe('what the fourth review found', () => {
	const texts = (html: string) => (el(rtfToHtml(htmlToRtf(el(html)))).textContent || '').replace(/\s+/g, ' ').trim();

	it("a figure's own caption is written even when what it holds has a caption of its own", () => {
		const rtf = htmlToRtf(el('<figure><figure>a<figcaption>c</figcaption></figure><figcaption>d</figcaption></figure>'));
		expect(rtf.split(' c\\').length - 1).toBe(1);
		expect(rtf).toContain(' d\\');
		// (The HTML parser closes the <p> at the <figcaption>, so "c" is the figure's first caption
		// and "d" a second one held in it: each word is still written once.)
		const words = texts('<figure><p>x<figcaption>c</figcaption></p><figcaption>d</figcaption></figure>').split(' ').sort();
		expect(words).toEqual(['c', 'd', 'x']);
	});

	it('the estimate covers text after a wrapper that ends with a block, in a list item', () => {
		for (const html of ['<ul><li><span>x<ul><li>n</li></ul></span>tail</li></ul>', `<ul><li>${'<b>x<p>a</p></b>t'.repeat(20)}</li></ul>`]) {
			expect(estimateRtfBytes(el(html))).toBeGreaterThanOrEqual(htmlToRtf(el(html)).length);
		}
	});

	it('a caption outside a figure, in a list item, stays on its line', () => {
		expect(texts('<ul><li>a<figcaption>c</figcaption>b</li></ul>')).toBe('acb');
	});
});
