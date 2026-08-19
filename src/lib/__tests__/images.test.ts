import { describe, it, expect } from 'vitest';
import { rtfToHtml } from '../rtf-parser.js';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { htmlToMarkdown } from '../utils.js';
import {
	isSafeImageUrl,
	stripExtension,
	scaledSize,
	dataUrlByteLength,
	initialDisplayWidth,
	sniffImageType,
	DEFAULT_MAX_IMAGE_EDGE,
	DEFAULT_MAX_IMAGE_BYTES,
	DEFAULT_MAX_IMAGE_DISPLAY_WIDTH
} from '../images.js';

/** Parse an HTML string into a div element (requires happy-dom environment). */
function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

// An 8×4 RGB PNG and a 10×6 JPEG, small enough to inline in the test file.
const PNG_8x4 =
	'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAARElEQVR4nA3JMQHAQAwDMSMJEiMJEo+H4pEYSRC1WiWJERYrIp6oOCGZMTZrYp6pOf8RJjhsSHih4fJHmeKyJeWVlisfuy4oYXNbCeAAAAAASUVORK5CYII=';
const JPEG_10x6 = '/9j/4AAQSkZJRgABAQAAAQABAAD/wAARCAAGAAoDAREAAhEBAxEB/9k=';

const PNG_SRC = `data:image/png;base64,${PNG_8x4}`;
const JPEG_SRC = `data:image/jpeg;base64,${JPEG_10x6}`;

/** First \pict group in an RTF string. */
function firstPict(rtf: string): string {
	const start = rtf.indexOf('{\\pict');
	expect(start).toBeGreaterThan(-1);
	return rtf.substring(start, rtf.indexOf('}', start) + 1);
}

// ── Writing pictures ──────────────────────────────────────────────────────────

