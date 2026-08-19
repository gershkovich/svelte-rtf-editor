/**
 * HTML to RTF converter
 *
 * Walks a contenteditable DOM tree and produces a valid RTF 1.x string.
 * Supports: bold, italic, underline, strikethrough, font sizes (h1–h3),
 * foreground colors (\cf), paragraphs, bullet/numbered lists, blockquotes,
 * code blocks, hyperlinks, images (embedded as \pict picture groups with
 * their captions), horizontal rules, line breaks, and Unicode characters.
 *
 * Background color is intentionally not written — RTF highlight support
 * is inconsistent across viewers (TextEdit uses \AppleHighlight, not \highlight).
 */

// ── Types ──

interface RGB {
	r: number;
	g: number;
	b: number;
}

interface WalkContext {
	colorIndex: Map<string, number>;
	inPre: boolean;
	listCounter: number;
	inTableCell: boolean;
	/** The element htmlToRtf was called on — used to detect top-level images. */
	root: Node | null;
}

interface PixelSize {
	w: number;
	h: number;
}

/** 1 px at 96 dpi = 15 twips (1 twip = 1/1440 in). */
const TWIPS_PER_PX = 15;

// ── Color helpers ──

function parseColor(colorStr: string): RGB | null {
	if (!colorStr) return null;
	const s = colorStr.trim().toLowerCase();

	// rgb(r, g, b) or rgba(r, g, b, a)
	const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch) {
		return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
	}

	// Hex
	const hexMatch = s.match(/^#([0-9a-f]{3,8})$/);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
		return {
			r: parseInt(hex.substring(0, 2), 16),
			g: parseInt(hex.substring(2, 4), 16),
			b: parseInt(hex.substring(4, 6), 16)
		};
	}

	// Basic named colors
	const named: Record<string, RGB> = {
		black: { r: 0, g: 0, b: 0 },
		white: { r: 255, g: 255, b: 255 },
		red: { r: 255, g: 0, b: 0 },
		green: { r: 0, g: 128, b: 0 },
		blue: { r: 0, g: 0, b: 255 },
		yellow: { r: 255, g: 255, b: 0 },
		orange: { r: 255, g: 165, b: 0 },
		purple: { r: 128, g: 0, b: 128 },
		gray: { r: 128, g: 128, b: 128 },
		grey: { r: 128, g: 128, b: 128 }
	};

	return named[s] || null;
}

function colorKey(c: RGB): string {
	return `${c.r},${c.g},${c.b}`;
}

// ── RTF text escaping ──

function escapeRtf(text: string): string {
	// RTF readers ignore raw CR/LF, so a newline inside text content rendered as
	// nothing ("Hello\nworld" → "Helloworld") while still emitting bytes that a
	// CR-terminated transport treats as a record separator. Collapsing a run to
	// the single space a browser would have shown is both safer and more
	// faithful. Text is never split on newlines after this point, so <pre>
	// content must be divided into lines before it gets here.
	const source = text.replace(/[\r\n]+/g, ' ');

	let out = '';
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		const code = source.charCodeAt(i);

		if (ch === '\\') out += '\\\\';
		else if (ch === '{') out += '\\{';
		else if (ch === '}') out += '\\}';
		else if (code > 127) {
			out += `\\u${code}\\'3f`;
		} else {
			out += ch;
		}
	}
	return out;
}

// ── Image helpers ──

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP = (() => {
	const table = new Int16Array(128).fill(-1);
	for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
	return table;
})();

// Uppercase: the RTF spec treats picture data as case-insensitive, but
// downstream consumers (HL7 interface engines, for one) sometimes match the
// leading PNG signature literally as 89504E470D0A1A0A.
const HEX_BYTE: string[] = Array.from({ length: 256 }, (_, i) =>
	i.toString(16).padStart(2, '0').toUpperCase()
);

