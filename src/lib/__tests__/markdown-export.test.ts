import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../utils.js';

/**
 * The Markdown export, for the HTML an editor can really hold: what a browser leaves behind when
 * a line is typed and Enter is pressed, and what a paste from a word processor or a web page
 * brings in. Each group below is one way the export used to lose text, run two lines together, or
 * write something a Markdown viewer shows differently from the screen: a list inside a list, text
 * beside a picture, a quotation of several paragraphs, a line that looks like a heading underline,
 * bold with a space inside it, text the screen hides. At the end, documents put together at random
 * are checked for the one thing that must always hold: no word is lost, and the words stay in
 * order. Invented text.
 */

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const md = (html: string) => htmlToMarkdown(el(html));

describe('a list keeps everything written in it', () => {
	it('a list written straight inside a list is nested under the item before it', () => {
		expect(md('<ul><li>Item A</li><ul><li>Sub B</li></ul></ul>')).toBe('- Item A\n\n  - Sub B\n\n');
		expect(md('<ol><li>a</li><ol><li>b</li></ol><li>c</li></ol>')).toBe('1. a\n\n   1. b\n2. c\n\n');
	});

	it('two lists in a row under one item both stay under it', () => {
		expect(md('<ul><li>Margins</li><ul><li>proximal</li></ul><ul><li>distal</li></ul><li>Nodes</li></ul>')).toBe(
			'- Margins\n\n  - proximal\n\n  - distal\n- Nodes\n\n'
		);
	});

	it('text and paragraphs that are not items are kept as lines between the items', () => {
		expect(md('<ul><li>x</li>stray text<li>y</li><p>para</p></ul>')).toBe('- x\n\nstray text\n\n- y\n\npara\n\n');
	});

	it('a numbered list goes on counting after a line that is not an item', () => {
		expect(md('<ol><li>Colon</li>see note <b>two</b><li>Rectum</li></ol>')).toBe('1. Colon\n\nsee note **two**\n\n2. Rectum\n\n');
	});

	it('a list with no item before it, inside a list, is still written', () => {
		const out = md('<ul><ul><li>orphan</li></ul><li>item</li></ul>');
		expect(out).toContain('- orphan');
		expect(out).toContain('- item');
	});

	it('the line breaks between items in the source add nothing', () => {
		expect(md('<ul>\n\t<li>x</li>\n\t<li>y</li>\n</ul>')).toBe('- x\n- y\n\n');
	});
});

describe('superscript, subscript, struck and inserted text', () => {
	it('are written so that they still show as such', () => {
		expect(md('<p>10<sup>3</sup>/mm, H<sub>2</sub>O, <del>gone</del>, <ins>new</ins></p>')).toBe(
			'10<sup>3</sup>/mm, H<sub>2</sub>O, ~~gone~~, <ins>new</ins>\n\n'
		);
	});
});

describe('text typed straight into the editor is a line of its own', () => {
	it('the first line typed, then Enter twice', () => {
		expect(md('first line<div>second</div><div>third</div>')).toBe('first line\n\nsecond\n\nthird\n\n');
	});

	it('loose text before and between paragraphs', () => {
		expect(md('loose<p>para</p>tail<p>p2</p>')).toBe('loose\n\npara\n\ntail\n\np2\n\n');
	});

	it('loose text before a rule is not turned into a heading by it', () => {
		const out = md('Note<hr>after');
		expect(out).not.toMatch(/Note\n-+/);
		expect(out).toMatch(/^Note\n\n\n?---\n\nafter$/);
	});
});