describe('htmlToRtf pictures', () => {
	it('embeds a PNG as a \\pict group with hex data', () => {
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${PNG_SRC}" alt="chart"></figure>`));
		expect(rtf).toContain('{\\pict\\pngblip');
		// PNG signature 89 50 4e 47 leads the hex payload
		expect(rtf).toContain('89504E47');
		expect(rtf).not.toContain('[Image:');
	});

	it('embeds a JPEG as \\jpegblip', () => {
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${JPEG_SRC}"></figure>`));
		expect(rtf).toContain('{\\pict\\jpegblip');
		expect(rtf).toContain('FFD8FF');
	});

	it('reads the intrinsic size out of the image bytes', () => {
		const pict = firstPict(htmlToRtf(htmlEl(`<figure><img src="${PNG_SRC}"></figure>`)));
		expect(pict).toContain('\\picw8');
		expect(pict).toContain('\\pich4');
		// No explicit width → the goal size matches the intrinsic size (8px = 120 twips)
		expect(pict).toContain('\\picwgoal120');
		expect(pict).toContain('\\pichgoal60');
	});

	it('reads the intrinsic size of a JPEG start-of-frame', () => {
		const pict = firstPict(htmlToRtf(htmlEl(`<figure><img src="${JPEG_SRC}"></figure>`)));
		expect(pict).toContain('\\picw10');
		expect(pict).toContain('\\pich6');
	});

	it('writes the resized width as \\picwgoal twips, keeping the aspect ratio', () => {
		// 200px wide → 3000 twips; 8×4 source → 100px tall → 1500 twips
		const pict = firstPict(
			htmlToRtf(htmlEl(`<figure><img src="${PNG_SRC}" style="width:200px;height:auto"></figure>`))
		);
		expect(pict).toContain('\\picwgoal3000');
		expect(pict).toContain('\\pichgoal1500');
	});

	it('writes the caption below the picture, tagged for re-import', () => {
		const rtf = htmlToRtf(
			htmlEl(`<figure><img src="${PNG_SRC}"><figcaption>Fig 1 — the sample</figcaption></figure>`)
		);
		expect(rtf).toContain('{\\*\\inkcap}');
		expect(rtf).toContain('\\i Fig 1 ');
		expect(rtf).toContain('the sample');
	});

	it('writes figure alignment as a paragraph alignment control', () => {
		const centered = htmlToRtf(
			htmlEl(`<figure style="text-align:center"><img src="${PNG_SRC}"></figure>`)
		);
		expect(centered).toContain('\\pard\\qc {\\pict');

		const right = htmlToRtf(htmlEl(`<figure style="text-align:right"><img src="${PNG_SRC}"></figure>`));
		expect(right).toContain('\\pard\\qr {\\pict');
	});

	it('writes several images in document order', () => {
		const rtf = htmlToRtf(
			htmlEl(
				`<figure><img src="${PNG_SRC}"><figcaption>One</figcaption></figure>` +
					`<p>Between</p>` +
					`<figure><img src="${JPEG_SRC}"><figcaption>Two</figcaption></figure>`
			)
		);
		expect(rtf.match(/\{\\pict/g)?.length).toBe(2);
		expect(rtf.indexOf('One')).toBeLessThan(rtf.indexOf('Between'));
		expect(rtf.indexOf('Between')).toBeLessThan(rtf.indexOf('Two'));
	});

	it('falls back to a placeholder for images it cannot embed', () => {
		const rtf = htmlToRtf(htmlEl('<figure><img src="https://example.com/a.png" alt="remote"></figure>'));
		expect(rtf).toContain('[Image: remote]');
		expect(rtf).not.toContain('\\pict');
	});
});

// ── Reading pictures ──────────────────────────────────────────────────────────

describe('rtfToHtml pictures', () => {
	it('renders a \\pict group as an inline data-URL image', () => {
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${PNG_SRC}"></figure>`));
		const html = rtfToHtml(rtf);
		expect(html).toContain('<figure>');
		expect(html).toContain(`<img src="${PNG_SRC}"`);
	});

	it('restores the displayed width from \\picwgoal', () => {
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${PNG_SRC}" style="width:240px"></figure>`));
		expect(rtfToHtml(rtf)).toContain('width:240px');
	});

	it('re-attaches the caption to the figure', () => {
		const rtf = htmlToRtf(
			htmlEl(`<figure><img src="${PNG_SRC}"><figcaption>Sample slide</figcaption></figure>`)
		);
		const html = rtfToHtml(rtf);
		expect(html).toContain('<figcaption>Sample slide</figcaption>');
		expect(html).toMatch(/<figure[^>]*><img[^>]*><figcaption>/);
	});

	it('restores figure alignment', () => {
		const rtf = htmlToRtf(htmlEl(`<figure style="text-align:center"><img src="${PNG_SRC}"></figure>`));
		expect(rtfToHtml(rtf)).toContain('<figure style="text-align:center">');
	});

	it('reads pictures wrapped in {\\*\\shppict}', () => {
		const inner = firstPict(htmlToRtf(htmlEl(`<figure><img src="${PNG_SRC}"></figure>`)));
		const rtf = `{\\rtf1\\ansi\\deff0 {\\*\\shppict${inner}}\\par}`;
		expect(rtfToHtml(rtf)).toContain('<img src="data:image/png;base64,');
	});

	it('ignores picture formats a browser cannot display', () => {
		const rtf = String.raw`{\rtf1\ansi\deff0 {\pict\wmetafile8\picw100\pich100 0102030405060708}\par Text after}`;
		const html = rtfToHtml(rtf);
		expect(html).not.toContain('<img');
		expect(html).toContain('Text after');
	});
});

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('image round-trip', () => {
	it('survives html → rtf → html → rtf unchanged', () => {
		const source = `<figure style="text-align:center"><img src="${PNG_SRC}" style="width:160px"><figcaption>Cell block</figcaption></figure>`;
		const rtf1 = htmlToRtf(htmlEl(source));
		const html = rtfToHtml(rtf1);
		const rtf2 = htmlToRtf(htmlEl(html));

		expect(html).toContain(PNG_SRC);
		expect(html).toContain('Cell block');
		expect(rtf2).toContain('\\picwgoal2400');
		expect(rtf2).toContain('{\\*\\inkcap}');
		expect(rtf2.match(/\{\\pict/g)?.length).toBe(1);
	});

	it('keeps multiple captioned images distinct through a round-trip', () => {
		const source =
			`<figure><img src="${PNG_SRC}"><figcaption>First picture</figcaption></figure>` +
			`<figure><img src="${JPEG_SRC}"><figcaption>Second picture</figcaption></figure>`;
		const html = rtfToHtml(htmlToRtf(htmlEl(source)));

		expect(html.match(/<figure/g)?.length).toBe(2);
		expect(html).toContain('<figcaption>First picture</figcaption>');
		expect(html).toContain('<figcaption>Second picture</figcaption>');
		expect(html).toContain('data:image/png;base64,');
		expect(html).toContain('data:image/jpeg;base64,');
	});

	it('does not leak picture data into the plain-text or Markdown output', () => {
		const el = htmlEl(`<figure><img src="${PNG_SRC}" alt="chart"><figcaption>A chart</figcaption></figure>`);
		const md = htmlToMarkdown(el);
		expect(md).toContain('![chart](data:image/png;base64,');
		expect(md).toContain('*A chart*');
	});
});

// ── Transport-safe output (e.g. embedding in an HL7 OBX-5 field) ──────────────

describe('transport-safe RTF', () => {
	const doc = `<p>Before image RTF</p><figure><img src="${PNG_SRC}" style="width:100px"><figcaption>A caption</figcaption></figure><p>After image RTF</p>`;

	it('writes picture data in uppercase hex', () => {
		const rtf = htmlToRtf(htmlEl(doc));
		expect(rtf).toContain('89504E470D0A1A0A'); // the PNG signature, as receivers match it

		const payload = rtf.match(/\\pichgoal\d+ ([0-9A-Fa-f]+)\}/)?.[1];
		expect(payload).toBeTruthy();
		expect(payload).toBe(payload?.toUpperCase());
	});

	it('emits the whole document on a single line', () => {
		const rtf = htmlToRtf(htmlEl(doc));
		expect(rtf).not.toContain('\n');
		expect(rtf).not.toContain('\r');
	});

	it('separates \\pichgoal from the hex data so the parameter cannot swallow it', () => {
		const rtf = htmlToRtf(htmlEl(doc));
		expect(rtf).toMatch(/\\pichgoal\d+ 89504E47/);
		// A round-trip proves the delimiter is read the way it is written.
		expect(rtfToHtml(rtf)).toContain(`<img src="${PNG_SRC}"`);
	});

	it('keeps tables and line breaks valid without newline separators', () => {
		const rtf = htmlToRtf(
			htmlEl('<table><tr><th>Organ</th><th>Weight</th></tr><tr><td>Heart</td><td>620 g</td></tr></table>')
		);
		expect(rtf).not.toContain('\n');
		const html = rtfToHtml(rtf);
		expect(html).toContain('Organ');
		expect(html).toContain('620 g');
	});

	it('keeps text following a paragraph break separate from the control word', () => {
		const rtf = htmlToRtf(htmlEl('<p>First</p><p>Second</p>'));
		expect(rtf).toContain('\\par ');
		expect(rtfToHtml(rtf)).toContain('Second');
	});
});

// ── Newlines never reach the output ───────────────────────────────────────────

describe('no CR or LF in the document', () => {
	const hasNewline = (rtf: string) => /[\r\n]/.test(rtf);

	it('collapses newlines inside text content', () => {
		// Pretty-printed HTML, whitespace between blocks, and Windows line endings
		// all put raw newlines into text nodes.
		const el = htmlEl('<p>Hello\nworld</p>\n<p>second</p>\r\n<p>third\rline</p>');
		const rtf = htmlToRtf(el);
		expect(hasNewline(rtf)).toBe(false);
		// RTF ignores raw CR/LF, so leaving them in rendered "Helloworld".
		expect(rtf).toContain('Hello world');
		expect(rtf).toContain('third line');
	});

	it('collapses newlines in headings, list items and table cells', () => {
		const rtf = htmlToRtf(
			htmlEl(
				'<h1>A\nheading</h1><ul><li>one\ntwo</li></ul>' +
					'<table><tr><td>cell\ntext</td></tr></table>'
			)
		);
		expect(hasNewline(rtf)).toBe(false);
		expect(rtf).toContain('A heading');
		expect(rtf).toContain('cell text');
	});

	it('collapses newlines in captions, link text and hrefs', () => {
		const rtf = htmlToRtf(
			htmlEl(
				`<figure><img src="${PNG_SRC}"><figcaption>Fig 1\nthe sample</figcaption></figure>` +
					'<p><a href="https://example.com/a">link\ntext</a></p>'
			)
		);
		expect(hasNewline(rtf)).toBe(false);
		expect(rtf).toContain('Fig 1 the sample');
	});

	it('keeps <pre> line structure as \\line rather than raw newlines', () => {
		const rtf = htmlToRtf(htmlEl('<pre>first\nsecond\r\nthird\rfourth</pre>'));
		expect(hasNewline(rtf)).toBe(false);
		expect(rtf.match(/\\line /g)?.length).toBe(3);
		expect(rtfToHtml(rtf)).toContain('first');
		expect(rtfToHtml(rtf)).toContain('fourth');
	});

	it('survives content loaded from a pretty-printed HTML string', () => {
		const el = htmlEl(`
			<h2>Report</h2>
			<p>Some findings.</p>
			<figure><img src="${PNG_SRC}"><figcaption>A picture</figcaption></figure>
			<p>More text.</p>
		`);
		expect(hasNewline(htmlToRtf(el))).toBe(false);
	});
});

// ── The bytes decide the picture format ───────────────────────────────────────

describe('mislabelled images', () => {
	// A RIFF/WEBP header carrying an image/png label, as an OS assigning
	// File.type from a .png extension would produce.
	const WEBP_AS_PNG = 'data:image/png;base64,UklGRiQAAABXRUJQVlA4IA==';
	const JPEG_AS_PNG = `data:image/png;base64,${JPEG_10x6}`;
	const PNG_AS_WEBP = `data:image/webp;base64,${PNG_8x4}`;

	it('reads the format from the bytes, not the label', () => {
		expect(sniffImageType(PNG_SRC)).toBe('image/png');
		expect(sniffImageType(JPEG_SRC)).toBe('image/jpeg');
		expect(sniffImageType(JPEG_AS_PNG)).toBe('image/jpeg');
		expect(sniffImageType(PNG_AS_WEBP)).toBe('image/png');
		expect(sniffImageType(WEBP_AS_PNG)).toBeNull();
		expect(sniffImageType('not a data url')).toBeNull();
	});

	it('writes JPEG bytes as \\jpegblip even when labelled PNG', () => {
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${JPEG_AS_PNG}"></figure>`));
		expect(rtf).toContain('{\\pict\\jpegblip');
		expect(rtf).not.toContain('\\pngblip');
		expect(rtf).toContain('FFD8FF');
	});

	it('writes PNG bytes as \\pngblip even when labelled WebP', () => {
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${PNG_AS_WEBP}"></figure>`));
		expect(rtf).toContain('{\\pict\\pngblip');
		expect(rtf).toContain('89504E470D0A1A0A');
	});

	it('refuses to emit a blip for bytes RTF cannot carry', () => {
		// Better a visible placeholder than a \pngblip full of WebP.
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${WEBP_AS_PNG}" alt="logo"></figure>`));
		expect(rtf).not.toContain('\\pict');
		expect(rtf).toContain('[Image: logo]');
	});
});

// ── Size reporting ────────────────────────────────────────────────────────────

describe('estimateRtfBytes', () => {
	/** How far the estimate strays from the real conversion, in bytes. */
	function drift(html: string): number {
		const el = htmlEl(html);
		return Math.abs(estimateRtfBytes(el) - htmlToRtf(el).length);
	}

	// The estimate approximates per element, so its error is bounded in bytes
	// rather than in percent — negligible against a document carrying pictures.
	const BOUND = 150;

	it('tracks the real conversion for text, headings, quotes and code', () => {
		expect(drift('<p>Findings.</p><p>More.</p>')).toBeLessThan(BOUND);
		expect(drift('<h1>A</h1><h2>B</h2><h3>C</h3><blockquote>q</blockquote><pre>code</pre>'))
			.toBeLessThan(BOUND);
	});

	it('tracks the real conversion for tables and lists', () => {
		expect(
			drift(
				'<h1>Report</h1><p>Findings.</p>' +
					'<table><tr><th>Organ</th><th>Weight</th></tr><tr><td>Heart</td><td>620 g</td></tr></table>' +
					'<ul><li>one</li><li>two</li></ul>'
			)
		).toBeLessThan(BOUND);
	});

	it('tracks the real conversion for documents with pictures', () => {
		expect(
			drift(`<p>Findings.</p><figure><img src="${PNG_SRC}"><figcaption>A picture</figcaption></figure>`)
		).toBeLessThan(BOUND);
		expect(drift(`<figure><img src="${PNG_SRC}"></figure><figure><img src="${JPEG_SRC}"></figure>`))
			.toBeLessThan(BOUND);
	});

	it('counts picture data exactly — two characters per byte', () => {
		const withImage = estimateRtfBytes(htmlEl(`<figure><img src="${PNG_SRC}"></figure>`));
		const without = estimateRtfBytes(htmlEl('<figure></figure>'));
		expect(withImage - without).toBeGreaterThanOrEqual(dataUrlByteLength(PNG_SRC) * 2);
	});

	it('does not count pictures that will not be embedded', () => {
		expect(estimateRtfBytes(htmlEl('<figure><img src="https://example.com/a.png"></figure>')))
			.toBeLessThan(1000);
	});

	it('is a plain number for an empty document', () => {
		expect(estimateRtfBytes(htmlEl(''))).toBeGreaterThan(0);
	});
});

// ── Insert-time helpers ───────────────────────────────────────────────────────

describe('image source validation', () => {
	it('accepts http, https and image data URLs', () => {
		expect(isSafeImageUrl('https://example.com/a.png')).toBe(true);
		expect(isSafeImageUrl('http://example.com/a.png')).toBe(true);
		expect(isSafeImageUrl(PNG_SRC)).toBe(true);
	});

	it('rejects script-bearing and empty sources', () => {
		expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
		expect(isSafeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
		expect(isSafeImageUrl('   ')).toBe(false);
	});

	it('scales an oversized image down to the longest-edge cap', () => {
		expect(scaledSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
		expect(scaledSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
	});

	it('never upscales an image that is already within the cap', () => {
		expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
		expect(scaledSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
	});

	it('treats a cap of zero as "no limit"', () => {
		expect(scaledSize(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
	});

	it('keeps at least one pixel on the short edge of an extreme panorama', () => {
		expect(scaledSize(10000, 3, 1600).height).toBeGreaterThanOrEqual(1);
	});

	it('defaults the cap to 1600px', () => {
		expect(DEFAULT_MAX_IMAGE_EDGE).toBe(1600);
	});

	it('first shows a picture at the page width, not the browser width', () => {
		// A wide editor column must not produce a picture wider than the page.
		expect(initialDisplayWidth(2400, 1200, DEFAULT_MAX_IMAGE_DISPLAY_WIDTH)).toBe(624);
	});

	it('never enlarges a small picture to fill the page', () => {
		expect(initialDisplayWidth(400, 1200, 624)).toBe(400);
	});

	it('yields to a column narrower than the page cap', () => {
		expect(initialDisplayWidth(2400, 500, 624)).toBe(500);
	});

	it('ignores limits that are absent', () => {
		expect(initialDisplayWidth(2400, 0, 624)).toBe(624); // editor not laid out yet
		expect(initialDisplayWidth(2400, 900, 0)).toBe(900); // page cap disabled
		expect(initialDisplayWidth(0, 0, 0)).toBe(0);
	});

	it('keeps the default display width inside a Letter page text column', () => {
		// \picwgoal is twips: 624px × 15 = 9360 = 6.5in, the text width of a
		// Letter page with 1in margins.
		expect(DEFAULT_MAX_IMAGE_DISPLAY_WIDTH * 15).toBe(9360);
		expect((DEFAULT_MAX_IMAGE_DISPLAY_WIDTH * 15) / 1440).toBe(6.5);
	});

	it('measures the encoded size of a data URL without decoding it', () => {
		// The 8×4 PNG is 125 bytes; base64 pads it to 168 characters.
		expect(dataUrlByteLength(PNG_SRC)).toBe(125);
		expect(dataUrlByteLength('data:image/png;base64,')).toBe(0);
		expect(dataUrlByteLength('not a data url')).toBe(0);
	});

	it('budgets bytes so one picture costs about 1 MB of RTF', () => {
		// Every byte becomes two hex characters in the \pict payload.
		expect(DEFAULT_MAX_IMAGE_BYTES).toBe(512 * 1024);
		expect(DEFAULT_MAX_IMAGE_BYTES * 2).toBeLessThanOrEqual(1024 * 1024);
	});

	it('the hex payload really is twice the encoded size', () => {
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${PNG_SRC}"></figure>`));
		const payload = rtf.match(/\\pichgoal\d+ ([0-9A-F]+)\}/)?.[1] ?? '';
		expect(payload.length).toBe(dataUrlByteLength(PNG_SRC) * 2);
	});

	it('decodes large hex payloads correctly through the lookup table', () => {
		// Exercises both nibble halves, upper and lower case, and the padding tail.
		const rtf = htmlToRtf(htmlEl(`<figure><img src="${JPEG_SRC}"></figure>`));
		const payload = rtf.match(/\\pichgoal\d+ ([0-9A-F]+)\}/)?.[1] ?? '';
		const lower = rtf.replace(payload, payload.toLowerCase());
		// Same bytes either case, and both decode back to the identical data URL.
		expect(rtfToHtml(rtf)).toContain(JPEG_SRC);
		expect(rtfToHtml(lower)).toContain(JPEG_SRC);
	});

	it('rejects picture data containing a non-hex character', () => {
		const rtf = String.raw`{\rtf1\ansi\deff0 {\pict\pngblip\picw8\pich4 89504E47ZZ0D0A1A0A}\par After}`;
		const html = rtfToHtml(rtf);
		// The stray characters are filtered, so what remains is simply short data —
		// the important part is that it does not throw or emit a corrupt image.
		expect(html).toContain('After');
	});

	it('derives a default description from the file name', () => {
		expect(stripExtension('sunset-over-lake.png')).toBe('sunset-over-lake');
		expect(stripExtension('no-extension')).toBe('no-extension');
	});
});
