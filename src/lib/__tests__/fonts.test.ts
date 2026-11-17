import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import RtfViewer from '../RtfViewer.svelte';
import {
	htmlToRtf,
	cssFontFamily,
	normalizeFontSize,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE
} from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * The document font and body size: what the RTF declares, and what the editor
 * and viewer show on screen. The two must agree, so the writer sees what the
 * receiving system will show.
 */

function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

/** The font table group of an RTF string. */
function fontTable(rtf: string): string {
	const start = rtf.indexOf('{\\fonttbl');
	expect(start).toBeGreaterThan(-1);
	return rtf.substring(start, rtf.indexOf('}}', start) + 2);
}

describe('htmlToRtf document font', () => {
	it('defaults to Arial 12 pt', () => {
		expect(DEFAULT_FONT_FAMILY).toBe('Arial');
		expect(DEFAULT_FONT_SIZE).toBe(12);

		const rtf = htmlToRtf(htmlEl('<p>Benign prostatic tissue.</p>'));
		expect(fontTable(rtf)).toContain('{\\f0\\fswiss\\fcharset0 Arial;}');
		expect(rtf).toContain('\\pard\\f0\\fs24 ');
		expect(rtf).not.toContain('Helvetica');
		expect(rtf).not.toContain('Georgia');
	});

	it('writes the font and size it is given', () => {
		const rtf = htmlToRtf(htmlEl('<p>Text</p>'), { fontFamily: 'Times New Roman', fontSize: 11 });
		expect(fontTable(rtf)).toContain('{\\f0\\froman\\fcharset0 Times New Roman;}');
		expect(rtf).toContain('\\pard\\f0\\fs22 ');
	});

	it('accepts half-point sizes', () => {
		const rtf = htmlToRtf(htmlEl('<p>Text</p>'), { fontSize: 10.5 });
		expect(rtf).toContain('\\pard\\f0\\fs21 ');
	});

	it('falls back to the default for a missing or nonsense font and size', () => {
		for (const options of [{ fontFamily: '', fontSize: 0 }, { fontFamily: '  ', fontSize: NaN }, { fontSize: -4 }]) {
			const rtf = htmlToRtf(htmlEl('<p>Text</p>'), options);
			expect(fontTable(rtf)).toContain(' Arial;}');
			expect(rtf).toContain('\\pard\\f0\\fs24 ');
		}
	});

	it('keeps a font name from breaking the font table', () => {
		const rtf = htmlToRtf(htmlEl('<p>Text</p>'), { fontFamily: 'Evil}{\\b;Font' });
		expect(fontTable(rtf)).toContain('{\\f0\\fswiss\\fcharset0 EvilbFont;}');
	});

	it('writes headings in the document font, scaled from the body size', () => {
		const at12 = htmlToRtf(htmlEl('<h1>A</h1><h2>B</h2><h3>C</h3>'));
		expect(at12).toContain('\\pard\\f0\\fs48\\b A\\b0\\fs24\\par ');
		expect(at12).toContain('\\pard\\f0\\fs36\\b B\\b0\\fs24\\par ');
		expect(at12).toContain('\\pard\\f0\\fs28\\b C\\b0\\fs24\\par ');

		const at10 = htmlToRtf(htmlEl('<h1>A</h1><h2>B</h2><h3>C</h3>'), { fontSize: 10 });
		expect(at10).toContain('\\pard\\f0\\fs40\\b A\\b0\\fs20\\par ');
		expect(at10).toContain('\\pard\\f0\\fs30\\b B\\b0\\fs20\\par ');
		expect(at10).toContain('\\pard\\f0\\fs23\\b C\\b0\\fs20\\par ');
	});

	it('returns to the body size after a sized span and a code block', () => {
		const rtf = htmlToRtf(
			htmlEl('<p><span style="font-size: 18pt">big</span> after</p><pre>x = 1</pre><p>next</p>'),
			{ fontSize: 11 }
		);
		expect(rtf).toContain('\\fs36 big\\fs22  after');
		expect(rtf).toContain('\\pard\\f1\\fs18 x = 1\\f0\\fs22\\par ');
		expect(rtf).not.toContain('\\fs24');
	});

	it('writes code in the monospace font', () => {
		const rtf = htmlToRtf(htmlEl('<p>run <code>ls</code></p>'));
		expect(fontTable(rtf)).toContain('{\\f1\\fmodern\\fcharset0 Courier New;}');
		expect(rtf).toContain('\\f1 ls\\f0 ');
	});
});