describe('lines made of <div> are paragraphs, and none becomes a heading', () => {
	it('three typed lines are three paragraphs', () => {
		expect(md('<div>line one</div><div>line two</div><div>line three</div>')).toBe('line one\n\nline two\n\nline three\n\n');
	});

	it('a line of dashes or equal signs under a line of text stays text', () => {
		expect(md('<div>Findings</div><div>---</div>')).toBe('Findings\n\n\\---\n\n');
		expect(md('<p>Title<br>===</p>')).toBe('Title  \n\\===\n\n');
		expect(md('<p>Title<br>=</p>')).toBe('Title  \n\\=\n\n');
		expect(md('<p>Title<br>--</p>')).toBe('Title  \n\\--\n\n');
		expect(md('<p>Title<br>- - -</p>')).toBe('Title  \n\\- - -\n\n');
	});

	it('equal signs and dashes inside a line are left alone', () => {
		expect(md('<p>pH = 7, a -- b, x == y</p>')).toBe('pH = 7, a -- b, x == y\n\n');
	});

	it('a line break inside a paragraph is one Markdown keeps', () => {
		expect(md('<p>Left colon<br>Right colon</p>')).toBe('Left colon  \nRight colon\n\n');
		expect(md('<div>one <br> two</div>')).toBe('one  \ntwo\n\n');
	});

	it('a line break at the end of a paragraph, which shows as nothing, is not written', () => {
		expect(md('<p>text<br></p><p>next</p>')).toBe('text\n\nnext\n\n');
		expect(md('<p><br></p>')).toBe('');
	});

	it('an empty line inside a paragraph is kept as one', () => {
		expect(md('<p>above<br><br>below</p>')).toBe('above<br>  \nbelow\n\n');
	});

	it('a line break in a heading stays in the heading', () => {
		expect(md('<h2>Gross<br>description</h2><p>next</p>')).toBe('## Gross<br>description\n\nnext\n\n');
	});
});

describe('bold, italic and struck text with a space just inside it', () => {
	it('the space is written outside the marks, so the marks still work', () => {
		expect(md('<p>the <b>diagnosis </b>is <i> benign</i>.</p>')).toBe('the **diagnosis** is *benign*.\n\n');
		expect(md('<p>was<s> removed </s>later</p>')).toBe('was ~~removed~~ later\n\n');
		expect(md('<p>no<b>&nbsp;break</b></p>')).toBe('no\u00a0**break**\n\n');
	});

	it('bold with nothing in it writes nothing', () => {
		expect(md('<p>a<b></b>b<i> </i>c<s></s></p>')).toBe('ab c\n\n');
	});

	it('bold inside bold is marked once', () => {
		expect(md('<p><b>mild <strong>atypia</strong></b></p>')).toBe('**mild atypia**\n\n');
	});

	it('bold right after bold is one run of bold, not two pairs of marks back to back', () => {
		expect(md('<p><b>Diag</b><b>nosis</b>: <i>ade</i><i>noma</i></p>')).toBe('**Diagnosis**: *adenoma*\n\n');
		expect(md('<p><span><b>tub</b></span><b>ular</b> <b>low</b> <b>grade</b></p>')).toBe('**tubular** **low** **grade**\n\n');
		expect(md('<b>lead <b>in<div>block</div>tail</b> end</b>')).toBe('**lead in**\n\n**block**\n\n**tail end**');
	});

	it('a paste wrapper that is not bold on screen writes no marks', () => {
		expect(md('<b style="font-weight:normal" id="docs-internal-guid-1"><p>Diagnosis</p><ul><li>a</li></ul></b>')).toBe('Diagnosis\n\n- a\n\n');
		expect(md('<p><b style="font-weight: 400">plain</b> <i style="font-style: normal">upright</i></p>')).toBe('plain upright\n\n');
	});

	it('bold around several paragraphs is bold in each, not one pair of marks across them', () => {
		expect(md('<b><p>one</p><p>two</p></b>')).toBe('**one**\n\n**two**\n\n');
		expect(md('<i>lead<div>inner</div>tail</i>')).toBe('*lead*\n\n*inner*\n\n*tail*');
		expect(md('<strong><ul><li>a</li><li>b</li></ul></strong>')).toBe('- **a**\n- **b**\n\n');
		expect(md('<b><h2>Head</h2><table><tr><th>H</th></tr><tr><td>c</td></tr></table></b>')).toBe('## **Head**\n\n| **H** |\n| --- |\n| **c** |\n\n');
	});

	it('a link around a paragraph is a link in it', () => {
		expect(md('<a href="https://x.test/r"><div>Report</div></a>')).toBe('[Report](https://x.test/r)\n\n');
	});
});

