import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * Documents put together at random from everything the editor can hold: nested formats, links,
 * code, headings, lists inside lists, quotations, rules, and tables with merged cells and blocks
 * in their cells. No single case here is interesting; what is checked is what must hold for all of
 * them:
 *
 * - no character of the text is lost between the HTML, the RTF and the HTML read back from it;
 * - a document settles: after one reload it is written the same, save after save;
 * - the RTF is one line of plain ASCII with balanced braces;
 * - the size estimate is never below the real size;
 * - what the reader returns is made only of elements it is known to produce.
 *
 * A second set is the same blocks as a paste brings them: inside the elements of a web page, with
 * formatting set by styles, with captions, hidden elements and text typed in a figure.
 *
 * The generator is seeded, so a failure names a document that can be built again. Invented text.
 */

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

const WORDS = [
	'benign', 'margin', 'café', 'naïve', 'Größe', '漢字', '\u{1F600}', 'a\\b', '{brace}', '&amp;', '&lt;tag&gt;',
	'"quoted"', 'it’s', 'x*y', 'node', 'tissue', 'section', 'left', 'colon', 'O’Neil', '§'
];

function words(r: Random, max = 4): string {
	return Array.from({ length: 1 + r.int(max) }, () => r.pick(WORDS)).join(' ');
}

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function inline(r: Random, depth: number): string {
	if (depth <= 0 || r.chance(0.45)) return words(r);
	const inner = () => inline(r, depth - 1);
	switch (r.int(16)) {
		case 0: return `<b>${inner()}</b>`;
		case 1: return `<em>${inner()}</em>`;
		case 2: return `<u>${inner()}</u>`;
		case 3: return `<s>${inner()}</s>`;
		case 4: return `<sup>${inner()}</sup>`;
		case 5: return `<sub>${inner()}</sub>`;
		case 6: return `<code>${inner()}</code>`;
		case 7: return `<span style="color:${r.pick(['red', '#00f', 'rgb(0,128,0)', 'black'])}">${inner()}</span>`;
		case 8: return `<span style="font-size:${r.pick([8, 9, 12, 14, 18, 24])}pt">${inner()}</span>`;
		case 9: return `<a href="${r.pick(['https://x.test/a?b=1&amp;c=2', 'mailto:lab@x.test', 'javascript:alert(1)', '/relative'])}">${inner()}</a>`;
		case 10: return `${inner()}<br>${inner()}`;
		case 11: return `${inner()}<span style="white-space:pre">\t</span>${inner()}`;
		case 12: return `<font color="${r.pick(['#ff0000', 'blue'])}">${inner()}</font>`;
		case 13: return `${inner()}&nbsp;${r.pick(['', ' '])}<b> </b>${inner()}`;
		case 14: return `<b>${inner()}<br></b>`;
		default: return `${inner()} ${inner()}`;
	}
}

function list(r: Random, depth: number): string {
	const tag = r.pick(['ul', 'ol']);
	const attrs = tag === 'ol' && r.chance(0.3) ? ` start="${1 + r.int(40)}"` : '';
	const items = Array.from({ length: 1 + r.int(3) }, () => {
		const text = r.chance(0.2) ? `<p>${inline(r, 1)}</p>` : r.chance(0.1) ? '' : inline(r, 1);
		const nested = depth > 0 && r.chance(0.3) ? list(r, depth - 1) : '';
		const tail = nested && r.chance(0.2) ? words(r, 2) : r.chance(0.1) ? '<br>' : '';
		const quote = depth > 0 && r.chance(0.08) ? `<blockquote>${words(r, 2)}</blockquote>` : '';
		return `<li>${text}${quote}${nested}${tail}</li>`;
	});
	// A list written straight inside a list, as some editors nest them.
	if (depth > 0 && r.chance(0.1)) items.splice(1, 0, list(r, depth - 1));
	return `<${tag}${attrs}>${items.join(r.pick(['', '\n  ']))}</${tag}>`;
}