/** Decode base64 to bytes without depending on atob/Buffer (works in any runtime). */
function base64ToBytes(b64: string): Uint8Array | null {
	let buffer = 0;
	let bits = 0;
	let out = 0;
	const bytes = new Uint8Array(Math.ceil((b64.length * 3) / 4));

	for (let i = 0; i < b64.length; i++) {
		const code = b64.charCodeAt(i);
		if (code === 61 /* = */) break;
		const v = code < 128 ? B64_LOOKUP[code] : -1;
		if (v < 0) {
			// Whitespace inside a data URL is legal; anything else is not base64.
			if (code === 32 || code === 9 || code === 10 || code === 13) continue;
			return null;
		}
		buffer = (buffer << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes[out++] = (buffer >> bits) & 0xff;
		}
	}

	return out > 0 ? bytes.subarray(0, out) : null;
}

function bytesToHex(bytes: Uint8Array): string {
	const parts: string[] = new Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) parts[i] = HEX_BYTE[bytes[i]];
	return parts.join('');
}

/**
 * Picture format according to the bytes themselves, not the label they arrived
 * with. A file named .png can hold WebP — operating systems assign the MIME
 * type from the extension — and writing those bytes as \pngblip produces a
 * picture no reader can decode.
 */
function sniffBytes(b: Uint8Array): 'png' | 'jpeg' | null {
	if (
		b.length >= 8 &&
		b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
		b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
	) {
		return 'png';
	}
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
	return null;
}

/** Read the intrinsic size out of the PNG IHDR chunk. */
function pngSize(b: Uint8Array): PixelSize | null {
	if (b.length < 24) return null;
	if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
	const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
	const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
	return w && h ? { w, h } : null;
}

/** Read the intrinsic size out of the first JPEG start-of-frame marker. */
function jpegSize(b: Uint8Array): PixelSize | null {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) { i++; continue; }
		const marker = b[i + 1];
		// Standalone markers carry no length field.
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
		const len = (b[i + 2] << 8) | b[i + 3];
		// SOF0–SOF15, excluding DHT (c4), JPG (c8) and DAC (cc)
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			const h = (b[i + 5] << 8) | b[i + 6];
			const w = (b[i + 7] << 8) | b[i + 8];
			return w && h ? { w, h } : null;
		}
		if (len < 2) break;
		i += 2 + len;
	}
	return null;
}

function parsePx(value: string | null | undefined): number {
	if (!value) return 0;
	const m = value.match(/^([\d.]+)px$/);
	return m ? Math.round(parseFloat(m[1])) : 0;
}

/**
 * Displayed size of an image in CSS pixels. Prefers the explicit width the
 * editor writes when the user resizes, then the width/height attributes, then
 * the intrinsic size decoded from the image bytes (naturalWidth is unavailable
 * when the DOM is detached or server-side).
 */
function displaySize(el: HTMLElement, natural: PixelSize): PixelSize {
	const img = el as HTMLImageElement;
	const nw = natural.w || img.naturalWidth || 0;
	const nh = natural.h || img.naturalHeight || 0;

	const attrW = parseInt(el.getAttribute('width') || '', 10);
	const attrH = parseInt(el.getAttribute('height') || '', 10);

	const w = parsePx(el.style?.width) || (Number.isFinite(attrW) ? attrW : 0) || nw;
	let h = parsePx(el.style?.height) || (Number.isFinite(attrH) ? attrH : 0);
	if (!h) h = nw && nh ? Math.round((w * nh) / nw) : nh;

	return { w, h };
}

/**
 * Convert a data-URL <img> into an RTF \pict group. Returns '' for images the
 * RTF format cannot carry (remote URLs, or formats other than PNG/JPEG), so
 * the caller can fall back to a text placeholder.
 */