describe('a quotation with more than one block', () => {
	it('every paragraph stays in the quotation', () => {
		expect(md('<blockquote><p>q1</p><p>q2</p></blockquote><p>after</p>')).toBe('> q1\n>\n> q2\n\nafter\n\n');
	});

	it('a code block in a quotation opens and closes in it', () => {
		expect(md('<blockquote><p>q</p><pre>code\n\nmore</pre></blockquote><p>after</p>')).toBe('> q\n>\n> ```\n> code\n>\n> more\n> ```\n\nafter\n\n');
	});

	it('a list in a quotation, with a list inside it', () => {
		expect(md('<blockquote>Sites:<ul><li>colon<ul><li>left</li></ul></li><li>rectum</li></ul></blockquote>')).toBe(
			'> Sites:\n>\n> - colon\n>\n>   - left\n> - rectum\n\n'
		);
	});

	it('a quotation in a quotation', () => {
		expect(md('<blockquote>outer<blockquote>inner</blockquote></blockquote>')).toBe('> outer\n>\n> > inner\n\n');
	});
});

describe('a mark that means something at the start of a line is escaped wherever a line starts', () => {
	it('in a list item', () => {
		expect(md('<ul><li>- dash</li><li>1. num</li><li>&gt; q</li><li>+ plus</li></ul>')).toBe('- \\- dash\n- 1\\. num\n- \\> q\n- \\+ plus\n\n');
	});

	it('in a quotation and in a heading', () => {
		expect(md('<blockquote>- dash</blockquote>')).toBe('> \\- dash\n\n');
		expect(md('<h2>1. Findings</h2>')).toBe('## 1\\. Findings\n\n');
	});

	it('in text typed straight into the editor', () => {
		expect(md('1. first<div>next</div>')).toBe('1\\. first\n\nnext\n\n');
		expect(md('&gt; quote')).toBe('\\> quote');
		expect(md('- dash')).toBe('\\- dash');
	});

	it('a > with no space after it is still escaped, since it would still open a quotation', () => {
		expect(md('<p>&gt;5 mitoses</p>')).toBe('\\>5 mitoses\n\n');
	});

	it('a paragraph of dashes is not a rule, and "# text" is not a heading', () => {
		expect(md('<p>---</p>')).toBe('\\---\n\n');
		expect(md('<p># not a heading</p>')).toBe('\\# not a heading\n\n');
	});

	it('after a line break inside a list item too', () => {
		expect(md('<ul><li>first<br>- second</li></ul>')).toBe('- first  \n  \\- second\n\n');
	});
});

describe('line breaks in a code block', () => {
	it('a <br> is a new line', () => {
		expect(md('<pre>a<br>b</pre>')).toBe('```\na\nb\n```\n\n');
	});

	it('each <div> is a line', () => {
		expect(md('<pre><div>l1</div><div>l2</div></pre>')).toBe('```\nl1\nl2\n```\n\n');
		expect(md('<pre>top<div>l1<br></div><div><br></div><div>l3</div></pre>')).toBe('```\ntop\nl1\n\nl3\n```\n\n');
	});

	it('in a table cell, each line is still its own piece of code', () => {
		expect(md('<table><tr><th>H</th></tr><tr><td><pre>a<br>b</pre></td></tr></table>')).toBe('| H |\n| --- |\n| `a`<br>`b` |\n\n');
	});
});

describe('code with nothing in it', () => {
	it('writes no stray backticks', () => {
		expect(md('<p>a<code></code>b <code>k</code></p>')).toBe('ab `k`\n\n');
	});

	it('a line break inside a piece of code in a line is a space, as Markdown reads it', () => {
		expect(md('<p><code>a\n- b</code></p>')).toBe('`a - b`\n\n');
	});
});

describe('an ampersand that would be read as a character name', () => {
	it('is escaped, so "&copy;" typed as text stays those six characters', () => {
		expect(md('<p>&amp;copy; 2024 &amp;lt;b&amp;gt; &amp;#35; &amp;#x41;</p>')).toBe('\\&copy; 2024 \\&lt;b\\&gt; &\\#35; &\\#x41;\n\n');
	});

	it('is left alone anywhere else', () => {
		expect(md('<p>H&amp;E stain, AT&amp;T, R &amp; D; a&amp;b</p>')).toBe('H&E stain, AT&T, R & D; a&b\n\n');
	});

	it('is escaped when the name is split over two elements', () => {
		expect(md('<p>&amp;<span>co</span>py; and H&amp;<span>E</span></p>')).toBe('\\&copy; and H&E\n\n');
	});

	it('is written out in a link address, where it would be read the same way', () => {
		expect(md('<p><a href="https://x.test/?a=1&amp;copy;=2&amp;b=3">l</a></p>')).toBe('[l](https://x.test/?a=1&amp;copy;=2&b=3)\n\n');
	});
});

