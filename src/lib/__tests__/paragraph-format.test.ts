import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';

/**
 * A paragraph's indents, spacing, keep-with-next and tab stops reach the RTF (issue #10). The case
 * is a prostate biopsy report printed in two columns of ordinary paragraphs: a bold label, a tab,
 * then the diagnosis, with later lines hanging at the same column. The report text is invented.
 */

function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

function body(html: string): string {
	return htmlToRtf(htmlEl(html)).replace(/^.*?\\viewkind4\\uc1\\pard\\f0\\fs24 /, '');
}

const FIRST = 'margin-left: 1.75in; text-indent: -1.75in; margin-top: 5pt; white-space: pre-wrap; tab-size: 1.75in';
const NEXT = 'margin-left: 1.75in; white-space: pre-wrap';

describe('each property alone', () => {
	it('margin-left is \\li', () => {
		expect(body('<p style="margin-left: 1.75in">x</p>')).toBe('\\pard\\li2520 x\\par }');
	});

	it('a negative text-indent is \\fi', () => {
		expect(body('<p style="text-indent: -1.75in">x</p>')).toBe('\\pard\\fi-2520 x\\par }');
	});

	it('margin-top is \\sb and margin-bottom is \\sa', () => {
		expect(body('<p style="margin-top: 5pt">x</p>')).toBe('\\pard\\sb100 x\\par }');
		expect(body('<p style="margin-bottom: 5pt">x</p>')).toBe('\\pard\\sa100 x\\par }');
	});

	it('break-after: avoid and page-break-after: avoid are \\keepn', () => {
		expect(body('<p style="break-after: avoid">x</p>')).toBe('\\pard\\keepn x\\par }');
		expect(body('<p style="page-break-after: avoid">x</p>')).toBe('\\pard\\keepn x\\par }');
	});

	it('data-rtf-tab-stops is \\tx, ascending, each stop once', () => {
		expect(body('<p data-rtf-tab-stops="1.75in">x</p>')).toBe('\\pard\\tx2520 x\\par }');
		expect(body('<p data-rtf-tab-stops="3in, 1in,1in">x</p>')).toBe('\\pard\\tx1440\\tx4320 x\\par }');
	});

	it('on a <div> too', () => {
		expect(body('<div style="margin-left: 0.5in">x</div>')).toBe('\\pard\\li720 x\\par }');
	});
});

describe('units', () => {
	it('in, pt, cm and px, rounded to whole twips', () => {
		expect(body('<p style="margin-left: 72pt">x</p>')).toContain('\\li1440');
		expect(body('<p style="margin-left: 2.54cm">x</p>')).toContain('\\li1440');
		expect(body('<p style="margin-left: 40px">x</p>')).toContain('\\li600');
		expect(body('<p style="margin-top: 0.3pt">x</p>')).toContain('\\sb6');
	});

	it('a value it cannot read writes nothing, so the output is as before', () => {
		for (const style of [
			'margin-left: 10%',
			'margin-left: 2em',
			'margin-left: auto',
			'margin-left: -1in',
			'margin-top: -5pt',
			'margin-left: 0in',
			'text-indent: 0',
			'break-after: page'
		]) {
			expect(body(`<p style="${style}">x</p>`), style).toBe('\\pard x\\par }');
		}
		expect(body('<p data-rtf-tab-stops="wide, -1in, 0in">x</p>')).toBe('\\pard x\\par }');
	});

	it('a paragraph with no formatting is unchanged', () => {
		expect(body('<p>x</p><p>y</p>')).toBe('\\pard x\\par \\pard y\\par }');
	});
});

describe('the two-column report', () => {
	const report =
		'<p><b>Prostate, multiple needle core biopsies:</b></p>' +
		`<p style="${FIRST}" data-rtf-tab-stops="1.75in"><b>A. Right base</b>\tBenign prostatic tissue</p>` +
		`<p style="${FIRST}; break-after: avoid" data-rtf-tab-stops="1.75in"><b>E. Right lateral mid</b>\tProstatic adenocarcinoma</p>` +
		`<p style="${NEXT}">Gleason Grade 3+3=6/10 (Grade Group 1)</p>`;

	it('writes the label line and the line that hangs at the column', () => {
		expect(body(report)).toBe(
			'\\pard \\b Prostate, multiple needle core biopsies:\\b0 \\par ' +
				'\\pard\\tx2520\\li2520\\fi-2520\\sb100 \\b A. Right base\\b0 \\tab Benign prostatic tissue\\par ' +
				'\\pard\\tx2520\\li2520\\fi-2520\\sb100\\keepn \\b E. Right lateral mid\\b0 \\tab Prostatic adenocarcinoma\\par ' +
				'\\pard\\li2520 Gleason Grade 3+3=6/10 (Grade Group 1)\\par }'
		);
	});

	it('a blank line after a formatted paragraph does not take on its indent', () => {
		expect(body(`<p style="${NEXT}">x</p><p><br></p><p>y</p>`)).toBe(
			'\\pard\\li2520 x\\par \\pard \\par \\pard y\\par }'
		);
		// A blank line after an ordinary paragraph is the bare \par it always was.
		expect(body('<p>x</p><p><br></p>')).toBe('\\pard x\\par \\par }');
	});

	it('a blank line with formatting of its own keeps it', () => {
		expect(body(`<p style="${NEXT}"><br></p>`)).toBe('\\pard\\li2520 \\par }');
	});

	it('the size estimate still covers the written RTF', () => {
		const blankAfter = `<p style="${NEXT}">x</p><p><br></p>`;
		for (const html of [report.repeat(30), blankAfter.repeat(30)]) {
			const el = htmlEl(html);
			expect(estimateRtfBytes(el)).toBeGreaterThanOrEqual(htmlToRtf(el).length);
		}
	});
});

describe('inside a table cell', () => {
	it('the cell keeps its own paragraph, and the paragraph formatting is not written', () => {
		const out = body('<table><tr><td><p style="margin-left: 1in; margin-top: 5pt" data-rtf-tab-stops="1in">x</p></td></tr></table>');
		expect(out).toContain('{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 x');
		expect(out).not.toMatch(/\\li1440|\\sb100|\\tx1440/);
	});
});
