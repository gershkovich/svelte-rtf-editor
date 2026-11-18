import { describe, it, expect } from 'vitest';
import { rtfToHtml } from '../rtf-parser.js';
import { htmlToMarkdown } from '../utils.js';

/**
 * Text that htmlToMarkdown writes without escaping it: code, and what stands inside the <u> tag.
 * Code is safe only inside its code span or its fenced block, and a fence is a fence only at the
 * start of a line, under the same ">" marks as the line that opened it. Each test here is a shape
 * in which the code used to end up outside: read by a Markdown viewer that allows HTML, a line
 * such as <img onerror=…> in a document from another system would have run. Invented text.
 */

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const md = (html: string) => htmlToMarkdown(el(html));

/** What a hostile document carries, as it stands in the HTML and as it must never stand in the Markdown as markup. */
const HOSTILE_HTML = '&lt;img src=x onerror=alert(1)&gt;';
const HOSTILE = '<img src=x onerror=alert(1)>';

/**
 * The lines of a Markdown document on which "<img" would be read as HTML: outside a code span
 * and outside a fenced block, or inside a block of HTML. A small and strict reading of CommonMark,
 * enough for what the exporter writes. A line is taken as spaces, a list marker, ">" marks, spaces,
 * a list marker and text; a list item holds the lines indented as far as its own text; a fence
 * holds the lines under at least its own ">" marks and indented at least as far as its list item;
 * a line holding one tag and nothing else opens a block of HTML that runs to the next empty line;
 * a line of dashes and "|" under a line with a "|" opens a table, whose rows are cut into cells at
 * every "|" that is not escaped, code span or not.
 */