describe('an exclamation mark just before a link', () => {
	it('does not turn the link into a picture', () => {
		expect(md('<p>Urgent!<a href="https://x.test/r">report</a></p>')).toBe('Urgent\\![report](https://x.test/r)\n\n');
	});
});

describe("a table's caption", () => {
	it('is a line of its own before the table', () => {
		expect(md('<table><caption>Table 1. Results</caption><tr><th>A</th></tr><tr><td>1</td></tr></table>')).toBe(
			'Table 1. Results\n\n| A |\n| --- |\n| 1 |\n\n'
		);
	});

	it('of a table inside a table cell is kept with that table\'s text', () => {
		const out = md('<table><tr><td><table><caption>Inner</caption><tr><td>A</td><td>B</td></tr></table></td></tr></table>');
		expect(out).toContain('Inner');
		expect(out).toContain('A / B');
		expect(out.indexOf('Inner')).toBeLessThan(out.indexOf('A / B'));
	});
});

describe('a figure keeps everything it holds', () => {
	it('text typed beside the picture is kept, and the caption comes last', () => {
		expect(md('<figure>typed before<img src="a.png" alt="pic">typed after<figcaption>Cap</figcaption></figure>')).toBe(
			'typed before\n\n![pic](a.png)\n\ntyped after\n\n*Cap*\n\n'
		);
	});

	it('a second picture is written too', () => {
		expect(md('<figure><img src="a.png" alt="one"><img src="b.png" alt="two"><figcaption>Cap</figcaption></figure>')).toBe(
			'![one](a.png)\n\n![two](b.png)\n\n*Cap*\n\n'
		);
	});

	it('a picture with no description still takes the caption as its description', () => {
		expect(md('<figure><img src="a.png"><figcaption>Cut surface</figcaption></figure>')).toBe('![Cut surface](a.png)\n\n*Cut surface*\n\n');
	});

	it('a figure inside a figure writes its own caption, and the outer one writes its own once', () => {
		expect(md('<figure><figure><img src="a.png" alt="a"><figcaption>inner</figcaption></figure><figcaption>outer</figcaption></figure>')).toBe(
			'![a](a.png)\n\n*inner*\n\n*outer*\n\n'
		);
	});

	it('a caption wrapped in another element is still the figure\'s caption', () => {
		expect(md('<figure><div><img src="a.png" alt="a"><figcaption>Cap</figcaption></div></figure>')).toBe('![a](a.png)\n\n*Cap*\n\n');
	});

	it('a caption of two lines keeps both', () => {
		expect(md('<figure><img src="a.png" alt="a"><figcaption><p>Line one</p><p>Line two</p></figcaption></figure>')).toBe(
			'![a](a.png)\n\n*Line one*\n\n*Line two*\n\n'
		);
	});

	it('a caption outside any figure is text where it stands', () => {
		expect(md('<p>a</p><figcaption>stray</figcaption><p>b</p>')).toBe('a\n\nstray\n\nb\n\n');
	});

	it('a picture inside a link, in a figure, is still a linked picture', () => {
		expect(md('<figure><a href="https://x.test/full"><img src="a.png" alt="a"></a></figure>')).toBe('[![a](a.png)](https://x.test/full)\n\n');
	});
});

describe('blocks the export has no Markdown for are still lines of their own', () => {
	it('a description list', () => {
		expect(md('<dl><dt>Specimen</dt><dd>Colon</dd><dt>Margins</dt><dd>Negative</dd></dl>')).toBe('Specimen\n\nColon\n\nMargins\n\nNegative\n\n');
	});

	it('sections, articles and the like', () => {
		expect(md('<section>one</section><article>two</article>')).toBe('one\n\ntwo\n\n');
		expect(md('<header>h</header><main>m</main><aside>a</aside><nav>n</nav><footer>f</footer>')).toBe('h\n\nm\n\na\n\nn\n\nf\n\n');
		expect(md('<address>Lab 4</address><center>Final</center>text')).toBe('Lab 4\n\nFinal\n\ntext');
	});

	it('a summary and what it folds away', () => {
		expect(md('<details><summary>Sum</summary>Body</details>')).toBe('Sum\n\nBody\n\n');
	});

	it('a list item with no list around it', () => {
		expect(md('before<li>orphan</li>after')).toBe('before\n\norphan\n\nafter');
	});
});