/** A table whose cells cover its grid exactly, some of them merged across columns or down rows. */
function table(r: Random, depth: number): string {
	const rowCount = 1 + r.int(4);
	const colCount = 1 + r.int(4);
	const taken = Array.from({ length: rowCount }, () => new Array<boolean>(colCount).fill(false));
	const widths = r.chance(0.3);
	let html = r.pick(['<table>', '<table><tbody>']);
	for (let row = 0; row < rowCount; row++) {
		html += '<tr>';
		for (let col = 0; col < colCount; col++) {
			if (taken[row][col]) continue;
			let colspan = 1;
			while (col + colspan < colCount && !taken[row][col + colspan] && r.chance(0.2)) colspan++;
			let rowspan = 1;
			while (row + rowspan < rowCount && r.chance(0.2)) rowspan++;
			for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) taken[row + dr][col + dc] = true;
			const tag = row === 0 && r.chance(0.4) ? 'th' : 'td';
			const styles = [
				r.chance(0.2) ? `text-align:${r.pick(['right', 'center', 'left'])}` : '',
				widths && colspan === 1 ? `width:${r.pick([10, 20, 25, 33.3, 50])}%` : ''
			].filter(Boolean);
			const style = styles.length ? ` style="${styles.join(';')}"` : '';
			const spans = `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
			const content = depth > 0 && r.chance(0.25)
				? Array.from({ length: 1 + r.int(2) }, () => block(r, depth - 1)).join('')
				: r.chance(0.1) ? '' : inline(r, 1);
			html += `<${tag}${spans}${style}>${content}</${tag}>`;
		}
		html += '</tr>';
		// A row short of cells: the writer fills it.
		if (r.chance(0.05)) html += `<tr><td>${words(r, 2)}</td></tr>`;
	}
	return `${html}</table>`;
}

function block(r: Random, depth: number): string {
	switch (r.int(16)) {
		case 0: {
			const level = 1 + r.int(6);
			const align = r.chance(0.2) ? ' style="text-align:center"' : '';
			return `<h${level}${align}>${inline(r, 1)}</h${level}>`;
		}
		case 1: return list(r, depth);
		case 2: return `<blockquote>${r.chance(0.5) ? inline(r, 1) : `<p>${inline(r, 1)}</p>${depth > 0 ? block(r, depth - 1) : ''}`}</blockquote>`;
		case 3: return `<pre>${words(r)}\n  ${words(r)}${r.pick(['', '\n\n' + words(r, 2)])}</pre>`;
		case 4: return r.pick(['<hr>', '<hr>', '<hr style="break-after:page">']);
		case 5: return depth > 0 ? table(r, depth - 1) : `<p>${inline(r, 2)}</p>`;
		case 6: return `<p style="text-align:${r.pick(['center', 'right', 'justify'])}">${inline(r, 2)}</p>`;
		case 7: return `<p style="margin-left:${r.pick(['36pt', '48px', '0.5in'])};text-indent:-18pt">${inline(r, 2)}</p>`;
		case 8: return r.pick(['<p><br></p>', '<p></p>', '<div><br></div>', '<p><b><br></b></p>']);
		case 9: return `<div>${inline(r, 2)}</div>`;
		case 10: return `<p>${inline(r, 2)}<br></p>`;
		case 11: return `<figure${r.pick(['', ' style="text-align:center"'])}><img src="${PNG}" style="width:10px;height:auto" alt=""><figcaption>${r.chance(0.5) ? words(r, 3) : ''}</figcaption></figure>`;
		case 12: return depth > 0 ? `<div style="margin-left:48px">${block(r, depth - 1)}${block(r, depth - 1)}</div>` : `<p>${words(r)}</p>`;
		case 13: return `${words(r, 2)}${r.pick(['', '<br>'])}`; // text with no paragraph of its own
		default: return `<p>${inline(r, 3)}</p>`;
	}
}

/** One of the shapes a paste brings, around or beside the blocks the editor makes itself. */
function pastedBlock(r: Random, depth: number): string {
	const inner = () => (depth > 0 ? pastedBlock(r, depth - 1) : block(r, 0));
	switch (r.int(14)) {
		case 0: {
			const tag = r.pick(['section', 'article', 'main', 'aside']);
			return `<${tag}>${inner()}${inner()}</${tag}>`;
		}
		case 1: return `<div style="text-align:${r.pick(['center', 'right'])}">${inner()}${words(r, 2)}${inner()}</div>`;
		case 2: return `<center>${r.chance(0.5) ? words(r, 3) : inner()}</center>`;
		case 3: return `<dl><dt>${words(r, 2)}</dt><dd>${inline(r, 1)}</dd><dt>${words(r, 2)}</dt><dd>${inline(r, 1)}</dd></dl>`;
		case 4: {
			const style = () =>
				[
					`font-weight:${r.pick(['700', '400', 'bold', 'normal'])}`,
					`font-style:${r.pick(['italic', 'normal'])}`,
					`text-decoration:${r.pick(['underline', 'none', 'line-through'])}`,
					`vertical-align:${r.pick(['baseline', 'super', 'sub'])}`
				].join(';');
			const around = r.pick(['b', 'i', 'sup', 'u']);
			return `<p>${words(r, 2)} <span style="${style()}">${inline(r, 1)}</span> <${around}><span style="${style()}">${words(r, 2)}</span>${words(r, 1)}</${around}></p>`;
		}
		// The wrapper Google Docs puts around a paste.
		case 5: return `<b style="font-weight:normal" id="docs-internal-guid-${r.int(100)}">${inner()}${inner()}</b>`;
		case 6: return table(r, 1).replace(/^<table>/, `<table><caption>${words(r, 3)}</caption>`);
		case 7: {
			const picture = `<img src="${PNG}" style="width:10px;height:auto" alt="">`;
			return `<figure>${r.pick(['', `${words(r, 2)} `])}${picture}${r.pick(['', picture])} ${words(r, 2)}<figcaption>${words(r, 2)}</figcaption></figure>`;
		}
		case 8:
			return `<style>p { color: red }</style><p>${words(r, 2)}<span style="display:none">not shown</span><span hidden>nor this</span><span style="mso-hide:all">nor this</span> ${words(r, 2)}</p><p hidden>gone</p>`;
		case 9: return `<p style="white-space:pre-wrap">${words(r, 3)}\n${words(r, 2)}\n\n${words(r, 2)}</p>`;
		case 10:
			return `<h2 style="color:red">${inline(r, 1)}</h2><ul><li style="color:blue;font-weight:bold">${inline(r, 1)}</li><li>${words(r, 2)}</li></ul><table><tr><td style="color:#00f">${words(r, 2)}</td><td style="width:${r.pick([60, 120])}px">${words(r, 1)}</td></tr></table>`;
		case 11: return `<details><summary>${words(r, 2)}</summary>${words(r, 3)}</details><address>${words(r, 2)}<br>${words(r, 2)}</address>`;
		case 12: return `${table(r, 1)}${words(r, 2)}`;
		default: return block(r, depth);
	}
}

function pastedDocumentHtml(seed: number): string {
	const r = generator(seed);
	return Array.from({ length: 1 + r.int(5) }, () => pastedBlock(r, 2)).join(r.pick(['', '\n']));
}

function documentHtml(seed: number): string {
	const r = generator(seed);
	return Array.from({ length: 1 + r.int(6) }, () => block(r, 2)).join(r.pick(['', '\n']));
}

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const write = (html: string) => htmlToRtf(el(html));
/** The text of a document without what a reload may respell: spaces, list markers, rule dashes. */
const letters = (html: string) => (el(html).textContent || '').replace(/[\s •—]|\d+\./g, '');
/** The same, of the text the screen shows: without the elements a paste brings hidden. */
const shownLetters = (html: string) => {
	const dom = el(html);
	for (const hidden of Array.from(dom.querySelectorAll('style, [hidden], [style*="display:none"], [style*="mso-hide"]'))) hidden.remove();
	return letters(dom.innerHTML);
};

const KNOWN_TAGS = new Set([
	'P', 'BR', 'STRONG', 'EM', 'U', 'S', 'SUP', 'SUB', 'SPAN', 'H1', 'H2', 'H3', 'HR', 'TABLE', 'TBODY', 'TR', 'TD', 'TH',
	'FIGURE', 'FIGCAPTION', 'IMG', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'A'
]);

/**
 * How many documents of each set, and the seed of the first. 400 run with the suite. For a longer
 * run, in batches the test environment has memory for:
 *   RTF_RANDOM_DOCUMENTS=1000 RTF_RANDOM_FIRST=1001 npx vitest run random-documents
 */
const COUNT = Number(process.env.RTF_RANDOM_DOCUMENTS) || 400;
const FIRST = Number(process.env.RTF_RANDOM_FIRST) || 1;

describe(`${COUNT} random documents`, () => {
	const documents = Array.from({ length: COUNT }, (_, i) => ({ seed: FIRST + i, html: documentHtml(FIRST + i) }));

	it('use every construct, so the checks below mean something', () => {
		const all = documents.map((d) => d.html).join('');
		for (const part of ['<ul>', '<ol start=', '<li><p>', 'rowspan=', 'colspan=', '<th', '<pre>', '<hr>', '<blockquote>', '<h5>', '<a href="https', '<code>', 'text-align:right']) {
			expect(all, part).toContain(part);
		}
	});

	it('lose no character of their text on the way to RTF and back', () => {
		for (const { seed, html } of documents) {
			expect(letters(rtfToHtml(write(html))), `seed ${seed}: ${html}`).toBe(letters(html));
		}
	});

	it('settle: after one reload each is written the same, save after save', () => {
		for (const { seed, html } of documents) {
			const second = write(rtfToHtml(write(html)));
			const third = write(rtfToHtml(second));
			expect(third, `seed ${seed}: ${html}`).toBe(second);
		}
	});

	it('are written as one line of ASCII with balanced braces', () => {
		for (const { seed, html } of documents) {
			const rtf = write(html);
			expect(rtf, `seed ${seed}`).toMatch(/^[\x20-\x7e]*$/);
			let depth = 0;
			for (let i = 0; i < rtf.length; i++) {
				if (rtf[i] === '\\') i++;
				else if (rtf[i] === '{') depth++;
				else if (rtf[i] === '}') depth--;
				if (depth < 1 && i < rtf.length - 1) throw new Error(`seed ${seed}: the document closes early at ${i}`);
			}
			expect(depth, `seed ${seed}`).toBe(0);
		}
	});

	it('are never larger than their size estimate', () => {
		for (const { seed, html } of documents) {
			const dom = el(html);
			expect(estimateRtfBytes(dom), `seed ${seed}: ${html}`).toBeGreaterThanOrEqual(htmlToRtf(dom).length);
		}
	});

	it('read back as elements the reader is known to produce, and no unsafe link', () => {
		for (const { seed, html } of documents) {
			const back = el(rtfToHtml(write(html)));
			const unknown = Array.from(back.querySelectorAll('*'), (node) => node.tagName).filter((tag) => !KNOWN_TAGS.has(tag));
			expect(unknown, `seed ${seed}: ${html}`).toEqual([]);
			const unsafe = Array.from(back.querySelectorAll('a'), (a) => a.getAttribute('href') || '').filter(
				(href) => !/^(https:\/\/x\.test\/|mailto:)/.test(href)
			);
			expect(unsafe, `seed ${seed}: ${html}`).toEqual([]);
		}
	});
});

describe(`${COUNT} random documents as a paste brings them`, () => {
	const documents = Array.from({ length: COUNT }, (_, i) => ({ seed: FIRST + i, html: pastedDocumentHtml(FIRST + i) }));

	it('use every pasted shape, so the checks below mean something', () => {
		const all = documents.map((d) => d.html).join('');
		for (const part of ['<section>', '<center>', '<dl>', 'font-weight:700', 'vertical-align:super', 'docs-internal-guid', '<caption>', '<figure>', 'display:none', 'pre-wrap', '<li style="color', '<details>', '</table>']) {
			expect(all, part).toContain(part);
		}
	});

	it('lose no character of the text that shows, and write none of the text that does not', () => {
		for (const { seed, html } of documents) {
			expect(letters(rtfToHtml(write(html))), `seed ${seed}: ${html}`).toBe(shownLetters(html));
		}
	});

	it('settle: after one reload each is written the same, save after save', () => {
		for (const { seed, html } of documents) {
			const second = write(rtfToHtml(write(html)));
			const third = write(rtfToHtml(second));
			expect(third, `seed ${seed}: ${html}`).toBe(second);
		}
	});

	it('are written as one line of ASCII with balanced braces, and are never larger than their size estimate', () => {
		for (const { seed, html } of documents) {
			const dom = el(html);
			const rtf = htmlToRtf(dom);
			expect(rtf, `seed ${seed}`).toMatch(/^[\x20-\x7e]*$/);
			let depth = 0;
			for (let i = 0; i < rtf.length; i++) {
				if (rtf[i] === '\\') i++;
				else if (rtf[i] === '{') depth++;
				else if (rtf[i] === '}') depth--;
				if (depth < 1 && i < rtf.length - 1) throw new Error(`seed ${seed}: the document closes early at ${i}`);
			}
			expect(depth, `seed ${seed}`).toBe(0);
			expect(estimateRtfBytes(dom), `seed ${seed}: ${html}`).toBeGreaterThanOrEqual(rtf.length);
		}
	});

	it('read back as elements the reader is known to produce', () => {
		for (const { seed, html } of documents) {
			const unknown = Array.from(el(rtfToHtml(write(html))).querySelectorAll('*'), (node) => node.tagName).filter((tag) => !KNOWN_TAGS.has(tag));
			expect(unknown, `seed ${seed}: ${html}`).toEqual([]);
		}
	});
});