describe('cssFontFamily', () => {
	it('quotes the name and adds the matching generic family', () => {
		expect(cssFontFamily('Arial')).toBe('"Arial", sans-serif');
		expect(cssFontFamily('Times New Roman')).toBe('"Times New Roman", serif');
		expect(cssFontFamily('Courier New')).toBe('"Courier New", monospace');
		expect(cssFontFamily(undefined)).toBe('"Arial", sans-serif');
	});
});

// ── On screen ─────────────────────────────────────────────────────────────────

let host: HTMLDivElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
});

function mountInto<P extends Record<string, unknown>>(Comp: unknown, props: P) {
	host = document.createElement('div');
	document.body.appendChild(host);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component = mount(Comp as any, { target: host, props }) as Record<string, unknown>;
	flushSync();
	return component;
}

describe('InkEditor font', () => {
	it('shows Arial 12 pt and writes it to the RTF by default', () => {
		const editor = mountInto(InkEditor, {
			content: '<p>Text</p>',
			autosave: false,
			showToolbar: false
		}) as unknown as { getRTF: () => string };

		const root = host!.querySelector('.ink-editor') as HTMLElement;
		expect(root.style.getPropertyValue('--ink-font-family')).toBe('"Arial", sans-serif');
		expect(root.style.getPropertyValue('--ink-font-size')).toBe('12pt');

		const rtf = editor.getRTF();
		expect(rtf).toContain(' Arial;}');
		expect(rtf).toContain('\\pard\\f0\\fs24 ');
	});

	it('uses the same font and size on screen and in the RTF', () => {
		const editor = mountInto(InkEditor, {
			content: '<p>Text</p>',
			autosave: false,
			showToolbar: false,
			fontFamily: 'Calibri',
			fontSize: 11
		}) as unknown as { getRTF: () => string; getRtfSize: () => number };

		const root = host!.querySelector('.ink-editor') as HTMLElement;
		expect(root.style.getPropertyValue('--ink-font-family')).toBe('"Calibri", sans-serif');
		expect(root.style.getPropertyValue('--ink-font-size')).toBe('11pt');

		const rtf = editor.getRTF();
		expect(rtf).toContain(' Calibri;}');
		expect(rtf).toContain('\\pard\\f0\\fs22 ');
		expect(editor.getRtfSize()).toBe(rtf.length);
	});
});

describe('RtfViewer font', () => {
	it('shows Arial 12 pt by default', () => {
		mountInto(RtfViewer, { content: '{\\rtf1\\ansi Text}' });
		const viewer = host!.querySelector('.rtf-viewer') as HTMLElement;
		expect(viewer.style.fontFamily).toContain('Arial');
		expect(viewer.style.fontSize).toBe('12pt');
	});

	it('shows the font and size it is given', () => {
		mountInto(RtfViewer, { content: '{\\rtf1\\ansi Text}', fontFamily: 'Georgia', fontSize: 14 });
		const viewer = host!.querySelector('.rtf-viewer') as HTMLElement;
		expect(viewer.style.fontFamily).toContain('Georgia');
		expect(viewer.style.fontSize).toBe('14pt');
	});
});

// ── Review follow-ups ─────────────────────────────────────────────────────────

describe('font names given as a CSS list', () => {
	it('keeps only the first family', () => {
		const rtf = htmlToRtf(htmlEl('<p>Text</p>'), { fontFamily: '"Times New Roman", serif' });
		expect(fontTable(rtf)).toContain('{\\f0\\froman\\fcharset0 Times New Roman;}');
		expect(cssFontFamily('Arial, sans-serif')).toBe('"Arial", sans-serif');
	});
});

