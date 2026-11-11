import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * A pathologist presses Tab in the editor to indent a line (willet#671). The editor inserts the tab
 * as Chromium does for a typed tab, and the receiving system (Epic Beaker) must get RTF's \tab.
 * The report text here is invented.
 */

const TYPED_TAB = '<span style="white-space:pre">\t</span>';

function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

function body(html: string): string {
	return htmlToRtf(htmlEl(html)).replace(/^.*?\\viewkind4\\uc1\\pard\\f0\\fs24 /, '');
}

describe('a typed tab reaches the RTF as \\tab', () => {
	it('at the start of a line', () => {
		expect(body(`<p>A. Breast:</p><p>${TYPED_TAB}Invasive carcinoma</p>`)).toBe(
			'\\pard A. Breast:\\par \\pard \\tab Invasive carcinoma\\par }'
		);
	});

	it('two tabs, and a tab in the middle of a line', () => {
		expect(body(`<p>${TYPED_TAB}${TYPED_TAB}Margin${TYPED_TAB}negative</p>`)).toBe(
			'\\pard \\tab \\tab Margin\\tab negative\\par }'
		);
	});

	it('inside bold text and inside a table cell', () => {
		expect(body(`<p><b>${TYPED_TAB}x</b></p>`)).toContain('\\b \\tab x\\b0');
		expect(body(`<table><tr><td>${TYPED_TAB}x</td></tr></table>`)).toContain('\\tab x');
	});

	it('a pre-wrap ancestor and Safari\'s Apple-tab-span count too', () => {
		expect(body('<p><span style="white-space: pre-wrap">a\tb</span></p>')).toContain('a\\tab b');
		expect(body('<p><span class="Apple-tab-span">\t</span>b</p>')).toContain('\\tab b');
	});

	it('a tab the browser collapses is passed through as before', () => {
		expect(body('<p>a\tb</p>')).toBe('\\pard a\tb\\par }');
	});

	it('the size estimate still covers the written RTF', () => {
		const el = htmlEl(`<p>${TYPED_TAB.repeat(20)}x</p>`);
		expect(estimateRtfBytes(el)).toBeGreaterThanOrEqual(htmlToRtf(el).length);
	});
});

describe('RTF with \\tab reads back as a tab and writes out the same', () => {
	it('\\tab becomes the typed-tab shape', () => {
		const html = rtfToHtml('{\\rtf1\\ansi\\pard \\tab Invasive carcinoma\\par }');
		expect(html).toContain(`${TYPED_TAB}Invasive carcinoma`);
	});

	it('round trip: RTF to HTML to RTF keeps the tab', () => {
		const html = rtfToHtml('{\\rtf1\\ansi\\pard \\tab \\tab Margin\\tab negative\\par }');
		expect(body(html)).toContain('\\tab \\tab Margin\\tab negative');
	});
});

describe('the gap after a list marker stays narrow', () => {
	it('a bullet or a number, then \\tab, reads as an em space', () => {
		expect(rtfToHtml('{\\rtf1\\ansi\\pard \\bullet\\tab item\\par }')).toContain('•&emsp;item');
		expect(rtfToHtml('{\\rtf1\\ansi\\pard 2.\\tab item\\par }')).toContain('2.&emsp;item');
	});
});