function readAsHtml(markdown: string): string[] {
	const found: string[] = [];
	let fence: { ticks: number; depth: number; outer: number; inner: number } | null = null;
	let htmlBlock = false;
	let table = false;
	let before = { text: '', full: '' };
	const outsideCode = (text: string) => text.replace(/(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g, '');
	const inCells = (text: string) => text.split(/(?<!\\)\|/).some((cell) => /(?<!\\)<img/.test(outsideCode(cell)));
	// Where the text of the list item we are in starts: before the ">" marks, and after them.
	let outerItem = 0;
	let innerItem = 0;
	for (const full of markdown.split(/\r\n|\r|\n/)) {
		let rest = full;
		const take = (pattern: RegExp) => {
			const taken = pattern.exec(rest)![0];
			rest = rest.slice(taken.length);
			return taken;
		};
		const s0 = take(/^ */).length;
		const item0 = take(/^(?:(?:[-+*]|\d{1,9}[.)]) +)?/).length;
		const depth = take(/^(?: {0,3}> ?)*/).split('>').length - 1;
		const s1 = take(/^ */).length;
		const item1 = take(/^(?:(?:[-+*]|\d{1,9}[.)]) +)?/).length;
		const text = rest;
		const blank = !text && !item0 && !item1;

		if (fence) {
			// A line under fewer ">" marks, or indented less than its list item, is outside the
			// quotation or the item, and so outside the code block that was in it.
			const indented = fence.depth ? s0 >= fence.outer && s1 >= fence.inner : s0 >= fence.outer + fence.inner;
			if (depth >= fence.depth && (blank || indented)) {
				if (/^`+\s*$/.test(text) && text.trim().length >= fence.ticks) fence = null;
				continue;
			}
			fence = null;
		}
		if (htmlBlock && !blank) {
			if (text.includes('<img')) found.push(full);
			continue;
		}
		htmlBlock = false;

		const delimiterRow = text.includes('|') && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(text);
		if (!table && delimiterRow && /(?<!\\)\|/.test(before.text)) {
			table = true;
			// The line above is the table's first row, and is cut into cells like the others.
			if (inCells(before.text) && !found.includes(before.full)) found.push(before.full);
		}
		if (blank) table = false;
		before = { text, full };
		if (table) {
			if (inCells(text)) found.push(full);
			continue;
		}

		if (!blank) {
			if (item0) [outerItem, innerItem] = [s0 + item0, 0];
			else if (s0 < outerItem) [outerItem, innerItem] = [0, 0];
			if (item1) innerItem = s1 + item1;
			else if (depth ? s1 < innerItem : s0 < outerItem + innerItem) innerItem = 0;
		}
		const opening = /^(`{3,})[^`]*$/.exec(text);
		// Four spaces further in than its list item, a fence is not a fence.
		const pad = item1 ? 0 : depth ? s1 - innerItem : item0 ? 0 : s0 - outerItem - innerItem;
		if (opening && pad < 4) {
			fence = { ticks: opening[1].length, depth, outer: s0 + item0, inner: s1 + item1 };
		} else if (/^<\/?[a-z][^<>]*>\s*$/i.test(text)) {
			htmlBlock = true;
			if (text.includes('<img')) found.push(full);
		} else if (/(?<!\\)<img/.test(outsideCode(text))) {
			found.push(full);
		}
	}
	return found;
}

describe('the test reads Markdown as a viewer does', () => {
	it('finds the shapes that were written through 1.9.0', () => {
		const was = [
			`See \`a\n\n${HOSTILE}\n\nb\` end\n\n`,
			`> \`\`\`\n${HOSTILE}\n\`\`\`\n\n`,
			`<u>\n\\${HOSTILE}\n</u>\n\n`,
			`# \`\`\`\n${HOSTILE}\n\`\`\`\n\n`,
			`**\`\`\`\n${HOSTILE}\n\`\`\`\n\n**`,
			`See\`\`\`\n${HOSTILE}\n\`\`\`\n\n`,
			`\\> \`\`\`\n${HOSTILE}\n\`\`\`\n\n`,
			// Found later, by an outside reader (see the last tests in this file).
			`\`\` ${HOSTILE}\` \`\`\`x\`\n\n`,
			`- <br>  \n  \\${HOSTILE}\n\n`,
			`a | b  \n--- | ---  \n\`x|${HOSTILE}\`\n\n`,
			`-3. \`\`\`\n    ${HOSTILE}\n    \`\`\`\n\n`,
			`1000000000. \`\`\`\n             ${HOSTILE}\n             \`\`\`\n\n`
		];
		for (const markdown of was) expect(readAsHtml(markdown), markdown).toHaveLength(1);
	});

	it('and passes code that is inside its span or its block', () => {
		const safe = [
			`See \`${HOSTILE}\` end\n\n`,
			`\`\`\`\n${HOSTILE}\n\`\`\`\n\n`,
			`> \`\`\`\n> ${HOSTILE}\n> \`\`\`\n\n`,
			`- \`\`\`\n  a\n\n  ${HOSTILE}\n  \`\`\`\n\n`,
			`- > \`\`\`\n  > ${HOSTILE}\n  > \`\`\`\n\n  tail\n\n`,
			`> - \`\`\`\n>   ${HOSTILE}\n>   \`\`\`\n\n`,
			`- - \`\`\`\n    ${HOSTILE}\n    \`\`\`\n\n`,
			`10. See \n\n    \`\`\`\n    ${HOSTILE}\n    \`\`\`\n\n    tail\n\n`,
			`\\${HOSTILE}\n\n`,
			`<u>\\${HOSTILE}</u>\n\n`,
			`| h |\n| --- |\n| \`a\\|${HOSTILE}\` x \\| y |\n\n`,
			`a \\| b  \n--- \\| ---  \n\`x|${HOSTILE}\`\n\n`,
			`- &nbsp;<br>  \n  \\${HOSTILE}\n\n`,
			`999999999. \`\`\`\n           ${HOSTILE}\n           \`\`\`\n\n`
		];
		for (const markdown of safe) expect(readAsHtml(markdown), markdown).toEqual([]);
	});
});

