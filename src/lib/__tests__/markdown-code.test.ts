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
 * a line holding one tag and nothing else opens a block of HTML that runs to the next empty line.
 */
function readAsHtml(markdown: string): string[] {
	const found: string[] = [];
	let fence: { ticks: number; depth: number; outer: number; inner: number } | null = null;
	let htmlBlock = false;
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
		const item0 = take(/^(?:(?:[-+*]|\d+[.)]) +)?/).length;
		const depth = take(/^(?: {0,3}> ?)*/).split('>').length - 1;
		const s1 = take(/^ */).length;
		const item1 = take(/^(?:(?:[-+*]|\d+[.)]) +)?/).length;
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
		} else {
			const outsideCode = text.replace(/(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g, '');
			if (/(?<!\\)<img/.test(outsideCode)) found.push(full);
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
			`\\> \`\`\`\n${HOSTILE}\n\`\`\`\n\n`
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
			`<u>\\${HOSTILE}</u>\n\n`
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
		const head = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}{\f1\fmodern Courier New;}}`;
		for (const lf of [String.raw`\'0a`, '\\u10?']) {
			const html = rtfToHtml(`${head}\\f0 See \\f1 a${lf}${lf}${HOSTILE}${lf}${lf}b\\f0  end\\par}`);
			expect(md(html), lf).toBe(`See \`a ${HOSTILE} b\` end\n\n`);
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

	it('inside a heading, bold text and a link', () => {
		expect(md(`<h1>${pre}</h1>`)).toBe(`# \n\n${fenced}\n\n`);
		expect(md(`<b>${pre}</b>`)).toBe(`**\n\n${fenced}**`);
		expect(md(`<a href="https://example.org/">${pre}</a>`)).toBe(`[\n\n${fenced}](https://example.org/)`);
	});

	it('after text that an element around it wrote', () => {
		expect(md(`<div>See<span>${pre}</span></div>`)).toBe(`See\n\n${fenced}\n`);
		expect(md(`<figure>See<span>${pre}</span></figure>`)).toBe(`See\n\n${fenced}`);
	});

	it('and where nothing stands before it, it adds no empty line', () => {
		expect(md(`<p>a</p>${pre}`)).toBe(`a\n\n${fenced}`);
		expect(md(`<div><span>${pre}</span></div>`)).toBe(`${fenced}\n`);
		expect(md(`<a href="javascript:x">${pre}</a>`)).toBe(fenced);
	});
});

describe('htmlToMarkdown: underline', () => {
	it('is the <u> tag around the text', () => {
		expect(md('<p>x <u>under</u> y</p>')).toBe('x <u>under</u> y\n\n');
		expect(md('<p><u>a<br>b</u></p>')).toBe('<u>a\nb</u>\n\n');
	});

	it('never a tag alone on a line: a line break at either end is written outside it', () => {
		expect(md(`<p><u><br>${HOSTILE_HTML}<br></u></p>`)).toBe(`\n<u>\\${HOSTILE}</u>\n\n\n`);
		expect(md('<p>a<u> b </u>c</p>')).toBe('a <u>b</u> c\n\n');
		expect(md('<p>a<u> </u>b</p>')).toBe('a b\n\n');
		expect(md('<p><u><u><br>a</u></u></p>')).toBe('\n<u><u>a</u></u>\n\n');
	});

	it('is not written around a code block, a quotation, a list or a table', () => {
		expect(md(`<u><pre>${HOSTILE_HTML}</pre></u>`)).toBe(`\`\`\`\n${HOSTILE}\n\`\`\`\n\n`);
		expect(md(`<u><blockquote><pre>${HOSTILE_HTML}</pre></blockquote></u>`)).toBe(`> \`\`\`\n> ${HOSTILE}\n> \`\`\`\n\n`);
		expect(md('<u><ul><li>a</li></ul></u>')).toBe('- a\n\n');
	});
});

describe('htmlToMarkdown: "-", ">" and "1." at the start of a line', () => {
	it('are text where the user typed them in a paragraph', () => {
		expect(md('<p>- Benign.</p>')).toBe('\\- Benign.\n\n');
		expect(md('<p>a<br>&gt; b<br>2) c</p>')).toBe('a\n\\> b\n2\\) c\n\n');
		expect(md('<div>+ d</div>')).toBe('\\+ d\n');
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
		expect(md('<div><ul><li>a</li></ul></div>')).toBe('- a\n\n\n');
		expect(md('<div><ol start="3"><li>a</li></ol></div>')).toBe('3. a\n\n\n');
		expect(md('<div><blockquote>q</blockquote></div>')).toBe('> q\n\n\n');
		expect(md(`<div><blockquote><pre>${HOSTILE_HTML}</pre></blockquote></div>`)).toBe(`> \`\`\`\n> ${HOSTILE}\n> \`\`\`\n\n\n`);
	});

	it('and the text of a list item in a <div> is still text', () => {
		expect(md('<div><ul><li>- a</li></ul></div>')).toBe('- \\- a\n\n\n');
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
	});
});