describe('text the screen does not show is not written', () => {
	it('styles, scripts and templates', () => {
		expect(md('<p>seen</p><style>p { color: red }</style><script>var x = 1;</script><template><p>t</p></template><noscript>n</noscript><title>T</title>')).toBe('seen\n\n');
		expect(md('<p>a<style>b { }</style>c</p>')).toBe('ac\n\n');
	});

	it('hidden elements', () => {
		expect(md('<p>seen</p><p hidden>gone</p><div style="display:none">gone</div><p>a<span style="display: none">gone</span>b <span style="visibility:hidden">gone</span>c</p>')).toBe(
			'seen\n\nab c\n\n'
		);
		expect(md('<ul><li>x</li><li hidden>gone</li><li>y</li></ul>')).toBe('- x\n- y\n\n');
		// Word's hidden text, as a paste from Word carries it.
		expect(md('<p>seen<span style="mso-hide:all">gone</span></p>')).toBe('seen\n\n');
		expect(md('<pre>code<span hidden>gone</span><script>x</script></pre>')).toBe('```\ncode\n```\n\n');
	});

	it('a hidden cell is left empty, and a hidden row or caption is not written', () => {
		expect(md('<table><caption hidden>gone</caption><tr><th>A</th><th>B</th></tr><tr><td>1</td><td style="display:none">gone</td></tr><tr hidden><td>gone</td><td>gone</td></tr><tr><td>3</td><td>4</td></tr></table>')).toBe(
			'| A | B |\n| --- | --- |\n| 1 |  |\n| 3 | 4 |\n\n'
		);
		expect(md('<figure><img src="a.png" alt="a"><figcaption hidden>gone</figcaption></figure>')).toBe('![a](a.png)\n\n');
	});

	it('text shown again inside a hidden element is written', () => {
		expect(md('<div style="visibility:hidden">gone <span style="visibility:visible">back</span> gone</div>')).toBe('back\n\n');
	});
});

describe('a picture address with a control character in it', () => {
	it('is not written as an address', () => {
		expect(md('<p><img src="&#1;javascript:alert(1)" alt="dot"></p>')).toBe('dot\n\n');
		expect(md('<p><img src="java&#9;script:alert(1)" alt="dot"></p>')).toBe('dot\n\n');
		expect(md('<p><img src="a&#127;.png" alt="dot"></p>')).toBe('dot\n\n');
	});

	it('an ordinary address, and picture data wrapped over lines, still are', () => {
		expect(md('<p><img src=" a.png " alt="dot"></p>')).toBe('![dot](a.png)\n\n');
		expect(md('<p><img src="data:image/png;base64,iVBO\nRw0K" alt="p"></p>')).toBe('![p](data:image/png;base64,iVBORw0K)\n\n');
	});
});