describe('htmlToMarkdown: a line break in code', () => {
	it('is a space in a code span, so an empty line does not end the span', () => {
		expect(md(`<p>See <code>a\n\n${HOSTILE_HTML}\n\nb</code> end</p>`)).toBe(`See \`a ${HOSTILE} b\` end\n\n`);
		expect(md('<p><code>one\r\ntwo\rthree</code></p>')).toBe('`one two three`\n\n');
	});

	it('a link written in code stays code', () => {
		expect(md('<p>See <code>a\n\n[Open results](javascript:alert(1))\n\nb</code></p>')).toBe(
			'See `a [Open results](javascript:alert(1)) b`\n\n'
		);
	});

	it('RTF with line breaks in a run of code exports as one code span', () => {
		// The reader now drops a line feed written as \'0a or \u10, as it does every control
		// character (#21), so none reaches the code span; before, each pair was a space here.
		const head = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}{\f1\fmodern Courier New;}}`;
		for (const lf of [String.raw`\'0a`, '\\u10?']) {
			const html = rtfToHtml(`${head}\\f0 See \\f1 a${lf}${lf}${HOSTILE}${lf}${lf}b\\f0  end\\par}`);
			expect(md(html), lf).toBe(`See \`a${HOSTILE}b\` end\n\n`);
		}
	});

	it('in a table cell a code span still has its pipes escaped', () => {
		expect(md('<table><tr><th>h</th></tr><tr><td><code>a\nb|c</code></td></tr></table>')).toBe('| h |\n| --- |\n| `a b\\|c` |\n\n');
	});
});