describe('normalizeFontSize', () => {
	it('rounds to the half-point the RTF carries, so screen and RTF agree', () => {
		expect(normalizeFontSize(10.25)).toBe(10.5);
		expect(htmlToRtf(htmlEl('<p>Text</p>'), { fontSize: 10.25 })).toContain('\\pard\\f0\\fs21 ');
	});

	it('keeps sizes within what readers accept', () => {
		expect(normalizeFontSize(5000)).toBe(1638);
		expect(normalizeFontSize(0.1)).toBe(1);
		expect(normalizeFontSize(undefined)).toBe(DEFAULT_FONT_SIZE);
	});
});

describe('reading back a document written at another size', () => {
	const html =
		'<h1>Title</h1><h2>Section</h2><h3>Sub</h3><p>Body text.</p><ul><li>item</li></ul><p>More body.</p>';

	for (const fontSize of [9, 10, 11, 12, 14]) {
		it(`keeps headings and paragraphs apart at ${fontSize} pt, read at that size`, () => {
			const back = rtfToHtml(htmlToRtf(htmlEl(html), { fontSize }), { fontSize });
			// A heading is the element and its text: its own size and bold are not
			// repeated inside it, at any body size.
			expect(back).toContain('<h1>Title</h1>');
			expect(back).toContain('<h2>Section</h2>');
			expect(back).toContain('<h3>Sub</h3>');
			expect(back).toContain('<p>Body text.</p>');
			expect(back).toContain('<p>More body.</p>');
		});
	}

	it('keeps the size text is written at, so a 9 pt document still shows at 9 pt', () => {
		// A report written entirely at 9 pt, the way ORCA writes its normal-range report.
		const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 \fswiss Helvetica;}}{\pard \ql \f0 \fs18 Heart: 350 g\par}{\pard \ql \f0 \fs18 Liver: 1500 g\par}}`;
		const back = rtfToHtml(rtf);
		expect(back).toContain('<p><span style="font-size:9pt">Heart: 350 g</span></p>');
		expect(back).toContain('<p><span style="font-size:9pt">Liver: 1500 g</span></p>');
	});

	it('reads a 12 pt line in a 9 pt document as a paragraph, not a heading', () => {
		const rtf = String.raw`{\rtf1\ansi{\pard\fs18 Heart: 350 g\par}{\pard\fs24 Comment: see note\par}{\pard\fs22 Liver: 1500 g\par}}`;
		const back = rtfToHtml(rtf);
		expect(back).toContain('<p>Comment: see note</p>');
		expect(back).toContain('<p><span style="font-size:11pt">Liver: 1500 g</span></p>');
		expect(back).not.toMatch(/<h[1-3]>/);
	});

	it('keeps a size other than the screen\'s, when the screen is set to 10 pt', () => {
		const rtf = String.raw`{\rtf1\ansi{\pard\fs20 Body.\par}{\pard\fs22 Eleven point note.\par}{\pard\fs24 Twelve point note.\par}}`;
		const back = rtfToHtml(rtf, { fontSize: 10 });
		expect(back).toContain('<p>Body.</p>');
		expect(back).toContain('<p><span style="font-size:11pt">Eleven point note.</span></p>');
		expect(back).toContain('<p><span style="font-size:12pt">Twelve point note.</span></p>');
	});

	it('leaves a plain 12 pt report as plain paragraphs in a 10 pt editor, save after save', () => {
		const rtf = String.raw`{\rtf1\ansi\pard\plain\fs24 A. Left colon, sigmoid, resection:\par\pard\plain\fs24 - Invasive adenocarcinoma.\par\pard Margins negative.\par}`;
		let saved = rtf;
		for (let i = 0; i < 3; i++) saved = reload(saved, 10);
		const back = rtfToHtml(saved, { fontSize: 10 });
		expect(back).not.toMatch(/<h[1-3]>/);
		expect(back).not.toContain('<strong>');
		expect(saved).not.toContain('\\b ');
		expect(back).toContain('<p><span style="font-size:12pt">A. Left colon, sigmoid, resection:</span></p>');
	});

	it('keeps an underlined blank, such as a signature line', () => {
		expect(rtfToHtml(String.raw`{\rtf1\ansi\pard Signature:{\ul      }\par}`)).toContain('<p>Signature:<u>     </u></p>');
		const saved = reload(htmlToRtf(htmlEl('<p>Signature: <u>          </u></p>')));
		expect(rtfToHtml(saved)).toContain('<u>          </u>');
	});

	it('keeps a short heading a heading, whatever most of the text is set in', () => {
		const back = rtfToHtml(htmlToRtf(htmlEl('<h3>Final diagnosis</h3><p>Benign.</p>')));
		expect(back).toMatch(/<h3>[^\n]*Final diagnosis[^\n]*<\/h3>/);
		expect(back).toContain('<p>Benign.</p>');
	});

	it('shows 12 pt text without a size of its own', () => {
		const back = rtfToHtml(htmlToRtf(htmlEl('<p>Body text.</p>')));
		expect(back).toContain('<p>Body text.</p>');
	});

	it('still marks text set larger than the body', () => {
		const back = rtfToHtml(
			htmlToRtf(htmlEl('<p>Body text here. <span style="font-size: 13pt">bigger</span></p>'), { fontSize: 10 }),
			{ fontSize: 10 }
		);
		expect(back).toContain('font-size:13pt');
	});
});

// ── Loading RTF into an editor and saving it again ────────────────────────────

/** What an app does: rtfToHtml, then set it as the editor's HTML, then htmlToRtf. */
function reload(rtf: string, fontSize?: number): string {
	return htmlToRtf(htmlEl(rtfToHtml(rtf, { fontSize })), { fontSize });
}

describe('RTF loaded into an editor and saved again', () => {
	it('adds no space at the start of a paragraph', () => {
		const original = htmlToRtf(htmlEl('<p>Prostate, biopsy:</p><p>- Benign.</p><p>- Margins negative.</p>'));
		const saved = reload(original);
		expect(saved).not.toMatch(/\\par {2,}/);
		expect(saved).toContain('\\pard - Benign.');
		expect(saved).toContain('\\pard - Margins negative.');
	});

	it('ignores the whitespace between blocks but keeps the space between words', () => {
		const rtf = htmlToRtf(htmlEl('<p>a</p>\n  <p><b>bold</b> <i>italic</i></p>\n'));
		expect(rtf).toContain('\\par \\pard \\b bold\\b0  \\i italic\\i0 \\par ');
		expect(rtf).not.toMatch(/\\par {2,}/);
	});

	for (const fontSize of [10, 12]) {
		it(`is stable over repeated saves at ${fontSize} pt`, () => {
			const html = '<h1>Title</h1><h3>Sub</h3><p>Body text.</p><ul><li>item</li></ul><p>More.</p>';
			const first = htmlToRtf(htmlEl(html), { fontSize });
			let rtf = first;
			for (let i = 0; i < 4; i++) rtf = reload(rtf, fontSize);
			const shown = rtfToHtml(rtf, { fontSize });
			expect(shown).toMatch(/<h1>[^\n]*Title[^\n]*<\/h1>/);
			expect(shown).toMatch(/<h3>[^\n]*Sub[^\n]*<\/h3>/);
			expect(shown).toContain('<p>Body text.</p>');
			expect(shown).not.toMatch(/<span[^>]*>\s*<\/span>/);
			expect(rtf).toBe(reload(rtf, fontSize));
		});
	}
});

describe('non-breaking spaces', () => {
	it('are kept beside blocks, unlike collapsible whitespace', () => {
		const rtf = htmlToRtf(htmlEl('<p>a</p> <p>b</p><p> </p>'));
		// The space between two paragraphs shows on a line of its own, so it gets one.
		expect(rtf).toContain('\\par \\u160\\\'3f\\par \\pard b\\par \\pard \\u160\\\'3f\\par ');
	});
});