describe('documents put together at random lose no word', () => {
	/** A small seeded generator (mulberry32): the same documents on every run. */
	function generator(seed: number) {
		let a = seed >>> 0;
		const next = () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const int = (n: number) => Math.floor(next() * n);
		const pick = <T>(items: readonly T[]): T => items[int(items.length)];
		const chance = (p: number) => next() < p;
		return { int, pick, chance };
	}
	type Random = ReturnType<typeof generator>;

	const WORDS = ['benign', 'margin', 'colon', 'node', 'tissue', 'section', 'left', 'polyp', 'gland', 'stroma', 'serosa', 'negative', 'crypt', 'mucosa'];

	/** A document builder: every word it writes is numbered, so each is found once and in order. */
	function builder(r: Random) {
		let n = 0;
		const word = () => `${r.pick(WORDS)}${n++}`;
		const words = (max: number) => Array.from({ length: 1 + r.int(max) }, word).join(' ');
		const inline = (depth = 0): string => {
			const parts: string[] = [];
			for (let i = 1 + r.int(3); i > 0; i--) {
				const kind = depth > 1 ? 0 : r.int(9);
				if (kind === 1) parts.push(`<b>${r.chance(0.3) ? ' ' : ''}${inline(depth + 1)}${r.chance(0.3) ? ' ' : ''}</b>`);
				else if (kind === 2) parts.push(`<i>${inline(depth + 1)}</i>`);
				else if (kind === 3) parts.push(`<code>${words(2)}</code>`);
				else if (kind === 4) parts.push(`<a href="https://example.test/${n}">${inline(depth + 1)}</a>`);
				else if (kind === 5) parts.push(`${words(2)}<br>${words(2)}`);
				else if (kind === 6) parts.push(`<u>${words(2)}</u> <s>${words(1)}</s><sup>${words(1)}</sup>`);
				else parts.push(words(4));
			}
			return parts.join(' ');
		};
		const list = (depth: number): string => {
			const tag = r.chance(0.5) ? 'ul' : 'ol';
			let html = `<${tag}>`;
			for (let i = 1 + r.int(3); i > 0; i--) {
				// A list inside a list is written both ways: inside the item, and straight inside the list.
				const nested = depth < 2 && r.chance(0.35) ? list(depth + 1) : '';
				const inside = r.chance(0.5);
				html += `<li>${inline()}${inside ? nested : ''}</li>${inside ? '' : nested}`;
				if (r.chance(0.1)) html += words(2);
			}
			return `${html}</${tag}>`;
		};
		const table = (): string => {
			const columns = 1 + r.int(3);
			const row = (cell: string) => `<tr>${Array.from({ length: columns }, () => `<${cell}>${r.chance(0.2) ? `<p>${inline()}</p><p>${words(2)}</p>` : inline()}</${cell}>`).join('')}</tr>`;
			return `<table>${r.chance(0.3) ? `<caption>${words(3)}</caption>` : ''}${r.chance(0.7) ? row('th') : ''}${Array.from({ length: 1 + r.int(3) }, () => row('td')).join('')}</table>`;
		};
		const block = (depth = 0): string => {
			switch (depth > 1 ? r.int(4) : r.int(11)) {
				case 0: return `<p>${inline()}</p>`;
				case 1: return `<div>${inline()}</div>`;
				case 2: return inline();
				case 3: {
					const level = 1 + r.int(4);
					return `<h${level}>${inline()}</h${level}>`;
				}
				case 4: return list(0);
				case 5: return `<blockquote>${Array.from({ length: 1 + r.int(3) }, () => block(depth + 1)).join('')}</blockquote>`;
				case 6: return table();
				case 7: return `<pre>${words(3)}\n${words(3)}${r.chance(0.5) ? `<br>${words(2)}` : ''}</pre>`;
				case 8: return `<b>${block(depth + 1)}${block(depth + 1)}</b>`;
				case 9: return `<dl><dt>${words(2)}</dt><dd>${inline()}</dd></dl>`;
				default: return `<section>${block(depth + 1)}${words(2)}</section><hr>`;
			}
		};
		return () => Array.from({ length: 2 + r.int(6) }, () => block()).join('');
	}

	/** The numbered words of a text, in the order they stand. */
	const numbered = (text: string) => text.match(/[a-z]+\d+/g) ?? [];

	const seeds = Array.from({ length: 60 }, (_v, i) => i + 1);

	it.each(seeds)('document %i: every word of the text is in the Markdown, in order', (seed) => {
		const html = builder(generator(seed))();
		const dom = el(html);
		// Link addresses carry a number of their own; they are not text.
		const out = htmlToMarkdown(dom).replace(/\]\(https:\/\/example\.test\/[^)]*\)/g, ']');
		expect(numbered(out), html).toEqual(numbered(dom.textContent || ''));
	});

	it('the documents do hold what they are meant to test', () => {
		const all = seeds.map((seed) => builder(generator(seed))()).join('');
		for (const part of ['</li><ul>', '</li><ol>', '<blockquote><', '<table>', '<caption>', '<pre>', '<a href', '<b><', '<br>', '<dl>']) {
			expect(all, part).toContain(part);
		}
	});

	it('hidden text is the one thing left out', () => {
		const dom = el('<p>shown1 <span hidden>hidden2</span> shown3</p><style>css4 {}</style><ul><li>shown5</li><ul><li>shown6</li></ul></ul>');
		expect(numbered(htmlToMarkdown(dom))).toEqual(['shown1', 'shown3', 'shown5', 'shown6']);
	});
});