describe('htmlToMarkdown: a quotation', () => {
	it('marks every line, so a code block in it stays in it', () => {
		expect(md(`<blockquote><pre>${HOSTILE_HTML}</pre></blockquote>`)).toBe(`> \`\`\`\n> ${HOSTILE}\n> \`\`\`\n\n`);
		expect(md('<blockquote><pre>a\n\nb</pre></blockquote>')).toBe('> ```\n> a\n>\n> b\n> ```\n\n');
	});

	it('keeps its second paragraph, and a quotation inside it', () => {
		expect(md('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('> a\n>\n> b\n\n');
		expect(md('<blockquote>a<blockquote>b</blockquote></blockquote>')).toBe('> a\n>\n> > b\n\n');
	});

	it('starts a line of its own after text', () => {
		expect(md('Note<blockquote><p>q</p></blockquote>')).toBe('Note\n\n> q\n\n');
	});

	it('a carriage return in a code block is a line like any other', () => {
		expect(md('<blockquote><pre>a&#13;b&#13;&#10;c</pre></blockquote>')).toBe('> ```\n> a\n> b\n> c\n> ```\n\n');
		expect(md('<ul><li><pre>a&#13;b</pre></li></ul>')).toBe('- ```\n  a\n  b\n  ```\n\n');
	});
});

describe('htmlToMarkdown: a code block starts a line of its own', () => {
	const pre = `<pre>${HOSTILE_HTML}</pre>`;
	const fenced = `\`\`\`\n${HOSTILE}\n\`\`\`\n\n`;

	it('inside bold text and a link, whose marks are for text and are not written around code', () => {
		// These were "**", the block, "**", and "[", the block, "](address)": marks that marked nothing.
		expect(md(`<b>${pre}</b>`)).toBe(fenced);
		expect(md(`<a href="https://example.org/">${pre}</a>`)).toBe(fenced);
	});

	it('in a heading, which is one line, it is a code span on that line', () => {
		// This was "# ", an empty line and the block: a heading with nothing in it.
		expect(md(`<h1>${pre}</h1>`)).toBe(`# \`${HOSTILE}\`\n\n`);
	});

	it('after text that an element around it wrote', () => {
		expect(md(`<div>See<span>${pre}</span></div>`)).toBe(`See\n\n${fenced}`);
		expect(md(`<figure>See<span>${pre}</span></figure>`)).toBe(`See\n\n${fenced}`);
	});

	it('and where nothing stands before it, it adds no empty line', () => {
		expect(md(`<p>a</p>${pre}`)).toBe(`a\n\n${fenced}`);
		expect(md(`<div><span>${pre}</span></div>`)).toBe(fenced);
		expect(md(`<a href="javascript:x">${pre}</a>`)).toBe(fenced);
	});
});

describe('htmlToMarkdown: underline', () => {
	it('is the <u> tag around the text', () => {
		expect(md('<p>x <u>under</u> y</p>')).toBe('x <u>under</u> y\n\n');
		expect(md('<p><u>a<br>b</u></p>')).toBe('<u>a  \nb</u>\n\n');
	});

	it('never a tag alone on a line: a line break at either end is written outside it', () => {
		expect(md(`<p><u><br>${HOSTILE_HTML}<br></u></p>`)).toBe(`<u>\\${HOSTILE}</u>\n\n`);
		expect(md(`<p>See<u><br>${HOSTILE_HTML}<br></u>tail</p>`)).toBe(`See  \n<u>\\${HOSTILE}</u>  \ntail\n\n`);
		expect(md('<p>a<u> b </u>c</p>')).toBe('a <u>b</u> c\n\n');
		expect(md('<p>a<u> </u>b</p>')).toBe('a b\n\n');
		expect(md('<p><u><u><br>a</u></u></p>')).toBe('<u><u>a</u></u>\n\n');
		expect(md('<p>x<u><u><br>a</u></u></p>')).toBe('x  \n<u><u>a</u></u>\n\n');
	});

	it('is not written around a code block, and around a quotation, a list or a table it is written on the text inside', () => {
		expect(md(`<u><pre>${HOSTILE_HTML}</pre></u>`)).toBe(`\`\`\`\n${HOSTILE}\n\`\`\`\n\n`);
		expect(md(`<u><blockquote><pre>${HOSTILE_HTML}</pre></blockquote></u>`)).toBe(`> \`\`\`\n> ${HOSTILE}\n> \`\`\`\n\n`);
		// The underline was dropped here. It is kept, on the item's own text, where it is no tag
		// alone on a line.
		expect(md('<u><ul><li>a</li></ul></u>')).toBe('- <u>a</u>\n\n');
		expect(md(`<u><blockquote><p><br>${HOSTILE_HTML}</p></blockquote></u>`)).toBe(`> <u>\\${HOSTILE}</u>\n\n`);
		expect(md('<u><table><tr><th>h</th></tr></table></u>')).toBe('| <u>h</u> |\n| --- |\n\n');
	});

	it('the other tags Markdown has no mark for are written the same way', () => {
		for (const tag of ['ins', 'sup', 'sub']) {
			expect(md(`<p><${tag}><br>${HOSTILE_HTML}<br></${tag}></p>`), tag).toBe(`<${tag}>\\${HOSTILE}</${tag}>\n\n`);
			expect(md(`<p>a<${tag}> b </${tag}>c</p>`), tag).toBe(`a <${tag}>b</${tag}> c\n\n`);
		}
	});

	it('an empty line in a paragraph is a <br> at the end of the line before it, never on a line of its own', () => {
		expect(md(`<p>See<br><br>${HOSTILE_HTML}<br><br><br>tail</p>`)).toBe(`See<br>  \n\\${HOSTILE}<br><br>  \ntail\n\n`);
	});
});

describe('htmlToMarkdown: "-", ">" and "1." at the start of a line', () => {
	it('are text where the user typed them in a paragraph', () => {
		expect(md('<p>- Benign.</p>')).toBe('\\- Benign.\n\n');
		expect(md('<p>a<br>&gt; b<br>2) c</p>')).toBe('a  \n\\> b  \n2\\) c\n\n');
		expect(md('<div>+ d</div>')).toBe('\\+ d\n\n');
	});

	it('also when the mark and its text are in different elements', () => {
		expect(md('<p><span>-</span> a</p>')).toBe('\\- a\n\n');
		expect(md('<p><span>1</span>. a</p>')).toBe('1\\. a\n\n');
		expect(md('<p>12<span>) a</span></p>')).toBe('12\\) a\n\n');
	});

	it('and not where other text stands before them on the line', () => {
		expect(md('<p>a - b</p>')).toBe('a - b\n\n');
		expect(md('<p><b>- a</b></p>')).toBe('**- a**\n\n');
		expect(md('<p>v1<span>. a</span></p>')).toBe('v1. a\n\n');
	});

	it('are markup where a list or a quotation in a <div> wrote them', () => {
		expect(md('<div><ul><li>a</li></ul></div>')).toBe('- a\n\n');
		expect(md('<div><ol start="3"><li>a</li></ol></div>')).toBe('3. a\n\n');
		expect(md('<div><blockquote>q</blockquote></div>')).toBe('> q\n\n');
		expect(md(`<div><blockquote><pre>${HOSTILE_HTML}</pre></blockquote></div>`)).toBe(`> \`\`\`\n> ${HOSTILE}\n> \`\`\`\n\n`);
	});

	it('and the text of a list item in a <div> is still text', () => {
		expect(md('<div><ul><li>- a</li></ul></div>')).toBe('- \\- a\n\n');
	});
});

describe('htmlToMarkdown: no shape of elements lets code or text out as HTML', () => {
	const wrappers: [string, string][] = [
		['<h2>', '</h2>'],
		['<p>', '</p>'],
		['<div>', '</div>'],
		['<span>', '</span>'],
		['<b>', '</b>'],
		['<em>', '</em>'],
		['<u>', '</u>'],
		['<ins>', '</ins>'],
		['<sup>', '</sup>'],
		['<sub>', '</sub>'],
		['<del>', '</del>'],
		['<s>', '</s>'],
		['<a href="https://example.org/">', '</a>'],
		['<a href="javascript:x">', '</a>'],
		['<blockquote>', '</blockquote>'],
		['<ul><li>', '</li></ul>'],
		['<ol start="9"><li>first</li><li>', '</li></ol>'],
		['<figure>', '<figcaption>cap</figcaption></figure>'],
		['<table><tr><td>', '</td><td>x</td></tr></table>']
	];
	const contents = [
		`<pre>${HOSTILE_HTML}</pre>`,
		`<pre>a\n\n${HOSTILE_HTML}&#13;${HOSTILE_HTML}\n\`\`\`\n${HOSTILE_HTML}</pre>`,
		`<code>a\n\n${HOSTILE_HTML}\n\nb</code>`,
		`<code>\`\n${HOSTILE_HTML}\`\`</code>`,
		`<br>${HOSTILE_HTML}<br>`,
		`<u><br>${HOSTILE_HTML}<br></u>`,
		`<br><br>${HOSTILE_HTML}<br><br>`,
		`<sup><br><br>${HOSTILE_HTML}</sup>`,
		`<span style="white-space:pre">\n\n${HOSTILE_HTML}\n\n</span>`
	];
	const leads = ['', 'See ', 'See<br>', '<u>x</u>'];

	it('one or two elements around code, a line of text and an underline', () => {
		let cases = 0;
		for (const [openA, closeA] of wrappers) {
			for (const [openB, closeB] of [['', ''], ...wrappers]) {
				for (const content of contents) {
					for (const lead of leads) {
						const html = `${openA}${lead}${openB}${content}${closeB}tail${closeA}<p>after</p>`;
						const markdown = md(html);
						expect(readAsHtml(markdown), `${html}\n→ ${JSON.stringify(markdown)}`).toEqual([]);
						// Nothing is lost on the way: the text is there, as code or escaped.
						expect(markdown, html).toContain('img src=x onerror=alert(1)>');
						cases++;
					}
				}
			}
		}
		expect(cases).toBe(wrappers.length * (wrappers.length + 1) * contents.length * leads.length);
		// Some thirteen thousand documents: four seconds on a desk, ten on a build machine,
		// where the usual five seconds for a test are not enough.
	}, 120_000);
});

describe('htmlToMarkdown: what an outside reader found (pandoc, as CommonMark and as GitHub Markdown)', () => {
	// A second review rendered what the export writes with a Markdown reader that is not ours.
	// Each test here is a shape in which a line of the document came out as HTML there.
	const TAB = '<span style="white-space:pre">\t</span>';

	describe('code right after code is one code span', () => {
		it('two spans back to back ran their backticks together', () => {
			// They were written "`a``b`", which shows as one span holding a``b.
			expect(md('<p><code>a</code><code>b</code></p>')).toBe('`ab`\n\n');
			expect(md('<p><code>a</code><code>b</code><code>c</code> d</p>')).toBe('`abc` d\n\n');
		});

		it('with a backtick at the end of the first, the code was out of its span', () => {
			const markdown = md(`<p><code>${HOSTILE_HTML}\`</code><code>x</code></p>`);
			expect(markdown).toBe(`\`\`${HOSTILE}\`x\`\`\n\n`);
			expect(readAsHtml(markdown)).toEqual([]);
		});

		it('RTF makes this of code text that changes color', () => {
			const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}{\f1\fmodern Courier New;}}{\colortbl;\red255\green0\blue0;}\f1 abc\cf1 def\cf0 ghi\par}`;
			expect(md(rtfToHtml(rtf))).toBe('`abcdefghi`\n\n');
		});

		it('code after code in the same formatting is one span inside it; apart, they stay two', () => {
			expect(md('<p><i><code>a</code></i><i><code>b</code></i></p>')).toBe('*`ab`*\n\n');
			expect(md('<p><code>a</code> <code>b</code></p>')).toBe('`a` `b`\n\n');
			expect(md('<p><b><code>a</code></b><code>b</code></p>')).toBe('**`a`**`b`\n\n');
			expect(md('<p><code>a</code>x<code>b</code></p>')).toBe('`a`x`b`\n\n');
		});

		it('in a table cell the pipes of both are still escaped', () => {
			expect(md('<table><tr><th>h</th></tr><tr><td><code>a|</code><code>|b</code></td></tr></table>')).toBe('| h |\n| --- |\n| `a\\|\\|b` |\n\n');
		});
	});

	describe('a line that holds white space alone', () => {
		it('is written as &nbsp;, so the <br> after it does not stand first on its line', () => {
			// A list item trimmed the no-break space away, and the line began with <br>.
			for (const blank of ['&nbsp;', TAB, '&emsp;']) {
				const markdown = md(`<ul><li>${blank}<br><br>${HOSTILE_HTML}</li></ul>`);
				expect(markdown, blank).toBe(`- &nbsp;<br>  \n  \\${HOSTILE}\n\n`);
				expect(readAsHtml(markdown), blank).toEqual([]);
			}
			expect(md(`<blockquote>${TAB}<br><br>${HOSTILE_HTML}</blockquote>`)).toBe(`> &nbsp;<br>  \n> \\${HOSTILE}\n\n`);
			expect(md(`<p>a<br>${TAB}<br><br>b</p>`)).toBe('a  \n&nbsp;<br>  \nb\n\n');
		});

		it('a paragraph of one no-break space, which is how an empty line is often pasted, is still a paragraph', () => {
			expect(md('<p>&nbsp;</p><p>x</p>')).toBe('&nbsp;\n\nx\n\n');
		});

		it('a tab at the start of a line is written as &#9;: as a tab it made the line a code block', () => {
			// The line then showed with its backslashes.
			expect(md(`<p>${TAB}&lt;b&gt; 2*3 [x]</p>`)).toBe('&#9;\\<b> 2\\*3 \\[x\\]\n\n');
			expect(md(`<p>a<br>${TAB}b</p>`)).toBe('a  \n&#9;b\n\n');
			expect(md(`<p>a${TAB}b</p>`)).toBe('a\tb\n\n');
		});

		it('a list item keeps the no-break space it starts with', () => {
			expect(md('<ul><li>&nbsp;a</li></ul>')).toBe(`- ${String.fromCharCode(0xa0)}a\n\n`);
		});
	});

	describe('a "|" in text', () => {
		it('is escaped everywhere: two typed lines were read as a table', () => {
			// A viewer that knows tables showed two columns and dropped "strong, diffuse".
			expect(md('<p>Stain | Result<br>--- | ---<br>CK7 | positive | strong, diffuse</p>')).toBe(
				'Stain \\| Result  \n--- \\| ---  \nCK7 \\| positive \\| strong, diffuse\n\n'
			);
		});

		it('so a code span under such lines is not cut at its own "|"', () => {
			const markdown = md(`<p>a | b<br>--- | ---<br><code>x|${HOSTILE_HTML}</code></p>`);
			expect(markdown).toBe(`a \\| b  \n--- \\| ---  \n\`x|${HOSTILE}\`\n\n`);
			expect(readAsHtml(markdown)).toEqual([]);
		});

		it('in a description of a picture and in the text of a link too', () => {
			expect(md('<p><img alt="a | b" src="https://x.test/i.png"> <a href="https://x.test/">c | d</a></p>')).toBe(
				'![a \\| b](https://x.test/i.png) [c \\| d](https://x.test/)\n\n'
			);
		});
	});

	describe('a list number Markdown cannot write', () => {
		const item = `<li><pre>${HOSTILE_HTML}</pre></li><li>b</li>`;

		it('below zero: the list counts from 0', () => {
			// "-3." is no marker; the item was a paragraph and its code block was not one.
			const markdown = md(`<ol start="-3">${item}</ol>`);
			expect(markdown).toBe(`0. \`\`\`\n   ${HOSTILE}\n   \`\`\`\n1. b\n\n`);
			expect(readAsHtml(markdown)).toEqual([]);
		});

		it('of more than nine digits, or reaching them on the way: the list ends at 999999999', () => {
			for (const start of ['1000000000', '999999999', '123456789012345678901234567890']) {
				const markdown = md(`<ol start="${start}">${item}</ol>`);
				expect(markdown, start).toBe(`999999998. \`\`\`\n           ${HOSTILE}\n           \`\`\`\n999999999. b\n\n`);
				expect(readAsHtml(markdown), start).toEqual([]);
			}
		});

		it('a number it can write is kept', () => {
			expect(md('<ol start="0"><li>a</li></ol>')).toBe('0. a\n\n');
			expect(md('<ol start="999999998"><li>a</li><li>b</li></ol>')).toBe('999999998. a\n999999999. b\n\n');
		});
	});

	it('U+2028 in code is not taken for the start of a line', () => {
		// The marks after it were escaped inside the span, where a backslash shows.
		const separator = String.fromCharCode(0x2028);
		expect(md(`<p><code>a${separator}- b${separator}1. c</code></p>`)).toBe(`\`a${separator}- b${separator}1. c\`\n\n`);
		expect(md('<p>a<br>- b</p>')).toBe('a  \n\\- b\n\n');
	});

	it('a long run of spaces inside underlined, linked or bold text does not take a second', () => {
		// Timed against a quarter of the run, not against the clock. It was sixteen times as long.
		const spaces = (count: number) => el(`<p><u>a${'&nbsp;'.repeat(count)}b</u> <a href="https://x.test/">a${'&nbsp;'.repeat(count)}b</a></p>`);
		const timeOf = (root: HTMLElement) => {
			const once = () => {
				const start = performance.now();
				htmlToMarkdown(root);
				return performance.now() - start;
			};
			return Math.min(once(), once(), once());
		};
		const [small, large] = [spaces(10_000), spaces(40_000)];
		expect(timeOf(large)).toBeLessThan(Math.max(timeOf(small), 5) * 8);
	}, 60_000);

	it('none of these shapes, around and inside the others, lets code or text out as HTML', () => {
		const wrappers: [string, string][] = [
			['<p>', '</p>'],
			['<div>', '</div>'],
			['<b>', '</b>'],
			['<u>', '</u>'],
			['<sup>', '</sup>'],
			['<a href="https://example.org/">', '</a>'],
			['<blockquote>', '</blockquote>'],
			['<ul><li>', '</li></ul>'],
			['<ol start="-3"><li>', '</li><li>x</li></ol>'],
			['<ol start="1000000000"><li>first</li><li>', '</li></ol>'],
			['<h2>', '</h2>'],
			['<figure>', '<figcaption>cap</figcaption></figure>'],
			['<table><tr><td>', '</td><td>x</td></tr></table>']
		];
		const contents = [
			`<code>${HOSTILE_HTML}\`</code><code>x</code>`,
			`<code>\`</code><code>${HOSTILE_HTML}</code><code>\`\`</code>`,
			`<code>x|${HOSTILE_HTML}</code>`,
			`<pre>${HOSTILE_HTML}\n\nx</pre>`,
			`<br><br>${HOSTILE_HTML}<br><br>`
		];
		const leads = ['', '&nbsp;<br>', `${TAB}<br>`, TAB, '&nbsp;', 'a | b<br>--- | ---<br>', '| a |<br>|---|<br>'];
		let cases = 0;
		for (const [openA, closeA] of wrappers) {
			for (const [openB, closeB] of [['', ''], ...wrappers]) {
				for (const content of contents) {
					for (const lead of leads) {
						const html = `${openA}${lead}${openB}${lead}${content}${closeB}tail${closeA}<p>after</p>`;
						const markdown = md(html);
						expect(readAsHtml(markdown), `${html}\n→ ${JSON.stringify(markdown)}`).toEqual([]);
						expect(markdown, html).toContain('img src=x onerror=alert(1)>');
						cases++;
					}
				}
			}
		}
		expect(cases).toBe(wrappers.length * (wrappers.length + 1) * contents.length * leads.length);
	}, 120_000);
});