function pictureRtf(el: HTMLElement): string {
	const src = el.getAttribute('src') || '';
	// Accept any image data URL and let the bytes decide the format — the label
	// is not trustworthy, and a correctly-labelled PNG is not the only way to
	// arrive at PNG bytes.
	const m = src.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
	if (!m) return '';

	const bytes = base64ToBytes(m[1]);
	if (!bytes || bytes.length === 0) return '';

	const format = sniffBytes(bytes);
	// Neither PNG nor JPEG: RTF cannot carry it, so fall back to the placeholder
	// rather than emitting a blip whose declared type contradicts its content.
	if (!format) return '';
	const isPng = format === 'png';

	const natural = (isPng ? pngSize(bytes) : jpegSize(bytes)) ?? { w: 0, h: 0 };
	const size = displaySize(el, natural);
	if (!size.w || !size.h) return '';

	const picw = natural.w || size.w;
	const pich = natural.h || size.h;

	// The space after \pichgoal is the control word's delimiter — without it the
	// leading hex digits would be read as part of its numeric parameter.
	return (
		`{\\pict${isPng ? '\\pngblip' : '\\jpegblip'}` +
		`\\picw${picw}\\pich${pich}` +
		`\\picwgoal${Math.round(size.w * TWIPS_PER_PX)}\\pichgoal${Math.round(size.h * TWIPS_PER_PX)} ` +
		`${bytesToHex(bytes)}}`
	);
}

/** Picture group if the bytes are embeddable, otherwise an italic placeholder. */
function imageBody(el: HTMLElement): string {
	const pict = pictureRtf(el);
	if (pict) return pict;
	const label = el.getAttribute('alt') || el.getAttribute('src') || 'image';
	return `\\i [Image: ${escapeRtf(label)}]\\i0 `;
}

/** \ql / \qc / \qr for a figure's text-align. */
function alignControl(el: HTMLElement): string {
	const align = (el.style?.textAlign || '').toLowerCase();
	if (align === 'center') return '\\qc';
	if (align === 'right') return '\\qr';
	if (align === 'justify') return '\\qj';
	return '\\ql';
}

