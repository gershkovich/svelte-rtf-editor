import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';

/**
 * A pathologist centers or right-aligns a line, or indents a block of lines with Indent
 * (Ctrl+]). The receiving system (Epic Beaker) must get the same layout: \qc / \qr, and \liN.
 * Through 1.6.0 a paragraph's alignment was never written, so a centered line arrived
 * left-aligned. The shapes below are what Chromium, WebKit and Firefox produce. Invented text.
 */

const CHROME_INDENT = 'margin: 0 0 0 40px; border: none; padding: 0px;';

function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

function body(html: string): string {
	return htmlToRtf(htmlEl(html)).replace(/^.*?\\viewkind4\\uc1\\pard\\f0\\fs24 /, '');
}

describe('paragraph alignment reaches the RTF', () => {
	it('center, right and justify; left writes nothing extra', () => {
		expect(body('<p style="text-align: center;">C</p>')).toBe('\\pard\\qc C\\par }');
		expect(body('<div style="text-align: right;">R</div>')).toBe('\\pard\\qr R\\par }');
		expect(body('<p style="text-align: justify;">J</p>')).toBe('\\pard\\qj J\\par }');
		expect(body('<p style="text-align: left;">L</p>')).toBe('\\pard L\\par }');
		expect(body('<p>L</p>')).toBe('\\pard L\\par }');
	});

	it('Firefox: <p align="center">', () => {
		expect(body('<p align="center">C</p>')).toBe('\\pard\\qc C\\par }');
	});

	it('a centered heading', () => {
		expect(body('<h3 style="text-align: center;">H</h3>')).toMatch(/^\\pard\\qc\\f0\\fs\d+\\b H/);
	});

	it('a centered paragraph in a table cell, even as the first in the cell', () => {
		expect(body('<table><tr><td><p style="text-align: center;">x</p></td></tr></table>')).toContain('\\pard\\intbl\\qc x');
	});
});

describe('an indented block reaches the RTF as a left indent', () => {
	it("the editor's Indent: 48px per step, half an inch (\\li720)", () => {
		expect(body('<p style="margin-left: 48px;">one</p><p style="margin-left: 96px;">two</p>')).toBe(
			'\\pard\\li720 one\\par \\pard\\li1440 two\\par }'
		);
		expect(body('<ul style="margin-left: 48px;"><li>a</li></ul>')).toBe('\\pard\\li1440\\fi-360\\bullet\\tab a\\par }');
	});

	it('pasted content: lines wrapped in an indent blockquote (Chromium, WebKit), not italic', () => {
		const rtf = body(`<blockquote style="${CHROME_INDENT}"><p>one</p><p>two</p></blockquote><p>three</p>`);
		expect(rtf).toBe('\\pard\\li600 one\\par \\pard\\li600 two\\par \\pard three\\par }');
		expect(rtf).not.toContain('\\i ');
	});

	it('Chromium and WebKit: two steps nest', () => {
		const rtf = body(
			`<blockquote style="${CHROME_INDENT}"><blockquote style="${CHROME_INDENT}"><p>one</p></blockquote></blockquote>`
		);
		expect(rtf).toBe('\\pard\\li1200 one\\par }');
	});

	it('pasted content: 40px margin-left on the paragraph (Firefox)', () => {
		expect(body('<p style="margin-left: 40px;">one</p><p style="margin-left: 80px;">two</p>')).toBe(
			'\\pard\\li600 one\\par \\pard\\li1200 two\\par }'
		);
	});

	it('loose text directly in an indent blockquote gets its own indented paragraph', () => {
		expect(body(`<blockquote style="${CHROME_INDENT}">one</blockquote>`)).toBe('\\pard\\li600 one\\par }');
	});

	it('indent and alignment together', () => {
		expect(body(`<blockquote style="${CHROME_INDENT}"><p style="text-align: center;">x</p></blockquote>`)).toBe(
			'\\pard\\qc\\li600 x\\par }'
		);
	});

	it('a list inside an indented block is indented by the same amount', () => {
		expect(body(`<blockquote style="${CHROME_INDENT}"><ul><li>a</li></ul></blockquote>`)).toBe(
			'\\pard\\li1320\\fi-360\\bullet\\tab a\\par }'
		);
	});

	it('a quotation (blockquote without a margin) is still italic and indented', () => {
		expect(body('<blockquote>q</blockquote>')).toBe('\\pard\\li720\\i q\\i0\\par }');
	});

	it('the size estimate still covers the written RTF', () => {
		const el = htmlEl(
			Array.from({ length: 30 }, (_, i) => `<blockquote style="${CHROME_INDENT}"><p style="text-align: center;">${i}</p></blockquote>`).join('')
		);
		expect(estimateRtfBytes(el)).toBeGreaterThanOrEqual(htmlToRtf(el).length);
	});

	it('a quotation with a border and a margin of its own stays italic', () => {
		expect(body('<blockquote style="margin-left: 48px; border-left: 2px solid #ccc;">q</blockquote>')).toBe(
			'\\pard\\li1440\\i q\\i0\\par }'
		);
	});

	it('a pasted indent outdented to nothing is plain text, not a quotation', () => {
		expect(body('<blockquote style="margin: 0px; border: none; padding: 0px;"><p>x</p></blockquote>')).toBe('\\pard x\\par }');
	});

	it('paragraphs inside a quotation keep its indent', () => {
		expect(body('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('\\i \\pard\\li720 a\\par \\pard\\li720 b\\par \\i0 }');
	});

	it('an indented picture', () => {
		expect(body('<figure style="margin-left: 48px;"><img alt="x"><figcaption>c</figcaption></figure>')).toContain(
			'\\pard\\ql\\li720 \\i [Image: x]'
		);
	});

	it('the size estimate counts Firefox alignment too', () => {
		const el = htmlEl(Array.from({ length: 30 }, () => '<h2 align="center">H</h2>').join(''));
		expect(estimateRtfBytes(el)).toBeGreaterThanOrEqual(htmlToRtf(el).length);
	});
});

describe('loose text after a formatted block does not inherit its layout', () => {
	it('after a centered paragraph', () => {
		expect(body('<p style="text-align: center;">T</p>more')).toBe('\\pard\\qc T\\par \\pard more}');
	});

	it('after an indent, at the indent of the blocks around it', () => {
		expect(body(`<blockquote style="${CHROME_INDENT}"><p>a</p>b</blockquote>c`)).toBe(
			'\\pard\\li600 a\\par \\pard\\li600 b\\par \\pard c}'
		);
	});

	it('after a plain paragraph, nothing is added', () => {
		expect(body('<p>T</p>more')).toBe('\\pard T\\par more}');
	});
});

