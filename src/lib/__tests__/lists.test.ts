import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * Lists, both ways (issue #3, items 6 and 13). RTF as this library writes it has no list
 * element: an item is a paragraph that hangs by a quarter inch, opened by a bullet or its number
 * and a tab. The writer has to get that shape right for every way HTML nests a list, and the
 * reader has to rebuild <ul> and <ol> from exactly that shape and from nothing else: a line a
 * pathologist typed as "- Invasive adenocarcinoma." is a paragraph and must stay one.
 * Invented text.
 */

const R = String.raw;
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
/** Each paragraph of the body as "controls|text". */
const paragraphs = (html: string) => body(html).split('\\par ').filter(Boolean);
const read = (rtfBody: string) => rtfToHtml(`{\\rtf1\\ansi\\deff0 ${rtfBody}}`);
const BULLET = '\\pard\\li720\\fi-360\\bullet\\tab ';

describe('htmlToRtf: a list inside a list (#3.13)', () => {
	it('each item is a paragraph of its own, a level deeper for each list it is in', () => {
		expect(paragraphs('<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>')).toEqual([
			'\\pard\\li720\\fi-360\\bullet\\tab a',
			'\\pard\\li1440\\fi-360\\bullet\\tab b',
			'\\pard\\li2160\\fi-360\\bullet\\tab c',
			'\\pard\\li720\\fi-360\\bullet\\tab d'
		]);
	});

	it('the item before a nested list ends before it: the two are not one paragraph', () => {
		const rtf = body('<ul><li>parent<ul><li>child</li></ul></li></ul>');
		expect(rtf).toBe('\\pard\\li720\\fi-360\\bullet\\tab parent\\par \\pard\\li1440\\fi-360\\bullet\\tab child\\par ');
		expect(rtf).not.toContain('\\par \\par ');
	});

	it('a numbered list inside a bulleted one counts for itself, and the outer list goes on after it', () => {
		expect(paragraphs('<ol><li>one<ul><li>dot</li></ul></li><li>two<ol><li>inner</li><li>inner</li></ol></li><li>three</li></ol>')).toEqual([
			'\\pard\\li720\\fi-360 1.\\tab one',
			'\\pard\\li1440\\fi-360\\bullet\\tab dot',
			'\\pard\\li720\\fi-360 2.\\tab two',
			'\\pard\\li1440\\fi-360 1.\\tab inner',
			'\\pard\\li1440\\fi-360 2.\\tab inner',
			'\\pard\\li720\\fi-360 3.\\tab three'
		]);
	});

	it('text after a nested list is a line of the item, at the item\'s indent, with no marker', () => {
		expect(paragraphs('<ul><li>a<ul><li>b</li></ul>tail</li></ul>')).toEqual([
			'\\pard\\li720\\fi-360\\bullet\\tab a',
			'\\pard\\li1440\\fi-360\\bullet\\tab b',
			'\\pard\\li720 tail'
		]);
	});

	it('a list written straight inside a list (<ul><ul>, as some editors nest) is kept, a level deeper', () => {
		// The inner list was dropped whole: its text never reached the RTF.
		expect(paragraphs('<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>')).toEqual([
			'\\pard\\li720\\fi-360\\bullet\\tab a',
			'\\pard\\li1440\\fi-360\\bullet\\tab b',
			'\\pard\\li720\\fi-360\\bullet\\tab c'
		]);
	});

	it('an item that holds only a list shows that list\'s marker, not an empty one of its own', () => {
		expect(paragraphs('<ul><li><ul><li>only</li></ul></li></ul>')).toEqual(['\\pard\\li1440\\fi-360\\bullet\\tab only']);
	});

	it('a list in an indented block, or with a margin of its own, starts from there', () => {
		expect(body('<ul style="margin-left:48px"><li>a<ul><li>b</li></ul></li></ul>')).toBe(
			'\\pard\\li1440\\fi-360\\bullet\\tab a\\par \\pard\\li2160\\fi-360\\bullet\\tab b\\par '
		);
	});
});

describe('htmlToRtf: what a list item can hold', () => {
	it('a paragraph (<li><p>, as Word and Google Docs paste) is the item\'s text', () => {
		expect(body('<ul><li><p>x</p></li></ul>')).toBe(`${BULLET}x\\par `);
		expect(body('<ol><li><p><b>x</b> y</p></li></ol>')).toBe('\\pard\\li720\\fi-360 1.\\tab \\b x\\b0  y\\par ');
	});

	it('a second paragraph in the item is a line under the first, with no marker', () => {
		expect(paragraphs('<ul><li><p>one</p><p>more</p></li><li><p>two</p></li></ul>')).toEqual([
			'\\pard\\li720\\fi-360\\bullet\\tab one',
			'\\pard\\li720 more',
			'\\pard\\li720\\fi-360\\bullet\\tab two'
		]);
	});

	it('the line breaks of the source around a pasted paragraph add nothing', () => {
		expect(body('<ul>\n  <li>\n    <p>x</p>\n  </li>\n</ul>')).toBe(`${BULLET}x\\par `);
	});

	it('an empty item, and one that holds only the <br> a browser leaves, still show their marker', () => {
		expect(body('<ul><li></li><li><br></li></ul>')).toBe(`${BULLET}\\par ${BULLET}\\par `);
	});

	it('an item that begins with a quotation keeps its marker on a line of its own', () => {
		expect(paragraphs('<ul><li><blockquote>q</blockquote>after</li></ul>')).toEqual([
			'\\pard\\li720\\fi-360\\bullet\\tab ',
			'\\pard\\li1440\\i q\\i0',
			'\\pard\\li720 after'
		]);
	});

	it('text written straight into the list, between items, is a line at the items\' indent', () => {
		expect(paragraphs('<ul><li>a</li>loose <b>text</b><li>b</li></ul>')).toEqual([
			'\\pard\\li720\\fi-360\\bullet\\tab a',
			'\\pard\\li720 loose \\b text\\b0 ',
			'\\pard\\li720\\fi-360\\bullet\\tab b'
		]);
	});

	it('an item with no list around it (a pasted fragment) is a bulleted line, not text run into the next', () => {
		// "<li>a</li><li>b</li>" was written as "ab".
		expect(body('<li>a</li><li>b</li><p>after</p>')).toBe(`${BULLET}a\\par ${BULLET}b\\par \\pard after\\par `);
	});

	it('a list in a table cell stays in the cell', () => {
		expect(body('<table><tr><td><ul><li>a<ul><li>b</li></ul></li></ul></td></tr></table>')).toContain(
			'\\pard\\intbl\\li720\\fi-360\\bullet\\tab a\\par \\pard\\intbl\\li1440\\fi-360\\bullet\\tab b\\cell}'
		);
	});
});

describe('htmlToRtf: the list a browser\'s own list command makes', () => {
	// Chromium's insertUnorderedList and insertOrderedList, which the toolbar's list buttons
	// run, leave the list inside the paragraph it was made from: <p><ul>…</ul></p>. No HTML
	// parser builds that, so it is built here the way the command builds it. Seen in Chromium 156.
	const inside = (tag: string, innerHtml: string, around = ['', '']) => {
		const root = el(`${around[0]}<${tag}></${tag}>${around[1]}`);
		Array.from(root.querySelectorAll(tag)).find((e) => e.childNodes.length === 0)!.innerHTML = innerHtml;
		return root;
	};
	const bodyOf = (root: HTMLElement) => {
		const rtf = htmlToRtf(root);
		return rtf.slice(rtf.indexOf('\\pard\\f0\\fs24 ') + '\\pard\\f0\\fs24 '.length, -1);
	};

	it('is written as the list alone: no empty paragraph after it', () => {
		const root = inside('p', '<ul><li>one</li><li>two</li></ul>');
		expect(root.innerHTML).toBe('<p><ul><li>one</li><li>two</li></ul></p>');
		expect(bodyOf(root)).toBe(body('<ul><li>one</li><li>two</li></ul>'));
	});

	it('keeps the paragraphs before and after it as they are', () => {
		const root = inside('p', '<ol><li>one</li></ol>', ['<p>before</p>', '<p>after</p>']);
		expect(bodyOf(root)).toBe('\\pard before\\par \\pard\\li720\\fi-360 1.\\tab one\\par \\pard after\\par ');
	});

	it('made in a heading, the items are the heading\'s size and bold, with no empty paragraph after', () => {
		expect(bodyOf(inside('h2', '<ul><li>head</li></ul>'))).toBe('\\fs36\\b \\pard\\li720\\fi-360\\bullet\\tab head\\par \\b0\\fs24 ');
	});

	it('made in a table cell, it adds no empty line to the cell', () => {
		const root = el('<table><tr><td><p></p></td></tr></table>');
		root.querySelector('p')!.innerHTML = '<ul><li>x</li></ul>';
		expect(bodyOf(root)).toContain('\\fi0 \\pard\\intbl\\li720\\fi-360\\bullet\\tab x\\cell}');
	});

	it('reads back as the list, and is then written the same', () => {
		const first = htmlToRtf(inside('p', '<ul><li>one</li><li>two</li></ul>'));
		expect(rtfToHtml(first)).toBe('<ul><li>one</li><li>two</li></ul>');
		expect(htmlToRtf(el(rtfToHtml(first)))).toBe(first);
	});

	it('the size estimate covers it', () => {
		for (const root of [inside('p', '<ul><li>one</li></ul>'), inside('h2', '<ol><li>one</li><li>two</li></ol>')]) {
			expect(estimateRtfBytes(root)).toBeGreaterThanOrEqual(htmlToRtf(root).length);
		}
	});
});

describe('htmlToRtf: numbering (#3.13)', () => {
	it('<ol start="5"> counts from 5', () => {
		expect(paragraphs('<ol start="5"><li>a</li><li>b</li></ol>')).toEqual(['\\pard\\li720\\fi-360 5.\\tab a', '\\pard\\li720\\fi-360 6.\\tab b']);
	});

	it('a start of 0, or below it, is a start; one that is no number is 1', () => {
		expect(body('<ol start="0"><li>a</li></ol>')).toContain(' 0.\\tab a');
		expect(body('<ol start="-2"><li>a</li><li>b</li></ol>')).toContain(' -1.\\tab b');
		expect(body('<ol start="x"><li>a</li></ol>')).toContain(' 1.\\tab a');
	});

	it('a <ul> has no numbers, whatever its start says', () => {
		expect(body('<ul start="5"><li>a</li></ul>')).toBe(`${BULLET}a\\par `);
	});

	it('the size estimate covers nested lists, pasted paragraphs and long numbers', () => {
		for (const html of [
			'<ul><li>a<ul><li>b<ul><li>c</li></ul>tail</li></ul>tail</li></ul>',
			`<ol start="99998">${'<li><p>x</p><p>y</p></li>'.repeat(12)}</ol>`,
			'<ul><li>a</li>loose<ul><li>b</li></ul>more<li><blockquote>q</blockquote></li></ul><li>stray</li>'
		]) {
			const dom = el(html);
			expect(estimateRtfBytes(dom), html).toBeGreaterThanOrEqual(htmlToRtf(dom).length);
		}
	});
});

describe('rtfToHtml: the list the writer sends is a list again (#3.6)', () => {
	const back = (html: string) => rtfToHtml(htmlToRtf(el(html)));

	it('bullets are <ul>, numbers are <ol>, and the marker and its tab are gone from the text', () => {
		expect(back('<ul><li>one</li><li>two</li></ul><ol><li>x</li><li>y</li></ol>')).toBe(
			'<ul><li>one</li><li>two</li></ul>\n<ol><li>x</li><li>y</li></ol>'
		);
	});

	it('formatting in an item is kept', () => {
		expect(back('<ul><li><strong>Final</strong> <em>diagnosis</em></li></ul>')).toBe('<ul><li><strong>Final</strong> <em>diagnosis</em></li></ul>');
	});

	it('a deeper indent is a list inside the item above', () => {
		const html = '<ul><li>a<ul><li>b<ol><li>c</li><li>d</li></ol></li><li>e</li></ul></li><li>f</li></ul>';
		expect(back(html)).toBe(html);
	});

	it('a list that starts at 5 says so, and counts on from there when written again', () => {
		expect(back('<ol start="5"><li>a</li><li>b</li></ol>')).toBe('<ol start="5"><li>a</li><li>b</li></ol>');
	});

	it('an empty item is an item', () => {
		expect(back('<ul><li>a</li><li></li><li>c</li></ul>')).toBe('<ul><li>a</li><li><br></li><li>c</li></ul>');
	});

	it('a list indented as a whole keeps its indent as a margin', () => {
		expect(back('<ul style="margin-left:48px"><li>a</li></ul>')).toBe('<ul style="margin-left:36pt"><li>a</li></ul>');
	});

	it('a blank line between two lists keeps them two lists', () => {
		expect(back('<ul><li>a</li></ul><p><br></p><ul><li>b</li></ul>')).toBe('<ul><li>a</li></ul>\n<p><br></p>\n<ul><li>b</li></ul>');
	});

	it('a paragraph between two lists, and text around them, stay where they are', () => {
		expect(back('<p>before</p><ul><li>a</li></ul><p>between</p><ol><li>b</li></ol><p>after</p>')).toBe(
			'<p>before</p>\n<ul><li>a</li></ul>\n<p>between</p>\n<ol><li>b</li></ol>\n<p>after</p>'
		);
	});
});

describe('rtfToHtml: lists from other writers', () => {
	it('the numbers decide where a numbered list begins again', () => {
		const html = read(
			R`\pard\li720\fi-360 1.\tab a\par \pard\li720\fi-360 2.\tab b\par \pard\li720\fi-360 1.\tab c\par \pard\li720\fi-360 7.\tab d\par \pard\li720\fi-360 8.\tab e\par`
		);
		expect(html).toBe('<ol><li>a</li><li>b</li></ol>\n<ol><li>c</li></ol>\n<ol start="7"><li>d</li><li>e</li></ol>');
		// Written again, every item has the number it came with.
		expect(Array.from(htmlToRtf(el(html)).matchAll(/ (\d+)\.\\tab/g)).map((m) => m[1])).toEqual(['1', '2', '1', '7', '8']);
	});

	it('bullets after numbers at the same indent are a list of their own', () => {
		expect(read(R`\pard\li720\fi-360 1.\tab a\par \pard\li720\fi-360\bullet\tab b\par`)).toBe('<ol><li>a</li></ol>\n<ul><li>b</li></ul>');
	});

	it('a nested list that changes kind is a second list in the same item', () => {
		const html = read(R`\pard\li720\fi-360\bullet\tab a\par \pard\li1440\fi-360\bullet\tab b\par \pard\li1440\fi-360 1.\tab c\par \pard\li720\fi-360\bullet\tab d\par`);
		expect(html).toBe('<ul><li>a<ul><li>b</li></ul><ol><li>c</li></ol></li><li>d</li></ul>');
	});

	it('a list nested by less than half an inch keeps its indent, as a negative margin', () => {
		const html = read(R`\pard\li720\fi-360\bullet\tab a\par \pard\li1080\fi-360\bullet\tab b\par`);
		expect(html).toBe('<ul><li>a<ul style="margin-left:-18pt"><li>b</li></ul></li></ul>');
		expect(htmlToRtf(el(html))).toContain('\\pard\\li1080\\fi-360\\bullet\\tab b');
	});

	it('a list that starts deep is a list with a margin, not a list inside nothing', () => {
		expect(read(R`\pard\li1440\fi-360\bullet\tab deep\par \pard\li720\fi-360\bullet\tab shallow\par`)).toBe(
			'<ul style="margin-left:36pt"><li>deep</li></ul>\n<ul><li>shallow</li></ul>'
		);
	});

	it('Word\'s list: the marker in a {\\listtext} group, with the Symbol font\'s bullet', () => {
		const bullet = R`{\listtext\pard\plain\f3 \'b7\tab}`;
		const number = (n: number) => `{\\listtext\\pard\\plain ${n}.\\tab}`;
		const html = read(
			`${bullet}\\pard\\plain\\fi-360\\li720 item one\\par ${bullet}\\pard\\plain\\fi-360\\li720 item two\\par ` +
			`${number(1)}\\pard\\plain\\fi-360\\li1440 first\\par ${number(2)}\\pard\\plain\\fi-360\\li1440 second\\par \\pard\\plain after\\par`
		);
		expect(html).toBe('<ul><li>item one</li><li>item two<ol><li>first</li><li>second</li></ol></li></ul>\n<p>after</p>');
	});

	it('the older {\\pntext} marker, and the bullet as \\\'95', () => {
		expect(read(R`{\pntext\pard\plain\'b7\tab}\pard\fi-360\li720 a\par`)).toBe('<ul><li>a</li></ul>');
		expect(read(R`\pard\fi-360\li720 \'95\tab a\par`)).toBe('<ul><li>a</li></ul>');
	});
});

describe('rtfToHtml: what is not a list stays the paragraph it is', () => {
	const paragraph = (rtfBody: string) => {
		const html = read(rtfBody);
		expect(html).not.toMatch(/<(ul|ol|li)\b/);
		return html;
	};

	it('a line typed with a dash, a bullet or a number', () => {
		expect(paragraph(R`\pard - Invasive adenocarcinoma.\par \pard \bullet  Margins negative.\par \pard 1. Left colon.\par`)).toBe(
			'<p>- Invasive adenocarcinoma.</p>\n<p>• Margins negative.</p>\n<p>1. Left colon.</p>'
		);
	});

	it('a bullet and a tab with no hanging indent: the marker stays, with the narrow gap after it', () => {
		expect(paragraph(R`\pard \bullet\tab item\par \pard 2.\tab item\par`)).toBe('<p>•&emsp;item</p>\n<p>2.&emsp;item</p>');
	});

	it('a list hung by another distance than the writer\'s, which would not be written back the same', () => {
		expect(paragraph(R`\pard\li720\fi-720\bullet\tab hang\par`)).toBe('<p style="margin-left:36pt;text-indent:-36pt">•&emsp;hang</p>');
		expect(paragraph(R`\pard\li360\fi-180 1.\tab hang\par`)).toContain('1.&emsp;hang');
	});

	it('a marker the writer does not send: a letter, a parenthesis, a dash', () => {
		expect(paragraph(R`\pard\li720\fi-360 a.\tab letter\par`)).toContain('a.');
		expect(paragraph(R`\pard\li720\fi-360 1)\tab paren\par`)).toContain('1)');
		expect(paragraph(R`\pard\li720\fi-360 -\tab dash\par`)).toContain('-');
	});

	it('a centered or right-indented item, whose alignment a list item would lose', () => {
		expect(paragraph(R`\pard\qc\li720\fi-360\bullet\tab centered\par`)).toContain('text-align:center');
		expect(paragraph(R`\pard\li720\ri720\fi-360\bullet\tab narrow\par`)).toContain('margin-right:36pt');
	});

	it('a number too long to be an item\'s number', () => {
		expect(paragraph(R`\pard\li720\fi-360 12345678901234567890123.\tab x\par`)).toContain('12345678901234567890123.');
	});

	it('a bullet that does not open the paragraph', () => {
		expect(paragraph(R`\pard\li720\fi-360 Note \bullet\tab item\par`)).toContain('Note •');
	});

	it('a bullet that opens the second line of a paragraph: the first line is not thrown away with the marker', () => {
		const html = paragraph(R`\pard\li720\fi-360 first line\line\bullet\tab second\par`);
		expect(html).toBe('<p style="margin-left:36pt;text-indent:-18pt">first line<br>•&emsp;second</p>');
	});

	it('a middle dot typed as text, which only inside Word\'s marker group is a bullet', () => {
		expect(paragraph(R`\pard\li720\fi-360 \'b7\tab dot\par`)).toContain('·');
	});

	it('a list in a table cell, which is read as lines of text', () => {
		const html = read(R`\trowd\cellx8640 \pard\intbl\li720\fi-360\bullet\tab x\par \pard\intbl\li720\fi-360\bullet\tab y\cell\row`);
		expect(html).not.toMatch(/<(ul|ol|li)\b/);
		expect(el(html).querySelector('td')!.innerHTML).toBe('• x<br>• y');
	});

	it('none of them loses its marker or its text when written again', () => {
		const rtfBody = R`\pard - Invasive adenocarcinoma.\par \pard\li720\fi-720\bullet\tab hang\par \pard\li720\fi-360 a.\tab letter\par`;
		const saved = htmlToRtf(el(read(rtfBody)));
		expect(saved).toContain('\\pard - Invasive adenocarcinoma.\\par ');
		expect(saved).toContain('\\pard\\li720\\fi-720 \\u8226\\\'3f\\u8195\\\'3fhang\\par ');
		expect(saved).toContain('\\pard\\li720\\fi-360 a.\\tab letter\\par ');
		expect(htmlToRtf(el(rtfToHtml(saved)))).toBe(saved);
	});
});