/** Decoded byte length of a base64 payload, without decoding it. */
function base64ByteLength(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** Bytes of RTF header, font table and colour table that precede the body. */
const RTF_PREAMBLE_BYTES = 200;

/** Control words wrapping one \pict group. */
const PICTURE_OVERHEAD_BYTES = 80;

/**
 * Control-word bytes the writer wraps around each kind of element — the opening
 * and closing runs measured from walkChildren. Anything not listed costs
 * nothing of its own beyond the text it contains.
 */
const BLOCK_OVERHEAD_BYTES: Record<string, number> = {
	p: 14,
	div: 14,
	h1: 32,
	h2: 32,
	h3: 32,
	li: 35,
	blockquote: 22,
	pre: 27,
	figure: 15,
	figcaption: 29,
	tr: 45,
	td: 55,
	th: 69 // a header cell also carries \clbrdrb\brdrs
};

/**
 * Size htmlToRtf would produce, without doing the conversion.
 *
 * Useful for a live indicator — the exact figure requires hex-encoding every
 * picture, which is too much work to repeat on each keystroke.
 *
 * Picture data, which dominates any document that has one, is counted exactly:
 * two characters per byte. Everything else is approximated per element, which
 * puts the error at a bounded number of bytes rather than a proportion — so it
 * is negligible precisely when the number matters, and never more than a few
 * hundred bytes even when it does not. The output is ASCII, so bytes and
 * characters are the same number.
 */
export function estimateRtfBytes(editorEl: HTMLElement): number {
	let total = RTF_PREAMBLE_BYTES;

	for (const img of Array.from(editorEl.querySelectorAll('img'))) {
		const src = img.getAttribute('src') || '';
		const comma = src.indexOf(',');
		// A picture that cannot be embedded costs only its placeholder text.
		if (!src.startsWith('data:image/') || comma < 0) continue;
		total += base64ByteLength(src.slice(comma + 1)) * 2 + PICTURE_OVERHEAD_BYTES;
	}

	total += (editorEl.textContent || '').length;
	for (const el of Array.from(editorEl.querySelectorAll('*'))) {
		total += BLOCK_OVERHEAD_BYTES[el.tagName.toLowerCase()] ?? 0;
	}

	return total;
}

// ── DOM walker / RTF generator ──

export function htmlToRtf(editorEl: HTMLElement): string {
	const colorMap = new Map<string, RGB>();
	colorMap.set('0,0,0', { r: 0, g: 0, b: 0 });

	collectColors(editorEl, colorMap);

	const colors = Array.from(colorMap.values());

	const colorIndex = new Map<string, number>();
	colors.forEach((c, i) => {
		colorIndex.set(colorKey(c), i + 1);
	});

	// Emit a leading auto/default color entry for broad RTF compatibility:
	// \cf0 = auto, first explicit color starts at \cf1.
	let colorTable = '{\\colortbl;';
	for (const c of colors) {
		colorTable += `\\red${c.r}\\green${c.g}\\blue${c.b};`;
	}
	colorTable += '}';

	const fontTable =
		'{\\fonttbl' +
		'{\\f0\\fswiss\\fcharset0 Helvetica;}' +
		'{\\f1\\froman\\fcharset0 Georgia;}' +
		'{\\f2\\fmodern\\fcharset0 Courier New;}' +
		'}';

	const body = walkChildren(editorEl, {
		colorIndex,
		inPre: false,
		listCounter: 0,
		inTableCell: false,
		root: editorEl
	});

	const rtf =
		'{\\rtf1\\ansi\\ansicpg1252\\deff0' +
		fontTable +
		colorTable +
		'\\viewkind4\\uc1' +
		'\\pard\\f0\\fs24 ' +
		body +
		'}';

	// Backstop for the single-line guarantee. escapeRtf already collapses CR/LF
	// out of every text path, so this should never have anything to do — but the
	// document is worthless to a CR-terminated transport if one slips through,
	// and no newline carries meaning in the output.
	return rtf.replace(/[\r\n]+/g, ' ');
}

function addColor(colorStr: string | null | undefined, colorMap: Map<string, RGB>): void {
	if (!colorStr) return;
	const c = parseColor(colorStr);
	if (c) colorMap.set(colorKey(c), c);
}

function collectColors(el: HTMLElement, colorMap: Map<string, RGB>): void {
	addColor(el.style?.color, colorMap);
	// <font color="..."> is produced by execCommand('foreColor')
	if (el.tagName?.toLowerCase() === 'font') addColor(el.getAttribute('color'), colorMap);
	for (const child of el.children) collectColors(child as HTMLElement, colorMap);
}

function walkChildren(parent: Node, ctx: WalkContext): string {
	let rtf = '';
	const children = parent.childNodes;

	for (let i = 0; i < children.length; i++) {
		const node = children[i];

		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent || '';
			if (ctx.inPre) {
				// Split before escaping — escapeRtf collapses newlines, so the
				// line structure a <pre> block depends on has to become \line
				// first. Handles CR, LF and CRLF alike.
				rtf += text.split(/\r\n|\r|\n/).map(escapeRtf).join('\\line ');
			} else {
				rtf += escapeRtf(text);
			}
			continue;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) continue;

		const el = node as HTMLElement;
		const tag = el.tagName.toLowerCase();

		switch (tag) {
			case 'h1':
				rtf += `\\pard\\f1\\fs48\\b ${walkChildren(el, ctx)}\\b0\\f0\\fs24\\par `;
				break;

			case 'h2':
				rtf += `\\pard\\f1\\fs36\\b ${walkChildren(el, ctx)}\\b0\\f0\\fs24\\par `;
				break;

			case 'h3':
				rtf += `\\pard\\f0\\fs28\\b ${walkChildren(el, ctx)}\\b0\\fs24\\par `;
				break;

			case 'p':
			case 'div': {
				// Inside a table cell \pard is already declared; just emit inline content.
				if (ctx.inTableCell) {
					rtf += walkChildren(el, ctx);
					break;
				}
				// A <p> with no children or only a single <br> is a blank line —
				// emit a bare \par rather than \pard \line\par, which adds an extra line.
				const isBlankLine =
					el.childNodes.length === 0 ||
					(el.childNodes.length === 1 && el.childNodes[0].nodeName === 'BR');
				if (isBlankLine) {
					rtf += '\\par ';
					break;
				}
				const inlineRtf = walkChildren(el, ctx);
				const colorPrefix = getColorPrefix(el, ctx);
				const colorSuffix = colorPrefix ? '\\cf0 ' : '';
				rtf += `\\pard ${colorPrefix}${inlineRtf}${colorSuffix}\\par `;
				break;
			}

			case 'table': {
				const PAGE_WIDTH = 8640; // twips ≈ 6 in (standard letter body width)
				const rows = Array.from(
					el.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')
				);
				for (const row of rows) {
					const cells = Array.from(row.querySelectorAll(':scope > td, :scope > th'));
					if (cells.length === 0) continue;
					const isHeader = cells.some(c => c.tagName.toLowerCase() === 'th');

					// Derive right-edge twip positions from the width:X% style set by the parser.
					// Fall back to equal column widths if the style is absent.
					const cellRights: number[] = [];
					let cumTwips = 0;
					for (const cell of cells) {
						const pct = parseFloat((cell as HTMLElement).style.width) || (100 / cells.length);
						cumTwips += Math.round((pct / 100) * PAGE_WIDTH);
						cellRights.push(cumTwips);
					}
					cellRights[cellRights.length - 1] = PAGE_WIDTH; // snap last edge to avoid rounding drift

					// Row definition
					let rowRtf = '{\\trowd\\trgaph120';
					for (let ci = 0; ci < cells.length; ci++) {
						if (isHeader) rowRtf += `\\clbrdrb\\brdrs`;
						rowRtf += `\\cellx${cellRights[ci]}`;
					}
					rowRtf += '\\trkeep\\intbl{';

					// Cell bodies
					const cellCtx = { ...ctx, inTableCell: true };
					for (const cell of cells) {
						const content = walkChildren(cell as HTMLElement, cellCtx);
						rowRtf += `{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 ${content}\\par}\\cell`;
					}
					rowRtf += '}\\intbl\\row}';
					rtf += rowRtf;
				}
				break;
			}

			case 'blockquote':
				rtf += `\\pard\\li720\\i ${walkChildren(el, ctx)}\\i0\\par `;
				break;

			case 'pre':
				rtf += `\\pard\\f2\\fs20 ${walkChildren(el, { ...ctx, inPre: true })}\\f0\\fs24\\par `;
				break;

			case 'hr':
				rtf += `\\pard\\qc \\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\par `;
				break;

			case 'ul': {
				const items = el.querySelectorAll(':scope > li');
				items.forEach((li) => {
					rtf += `\\pard\\li720\\fi-360\\bullet\\tab ${walkChildren(li, ctx)}\\par `;
				});
				break;
			}

			case 'ol': {
				let counter = 1;
				const items = el.querySelectorAll(':scope > li');
				items.forEach((li) => {
					rtf += `\\pard\\li720\\fi-360 ${counter}.\\tab ${walkChildren(li, ctx)}\\par `;
					counter++;
				});
				break;
			}

			case 'li':
				rtf += walkChildren(el, ctx);
				break;

			case 'strong':
			case 'b':
				rtf += `\\b ${walkChildren(el, ctx)}\\b0 `;
				break;

			case 'em':
			case 'i':
				rtf += `\\i ${walkChildren(el, ctx)}\\i0 `;
				break;

			case 'u':
				rtf += `\\ul ${walkChildren(el, ctx)}\\ulnone `;
				break;

			case 's':
			case 'strike':
			case 'del':
				rtf += `\\strike ${walkChildren(el, ctx)}\\strike0 `;
				break;

			case 'sup':
				rtf += `\\super ${walkChildren(el, ctx)}\\nosupersub `;
				break;

			case 'sub':
				rtf += `\\sub ${walkChildren(el, ctx)}\\nosupersub `;
				break;

			case 'code':
				if (!ctx.inPre) {
					rtf += `\\f2 ${walkChildren(el, ctx)}\\f0 `;
				} else {
					rtf += walkChildren(el, ctx);
				}
				break;

			case 'a': {
				const href = el.getAttribute('href') || '';
				const inner = walkChildren(el, ctx);
				if (href) {
					rtf += `{\\field{\\*\\fldinst HYPERLINK "${escapeRtf(href)}"}{\\fldrslt\\ul\\cf1 ${inner}\\cf0\\ulnone }}`;
				} else {
					rtf += inner;
				}
				break;
			}

			// <figure><img><figcaption>caption</figcaption></figure> — the shape the
			// editor inserts. The caption is written as its own paragraph below the
			// picture, tagged with an ignorable {\*\inkcap} destination so it can be
			// re-attached to the figure on import. Other RTF readers skip the tag and
			// simply show an italic line under the image.
			case 'figure': {
				const img = el.querySelector('img');
				const caption = (el.querySelector('figcaption')?.textContent || '').trim();
				const align = alignControl(el);

				if (img) rtf += `\\pard${align} ${imageBody(img as HTMLElement)}\\par `;
				else rtf += walkChildren(el, ctx);

				if (caption) {
					rtf += `{\\*\\inkcap}\\pard${align}\\i ${escapeRtf(caption)}\\i0\\par `;
				}
				break;
			}

			case 'img': {
				// A picture directly under the editor root has no paragraph of its
				// own; anywhere else it is inline content of the enclosing block.
				const standalone = el.parentNode === ctx.root;
				rtf += standalone ? `\\pard ${imageBody(el)}\\par ` : imageBody(el);
				break;
			}

			case 'br':
				rtf += '\\line ';
				break;

			case 'span': {
				const colorPfx = getColorPrefix(el, ctx);
				const sizePfx = getSizePrefix(el);
				const sizesfx = sizePfx ? '\\fs24 ' : '';
				const colorSfx = colorPfx ? '\\cf0 ' : '';

				rtf += `${colorPfx}${sizePfx}${walkChildren(el, ctx)}${sizesfx}${colorSfx}`;
				break;
			}

			// <font color="..."> is produced by execCommand('foreColor') in contenteditable
			case 'font': {
				const colorPfx = getColorPrefix(el, ctx);
				const colorSfx = colorPfx ? '\\cf0 ' : '';
				rtf += `${colorPfx}${walkChildren(el, ctx)}${colorSfx}`;
				break;
			}

			default:
				rtf += walkChildren(el, ctx);
				break;
		}
	}

	return rtf;
}

function getColorPrefix(el: HTMLElement, ctx: WalkContext): string {
	// Support both inline style.color (spans) and the color attribute (<font>)
	const color = el.style?.color ||
		(el.tagName.toLowerCase() === 'font' ? (el.getAttribute('color') ?? '') : '');
	if (!color) return '';
	const c = parseColor(color);
	if (!c) return '';
	const idx = ctx.colorIndex.get(colorKey(c));
	if (idx != null) return `\\cf${idx} `;
	return '';
}

function getSizePrefix(el: HTMLElement): string {
	const fs = el.style?.fontSize;
	if (!fs) return '';
	const ptMatch = fs.match(/([\d.]+)\s*pt/);
	if (ptMatch) {
		const halfPoints = Math.round(parseFloat(ptMatch[1]) * 2);
		return `\\fs${halfPoints} `;
	}
	const pxMatch = fs.match(/([\d.]+)\s*px/);
	if (pxMatch) {
		const halfPoints = Math.round(parseFloat(pxMatch[1]) * 0.75 * 2);
		return `\\fs${halfPoints} `;
	}
	return '';
}
