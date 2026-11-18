/**
 * HTML to RTF converter
 *
 * Walks a contenteditable DOM tree and produces a valid RTF 1.x string.
 * Supports: a document font and body size (DEFAULT_FONT_FAMILY at DEFAULT_FONT_SIZE
 * points by default, set with RtfWriteOptions), bold, italic, underline, strikethrough, font sizes, headings
 * (h1–h6), foreground colors (\cf), paragraphs with their alignment and indents,
 * bullet/numbered lists and lists inside them, blockquotes, code blocks,
 * hyperlinks, tables with merged cells, images (embedded as \pict picture groups
 * with their captions), horizontal rules, page breaks, line breaks, and Unicode
 * characters.
 *
 * Background color is intentionally not written — RTF highlight support
 * is inconsistent across viewers (TextEdit uses \AppleHighlight, not \highlight).
 */

import { tableModel, columnShares, tableRowsInOrder, rowCells, type GridCell } from './table-model.js';

// ── Types ──

interface RGB {
	r: number;
	g: number;
	b: number;
}

/** Options for htmlToRtf. */
export interface RtfWriteOptions {
	/**
	 * Font for the whole document: body text, headings, lists and tables.
	 * Code keeps a monospace font. Default: DEFAULT_FONT_FAMILY.
	 */
	fontFamily?: string;
	/**
	 * Body text size in points. Headings scale from it. Default: 12.
	 */
	fontSize?: number;
}

/**
 * Font used when no fontFamily is given: what the editor and the viewer show, and what the RTF
 * names. This is the one place the default is named; the size estimate, the components and the
 * tests follow it. An application that wants another font does not change this: it passes
 * `fontFamily` to the editor, to the viewer and to htmlToRtf.
 */
export const DEFAULT_FONT_FAMILY = 'Segoe UI';

/** Body text size, in points, used when no fontSize is given. */
export const DEFAULT_FONT_SIZE = 12;

/** Largest font size RTF readers accept (Word's limit), in points. */
const MAX_FONT_SIZE = 1638;

/**
 * Heading sizes as a multiple of the body size: at 12 pt, h1 is 24 pt, h2 18 pt
 * and h3 14 pt. The parser reads headings back with the same ratios.
 */
export const HEADING_SCALE = { h1: 2, h2: 1.5, h3: 7 / 6 } as const;

/**
 * Every heading level's size as a multiple of the body size. The editor offers h1 to h3; h4, h5
 * and h6 arrive in pasted text and are written at the sizes a browser shows them: the body
 * size, 0.83 and 0.67 of it.
 */
const ALL_HEADING_SCALES: Record<string, number> = { ...HEADING_SCALE, h4: 1, h5: 5 / 6, h6: 2 / 3 };

const HEADING_TAGS = new Set(Object.keys(ALL_HEADING_SCALES));

/**
 * Code blocks are set slightly smaller than the body: 10 pt at 12 pt. The parser reads a code
 * block back by the same ratio.
 */
export const PRE_SCALE = 5 / 6;

/**
 * The color of link text. A document with a link carries it as the first entry of its color
 * table, so a link can be told from underlined text; the parser drops it again inside a link,
 * where the <a> already says it.
 */
export const LINK_COLOR = { r: 0, g: 0, b: 255 } as const;

interface WalkContext {
	colorIndex: Map<string, number>;
	/** Body text size in RTF half-points (\fsN). */
	bodySize: number;
	inPre: boolean;
	listCounter: number;
	inTableCell: boolean;
	/** The element htmlToRtf was called on — used to detect top-level images. */
	root: Node | null;
	/**
	 * For a node, the nearest sibling before it that shows something (see shownBefore). Kept for
	 * the length of one write, during which the document does not change.
	 */
	shownBefore: Map<Node, Node | null>;
	/*
	 * The character formatting in effect where the walker is. A closing tag restores
	 * this, the ENCLOSING state, rather than a fixed default: an inner </b> must not
	 * end an outer <b>, and a sized word inside a heading returns to the heading's
	 * size, not the body's.
	 */
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	/** Current size in half-points (\fsN). */
	size: number;
	/** Current color-table index (\cfN); 0 is the reader's automatic color. */
	color: number;
	/** Superscript or subscript in effect, if any. */
	script: 'super' | 'sub' | null;
	/** Inside inline code, which already set the monospace font. */
	mono: boolean;
	/** Left indent of the enclosing indented blocks, in twips (\liN). */
	indent: number;
	/**
	 * The alignment the blocks here take when they set none of their own (\qc, \qr, \qj), or ''
	 * for left: that of the table cell being written, or of a <div> or <center> around them.
	 */
	cellAlign: string;
}

interface PixelSize {
	w: number;
	h: number;
}

/** 1 px at 96 dpi = 15 twips (1 twip = 1/1440 in). */
const TWIPS_PER_PX = 15;

/**
 * The longest length written, in twips: 22 inches, the largest page Word has. An indent, a tab
 * stop or a picture's size beyond it means nothing on any page, and a number of ten digits or
 * more is past what RTF's 32-bit parameters hold.
 */
const MAX_TWIPS = 31680;

/**
 * The deepest nesting of elements written element by element. A browser's HTML parser stops at
 * 512, so only a DOM built by script goes deeper; a few thousand deep, walking it one call per
 * element ran out of stack. Past this depth an element is written as its text.
 */
const MAX_ELEMENT_DEPTH = 600;

// ── Color helpers ──

function parseColor(colorStr: string): RGB | null {
	if (!colorStr) return null;
	const s = colorStr.trim().toLowerCase();

	// rgb(r, g, b) or rgba(r, g, b, a)
	// (A component is 0 to 255: a color table that says \red999 is not one every reader accepts.)
	const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch) {
		const part = (digits: string) => Math.min(255, +digits);
		return { r: part(rgbMatch[1]), g: part(rgbMatch[2]), b: part(rgbMatch[3]) };
	}

	// Hex: #rgb, #rgba, #rrggbb or #rrggbbaa, and no other length. "#abcd" read as six digits
	// had no blue, and was written to the color table as \blueNaN.
	const hexMatch = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length <= 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
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

		if (code < 32 || code === 127) {
			// A control character is not text. Written as it is, it reaches the receiving
			// system as a raw byte, and 0x0B and 0x1C are the bytes that start and end an HL7
			// message on the wire. A tab is passed through (see escapeTabs); a vertical tab
			// or a form feed, which a browser shows as a space, is one; the rest are dropped.
			if (code === 9) out += ch;
			else if (code === 11 || code === 12) out += ' ';
		} else if (ch === '\\') out += '\\\\';
		else if (ch === '{') out += '\\{';
		else if (ch === '}') out += '\\}';
		else if (code > 127) {
			// RTF's \uN is a SIGNED 16-bit number: from U+8000 up, and for each half of
			// an emoji's surrogate pair, it is written as N - 65536. Written unsigned,
			// Word and Epic read it as a different character.
			out += `\\u${code > 32767 ? code - 65536 : code}\\'3f`;
		} else {
			out += ch;
		}
	}
	return out;
}

/**
 * Text with its tabs written as RTF's \tab when the screen shows them as tabs. Any other tab is
 * passed through as before (1.5.3), unchanged by this.
 */
function escapeTabs(text: string, tabsShow: boolean): string {
	if (!tabsShow || !text.includes('\t')) return escapeRtf(text);
	return text.split('\t').map(escapeRtf).join('\\tab ');
}

/**
 * Whether a text node's tabs show as tabs: it sits inside an element whose inline white-space
 * keeps them. That is what the editor's Tab key inserts (Chromium's
 * <span style="white-space:pre">\t</span>) and Safari's older Apple-tab-span.
 */
function showsTabs(node: Node): boolean {
	for (let el = node.parentElement; el; el = el.parentElement) {
		const ws = el.style?.whiteSpace;
		if (ws) return ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces';
		if (el.classList?.contains('Apple-tab-span')) return true;
	}
	return false;
}

/**
 * Whether a text node's line breaks show as line breaks: it sits inside an element whose inline
 * white-space keeps them (pre-wrap is what many editors and mail programs set on pasted text).
 */
function showsLineBreaks(node: Node): boolean {
	for (let el = node.parentElement; el; el = el.parentElement) {
		const ws = el.style?.whiteSpace;
		if (ws) return ws === 'pre' || ws === 'pre-wrap' || ws === 'pre-line' || ws === 'break-spaces';
	}
	return false;
}

// ── Elements that are not shown ──

/** Elements whose content is never shown: a stylesheet, a script, a template. */
const UNSHOWN_TAGS = new Set(['style', 'script', 'template', 'noscript', 'head', 'title', 'meta', 'link', 'base']);

/**
 * Whether an element is not shown on screen, so that nothing in it is written: a pasted page's
 * <style> or <script>, an element with `hidden`, display: none or visibility: hidden, and Word's
 * hidden text (mso-hide: all). What the person does not see must not reach the report.
 */
function isHidden(el: Element): boolean {
	if (UNSHOWN_TAGS.has(el.tagName.toLowerCase())) return true;
	if (el.hasAttribute('hidden')) return true;
	const style = (el as HTMLElement).style;
	if (style?.display === 'none') return true;
	// visibility: hidden hides an element's text but not what an element inside it shows again
	// with visibility: visible. Only without one of those is the whole of it left out; with
	// one, each piece of text is asked (isUnseen).
	if (style?.visibility === 'hidden' && !Array.from(el.querySelectorAll<HTMLElement>('[style]')).some((d) => d.style?.visibility === 'visible')) {
		return true;
	}
	return /mso-hide\s*:\s*all/i.test(el.getAttribute('style') ?? '');
}

/** Whether a text node or a picture sits in an element with visibility: hidden that nothing nearer shows again. */
function isUnseen(node: Node): boolean {
	for (let el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement; el; el = el.parentElement) {
		const visibility = el.style?.visibility;
		if (visibility === 'visible') return false;
		if (visibility === 'hidden') return true;
	}
	return false;
}

/** The text of an element that the screen shows: without what is hidden in it. */
function shownText(el: Element): string {
	let text = '';
	for (const child of Array.from(el.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			if (!isUnseen(child)) text += child.textContent || '';
		} else if (child.nodeType === Node.ELEMENT_NODE && !isHidden(child as Element)) {
			text += shownText(child as Element);
		}
	}
	return text;
}

/** Whether an element, or anything around it up to `root`, is not shown: a cell in a hidden row. */
function hiddenWithin(el: Element, root: Element): boolean {
	for (let at: Element | null = el; at && at !== root; at = at.parentElement) {
		if (isHidden(at)) return true;
	}
	return false;
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

	// No wider or taller than the largest page (MAX_TWIPS), keeping its shape: a width of
	// 99999999999 in pasted markup was written as a \picwgoal no reader can use.
	const most = MAX_TWIPS / TWIPS_PER_PX;
	const over = Math.max(w, h) / most;
	if (over > 1) return { w: Math.max(1, Math.round(w / over)), h: Math.max(1, Math.round(h / over)) };
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
	// (A data URL may carry parameters before ";base64": "data:image/png;name=scan.png;base64,".)
	const m = src.match(/^data:image\/[a-z0-9.+-]+(?:;[^;,]*)*;base64,([\s\S]+)$/i);
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
	// Its description, or else its address. Never picture data: a picture that cannot be
	// embedded and has no description was written as its whole data URL, hundreds of
	// kilobytes of base64 in the text of the report.
	const src = el.getAttribute('src') || '';
	const label = el.getAttribute('alt') || (/^\s*data:/i.test(src) ? '' : src) || 'image';
	return `\\i [Image: ${escapeRtf(label)}]\\i0 `;
}

/** \ql / \qc / \qr / \qj for a block's own text-align, or null when it sets none. */
function ownAlign(el: HTMLElement): string | null {
	// Firefox's Center writes <p align="center">, not a style.
	const align = (el.style?.textAlign || el.getAttribute?.('align') || (el.tagName === 'CENTER' ? 'center' : '')).toLowerCase();
	if (align === 'center') return '\\qc';
	if (align === 'right' || align === 'end') return '\\qr';
	if (align === 'justify') return '\\qj';
	if (align === 'left' || align === 'start') return '\\ql';
	return null;
}

/** \ql / \qc / \qr / \qj for a block's text-align; left when it sets none. */
function alignControl(el: HTMLElement): string {
	return ownAlign(el) ?? '\\ql';
}

/** Decoded byte length of a base64 payload, without decoding it. */
function base64ByteLength(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Bytes of RTF header, font table and colour table that precede the body, without
 * the name of the document font, which is counted by its own length.
 */
const RTF_PREAMBLE_BYTES = 160;

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
	h1: 29,
	h2: 29,
	h3: 29,
	h4: 29,
	h5: 29,
	h6: 29,
	li: 35,
	blockquote: 22,
	pre: 27,
	figure: 15,
	figcaption: 29,
	caption: 20, // "\pard\intbl\qc " + "\par "
	table: 8, // "\lastrow"
	tr: 45,
	td: 51, // "{\pard\intbl \f0 \sa0 \li0 \fi0 " + "\cell}" + "\cellxNNNN", and 3 to spare
	th: 65, // a header cell also carries \clbrdrb\brdrs
	// Inline formatting: the control words on either side of the text.
	b: 7, // "\b " + "\b0 "
	strong: 7,
	i: 7,
	em: 7,
	cite: 7,
	var: 7,
	dfn: 7,
	u: 12, // "\ul " + "\ulnone "
	ins: 12,
	s: 17, // "\strike " + "\strike0 "
	strike: 17,
	del: 17,
	sup: 19, // "\super " + "\nosupersub "
	sub: 17,
	code: 8, // "\f1 " + "\f0 "
	br: 6, // "\line "
	hr: 154, // "\pard\qc " + 20 x "\emdash" + "\par "
	ul: 0,
	ol: 0
};

/**
 * Blocks that are written as a <div> is: a paragraph when they hold text, a container when they
 * hold blocks. Pasted pages are made of them, and each one not known as a block had its lines
 * joined to its neighbours': a definition list read "SpecimenColonMarginsNegative".
 */
const DIV_LIKE_TAGS = new Set([
	'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'address', 'details', 'summary',
	'center', 'fieldset', 'legend', 'form', 'dl', 'dt', 'dd', 'hgroup'
]);

/** An element's tag in lower case, with every block written as a <div> named "div". */
function tagOf(el: Element): string {
	const tag = el.tagName.toLowerCase();
	return DIV_LIKE_TAGS.has(tag) ? 'div' : tag;
}

/** Elements that write a paragraph of their own, which inside a table cell carries \intbl. */
const CELL_PARAGRAPH_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'hr', 'figure', 'figcaption']);

/** The field wrapper around a link, apart from its address. */
const LINK_OVERHEAD_BYTES = '{\\field{\\*\\fldinst HYPERLINK ""}{\\fldrslt\\ul\\cf1 \\cf0\\ulnone }}'.length;

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
 *
 * Give it the options htmlToRtf is called with: a longer font name is part of the size, and so
 * are the extra digits of a large body size.
 */
export function estimateRtfBytes(editorEl: HTMLElement, options: RtfWriteOptions = {}): number {
	// The font table names the font ("\froman" is as long as "\fswiss", "\fmodern" one longer).
	const font = cleanFontName(options.fontFamily);
	const fontName = escapeRtf(font);
	const fontClass = fontFamilyClass(font) === 'modern' ? 1 : 0;
	// \fsN is counted with two digits everywhere; the largest size written is a first-level
	// heading's, twice the body.
	const sizeDigits = Math.max(0, String(bodyHalfPoints(options.fontSize) * 2).length - 2);
	let total = RTF_PREAMBLE_BYTES + fontName.length + fontClass + sizeDigits;

	for (const img of Array.from(editorEl.querySelectorAll('img'))) {
		const src = img.getAttribute('src') || '';
		const comma = src.indexOf(',');
		// A picture straight in the editor is a paragraph of its own ("\pard " and "\par ").
		if (img.parentNode === editorEl) total += 11;
		// A picture that cannot be embedded costs its placeholder text.
		// (As imageBody writes it: its description, or its address unless that is picture data.
		// Escaping the whole data URL of every picture without a description, on each keystroke,
		// was half of what a keystroke cost in a document with pictures.)
		const isData = /^\s*data:/i.test(src);
		const placeholder = `\\i [Image: ]\\i0 `.length + escapeRtf(img.getAttribute('alt') || (isData ? '' : src) || 'image').length;
		if (!src.startsWith('data:image/') || comma < 0) {
			total += placeholder;
			continue;
		}
		// Picture data that is neither PNG nor JPEG is written as the placeholder too.
		total += Math.max(placeholder, base64ByteLength(src.slice(comma + 1)) * 2 + PICTURE_OVERHEAD_BYTES);
	}

	// A document with a link carries the link color in its color table ("\red0\green0\blue255;").
	if (hasLink(editorEl)) total += 22;
	const blockSelector = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'figure', 'figcaption', ...DIV_LIKE_TAGS].join(', ');

	// Text at its escaped length: a character outside ASCII costs its \uN\'3f escape,
	// six to nine bytes rather than one.
	// (Each line break is counted, not each run of them: text is written node by node, and a
	// run that crosses from one node into the next is a space in each.)
	total += escapeRtf((editorEl.textContent || '').replace(/[\r\n]/g, ' ')).length;
	// A tab that shows is written as "\tab " (5) and counted as 1; counting every tab that way
	// can only overestimate.
	total += ((editorEl.textContent || '').match(/\t/g)?.length ?? 0) * 4;
	// A block's alignment (\qc, 3) and left indent (\liN, up to 7) are written per paragraph,
	// for every block inside an indented one too: count 12 for each block that could carry them.
	// A paragraph's own right indent (\\riN) and first-line indent (\\fi-N) are up to 8 more each.
	for (const block of Array.from(editorEl.querySelectorAll<HTMLElement>(blockSelector))) {
		if (block.closest('center, [style*="margin"], [style*="text-align"], [align]')) total += 12;
		// A quotation and a list indent what is in them with no style of their own. An item is
		// counted with a three-digit indent (\li720); a level further in has four or five.
		else if (block.tagName === 'LI') {
			if (block.parentElement?.closest('li, blockquote, ul ul, ul ol, ol ul, ol ol')) total += 2;
		} else if (block.parentElement?.closest('blockquote')) total += 6; // "\li720"
		if (block.style?.marginRight) total += 8;
		if (block.style?.textIndent) total += 8;
	}
	// Each paragraph's formatting, worked out once: a blank line looks at the one before it.
	const formatCache = new Map<Element, string>();
	const ownFormat = (el: HTMLElement): string => {
		let format = formatCache.get(el);
		if (format === undefined) {
			format = `${alignOf(el)}${paragraphControls(el, leftMarginTwips(el))}`;
			formatCache.set(el, format);
		}
		return format;
	};
	for (const el of Array.from(editorEl.querySelectorAll<HTMLElement>('*'))) {
		const tag = tagOf(el);
		// A <div> that only holds blocks writes nothing of its own: its blocks are counted.
		const container = tag === 'div' && Array.from(el.children).some(isBlock) && !startsWithInline(el) && !endsWithInline(el);
		if (!container) total += BLOCK_OVERHEAD_BYTES[tag] ?? 0;
		// A heading and a code block each write their size and the size around them.
		if (HEADING_TAGS.has(tag) || tag === 'pre') total += 2 * sizeDigits;
		// Bold, italic, a line under or through, and raised or lowered text set by a style cost
		// what the tags for them do; counting each that is named can only overestimate.
		const style = el.style;
		if (style) {
			if (style.fontWeight) total += 7;
			if (style.fontStyle) total += 7;
			if (style.textDecoration || style.textDecorationLine) total += 12 + 17;
			if (style.verticalAlign) total += 19;
			// Each line break kept by white-space is "\line " (6), as in a code block.
			if (tag !== 'pre' && /^(pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace)) {
				total += ((el.textContent || '').match(/\r\n|\r|\n/g)?.length ?? 0) * 6;
			}
		}
		if (tag === 'a') {
			const target = linkTarget(el.getAttribute('href') || '');
			if (target) total += LINK_OVERHEAD_BYTES + escapeRtf(target).length;
		}
		// Each line break in a code block is written as "\line " (6). It is counted as 1 with
		// the text, or as nothing where it follows another: a run of them is counted there as
		// one space.
		if (tag === 'pre') total += ((el.textContent || '').match(/\r\n|\r|\n/g)?.length ?? 0) * 6;
		// A paragraph that follows loose text first ends that text's line ("\par ").
		if ((tag === 'p' || tag === 'div' || BREAKS_LOOSE_TEXT.has(tag)) && followsInlineContent(el, editorEl)) total += 5;
		// A heading, code block or quotation inside a list item, quotation or paragraph restates the
		// paragraph around it (\pard, the indent, \par) in ways the counts above do not follow
		// exactly: up to 10 more each, so the estimate stays above the real size.
		if (/^(h[1-6]|pre|blockquote)$/.test(tag) && el.parentElement !== editorEl && el.parentElement?.closest('li, blockquote, p')) total += 10;
		// In a list item, text after a wrapper that ends with a block starts a paragraph again
		// ("\pard\intbl\liN\fi-N ", at most 24).
		if (!isBlock(el) && el.closest('li') && endsWithBlock(el)) total += 24;
		// A paragraph a block writes inside a table cell also carries \intbl (6). A list
		// writes one paragraph per item, so the item is counted, not the list.
		if (CELL_PARAGRAPH_TAGS.has(tag) && el.closest('td, th')) total += 6;
		// A paragraph's own formatting costs its controls, and a blank line after one restates
		// \pard (5); counting both on every such paragraph can only overestimate. The indent of
		// the blocks around it is counted above.
		if ((tag === 'p' || tag === 'div') && !el.closest('td, th')) {
			const para = ownFormat(el);
			const prev = el.previousElementSibling;
			if (para || (prev && formatCache.get(prev))) total += para.length + 6;
		}
		// A cell's own alignment is written on its paragraph (\qc, 3). A cell down several rows
		// is written once in each of them, marked \clvmgf or \clvmrg (7). A table inside a cell
		// is written as text, which costs less than the cells counted for it.
		if (tag === 'td' || tag === 'th') {
			// (Its own, or the one a block around the table hands down.)
			if (el.closest('center, [style*="text-align"], [align]')) total += 3;
			const rows = parseInt(el.getAttribute('rowspan') ?? '', 10);
			if (rows !== 1 && Number.isFinite(rows) && !el.parentElement?.closest('td, th')) {
				// rowspan="0" reaches the last row; no span reaches past the table.
				const rowCount = el.closest('table')?.querySelectorAll('tr').length ?? 1;
				const spanned = Math.min(rowCount, rows > 0 ? rows : rowCount);
				total += 7 + (spanned - 1) * ((BLOCK_OVERHEAD_BYTES[tag] ?? 0) + 7);
			}
		}
		// A row with fewer cells than the table has columns is filled with empty ones.
		if (tag === 'table' && !el.parentElement?.closest('td, th')) {
			const model = tableModel(el);
			for (const row of model.rows) total += row.filter((slot) => slot === null).length * BLOCK_OVERHEAD_BYTES.td;
		}
		// Anything in a table that is in no cell is written before it, each run a paragraph
		// ("\pard\intbl\qc\liN " and "\par ", at most 27).
		if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'tr') {
			for (const child of Array.from(el.childNodes)) {
				const name = child.nodeName.toLowerCase();
				if (/^(caption|colgroup|col|thead|tbody|tfoot|tr|td|th|#comment)$/.test(name)) continue;
				if (child.nodeType === Node.TEXT_NODE && COLLAPSIBLE_WHITESPACE.test(child.textContent || '')) continue;
				total += 27;
			}
		}
		// Text or an inline element after a block starts a paragraph of its own where that
		// block set an indent or alignment ("\pard\intbl\qc\li1440 ", and its "\par ").
		if (isBlock(el) && followedByInline(el)) total += 27;
		// So does text written straight into a list, between its items.
		if (tag === 'ul' || tag === 'ol') {
			for (const child of Array.from(el.childNodes)) {
				if (child.nodeType === Node.TEXT_NODE ? !COLLAPSIBLE_WHITESPACE.test(child.textContent || '') : !isBlock(child)) total += 27;
			}
		}
		// A paragraph inside a list item is written at the item's indent (\liN, up to 7).
		if ((tag === 'p' || tag === 'div') && el.parentElement?.tagName === 'LI') total += 8;
		// A numbered item's number is counted as one digit; a list that starts high has more.
		if (tag === 'ol') {
			const last = (parseInt(el.getAttribute('start') ?? '', 10) || 1) + el.children.length;
			total += el.children.length * Math.max(0, String(last).length - 1);
		}
		// A figure with no picture is a paragraph of what it holds: "\pard\intbl\qc\liN " and
		// "\par " (at most 30).
		if (tag === 'figure' && !el.querySelector('img')) total += 30;
		// A color costs "\cfN " on and off (up to "\cf123 " each, in a document of many colors)
		// and, the first time, its color-table entry (at most 25 bytes,
		// "\red255\green255\blue255;"); a size costs "\fsNN " on and off.
		if (el.style?.color) total += 14 + 25;
		// (A <font> with a color attribute and a color style names two colors, and both are in the table.)
		if (tag === 'font' && el.hasAttribute('color')) total += el.style?.color ? 25 : 14 + 25;
		// "\fsNNN " on and off, for sizes up to 499 pt
		if (el.style?.fontSize || (tag === 'font' && el.hasAttribute('size'))) total += 14 + sizeDigits;
	}

	return total;
}

// ── Link helpers ──

/**
 * The address a link should carry in the RTF, or null if it should not be a link.
 *
 * Only an absolute web, mail or phone address qualifies. A relative path, a UNC path
 * (\\server\share) or a javascript:, data:, file: or vbscript: address is refused: the
 * receiving system opens a link in its own context, where a relative or UNC path names
 * a file on the reader's network. The address returned is the parsed one, which
 * percent-encodes characters such as a quote that would otherwise end the field's
 * address and add switches of its own.
 */
export function linkTarget(url: string): string | null {
	const value = url.trim();
	if (!/^(https?:\/\/|mailto:|tel:)/i.test(value) || value.includes('\\')) return null;
	try {
		const parsed = new URL(value);
		if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return null;
		return parsed.href.replace(/"/g, '%22');
	} catch {
		return null;
	}
}

/** Whether any link in the element is one the writer writes as a link. */
function hasLink(el: HTMLElement): boolean {
	return Array.from(el.querySelectorAll('a[href]')).some((a) => linkTarget(a.getAttribute('href') || '') !== null);
}

/** Whether a link address is an absolute web, mail or phone address (see linkTarget). */
export function isSafeLinkUrl(url: string): boolean {
	return linkTarget(url) !== null;
}

// ── Font helpers ──

/**
 * A single font name, safe for the font table. A CSS list such as
 * 'Arial, sans-serif' keeps only its first family, since RTF names one font.
 * Anything that would break the table is removed: a name is terminated by ';'
 * and cannot contain group delimiters or control words.
 */
function cleanFontName(name: string | undefined): string {
	const first = (name ?? '').replace(/["']/g, '').split(',')[0];
	const cleaned = first.replace(/[\\{};]/g, '').trim();
	return cleaned || DEFAULT_FONT_FAMILY;
}

/**
 * Whether a font name is a monospace font's: Courier New, Consolas, Menlo, a "… Mono" family
 * (Roboto Mono, DejaVu Sans Mono), and their PostScript names (CourierNewPSMT, SFMono-Regular).
 * Monotype Corsiva is not one, and neither is American Typewriter, which is proportional.
 */
export function isMonospaceFontName(name: string): boolean {
	return /courier|mono(?!type|ton|fett)|consolas|menlo|monaco|lucida ?console|lucida ?sans ?typewriter|ocr[ -]?[ab]\b|source ?code|fira ?code|cascadia|jetbrains/.test(
		name.toLowerCase()
	);
}

/** RTF font family class for a font name: \froman, \fmodern or \fswiss. */
function fontFamilyClass(name: string): 'roman' | 'modern' | 'swiss' {
	const n = name.toLowerCase();
	if (isMonospaceFontName(n)) return 'modern';
	if (
		/times|georgia|garamond|cambria|palatino|antiqua|schoolbook|baskerville|didot|bodoni|serif/.test(n) &&
		!/sans/.test(n)
	) {
		return 'roman';
	}
	return 'swiss';
}

/**
 * CSS font-family value for a font name, with the generic fallback that
 * matches it, e.g. "Arial", sans-serif.
 */
export function cssFontFamily(name: string | undefined): string {
	const font = cleanFontName(name);
	const generic = { roman: 'serif', modern: 'monospace', swiss: 'sans-serif' }[fontFamilyClass(font)];
	return `"${font}", ${generic}`;
}

/**
 * A body size in points, as the RTF will carry it: rounded to the half-point
 * RTF measures in, kept within what readers accept, and the default for
 * missing or nonsense input. The editor and viewer show this same size, so
 * the screen and the RTF agree.
 */
export function normalizeFontSize(fontSize: number | undefined): number {
	if (typeof fontSize !== 'number' || !Number.isFinite(fontSize) || fontSize <= 0) {
		return DEFAULT_FONT_SIZE;
	}
	return Math.min(MAX_FONT_SIZE, Math.max(1, Math.round(fontSize * 2) / 2));
}

/** Body size in RTF half-points. */
function bodyHalfPoints(fontSize: number | undefined): number {
	return normalizeFontSize(fontSize) * 2;
}

// ── DOM walker / RTF generator ──

export function htmlToRtf(editorEl: HTMLElement, options: RtfWriteOptions = {}): string {
	const fontName = cleanFontName(options.fontFamily);
	const bodySize = bodyHalfPoints(options.fontSize);

	const colorMap = new Map<string, RGB>();
	// A link's text is \cf1. In a document with a link that entry is the link color, so a
	// link can be told from underlined text; in any other it is black, as it always was.
	if (hasLink(editorEl)) colorMap.set(colorKey(LINK_COLOR), { ...LINK_COLOR });
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

	// \f0 is the document font, used for everything except code; \f1 is the
	// monospace font for code.
	const fontTable =
		'{\\fonttbl' +
		`{\\f0\\f${fontFamilyClass(fontName)}\\fcharset0 ${escapeRtf(fontName)};}` +
		'{\\f1\\fmodern\\fcharset0 Courier New;}' +
		'}';

	const body = walkChildren(editorEl, {
		colorIndex,
		bodySize,
		inPre: false,
		listCounter: 0,
		inTableCell: false,
		root: editorEl,
		shownBefore: new Map(),
		bold: false,
		italic: false,
		underline: false,
		strike: false,
		size: bodySize,
		color: 0,
		script: null,
		mono: false,
		indent: 0,
		cellAlign: ''
	});

	const rtf =
		'{\\rtf1\\ansi\\ansicpg1252\\deff0' +
		fontTable +
		colorTable +
		'\\viewkind4\\uc1' +
		`\\pard\\f0\\fs${bodySize} ` +
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

function collectColors(root: HTMLElement, colorMap: Map<string, RGB>): void {
	// (In document order, as the color table has always been written, and without a call per
	// level of nesting.)
	for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
		addColor(el.style?.color, colorMap);
		// <font color="..."> is produced by execCommand('foreColor')
		if (el.tagName?.toLowerCase() === 'font') addColor(el.getAttribute('color'), colorMap);
	}
}

/** How many elements deep the walker is (see MAX_ELEMENT_DEPTH). */
let walkDepth = 0;

/** The text an element shows, read without a call per level of nesting. */
function flatText(root: Element): string {
	let text = '';
	const pending: Node[] = [root];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent || '';
		} else if (node.nodeType === Node.ELEMENT_NODE && !isHidden(node as Element)) {
			for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
		}
	}
	return text;
}

function walkChildren(parent: Node, ctx: WalkContext): string {
	let rtf = '';
	const children = parent.childNodes;
	for (let i = 0; i < children.length; i++) rtf += walkNode(children[i], ctx);
	return rtf;
}

/**
 * One node as RTF. `restate` is off where the caller has already started the paragraph the node
 * goes in (a list item's lines). `endLooseText` is off where the caller has already ended the
 * line before a block (flowRtf).
 */
function walkNode(node: Node, ctx: WalkContext, restate = true, endLooseText = true): string {
	if (node.nodeType === Node.ELEMENT_NODE && walkDepth >= MAX_ELEMENT_DEPTH) {
		return isHidden(node as Element) ? '' : escapeRtf(flatText(node as Element));
	}
	walkDepth++;
	try {
		return walkNodeAt(node, ctx, restate, endLooseText);
	} finally {
		walkDepth--;
	}
}

function walkNodeAt(node: Node, ctx: WalkContext, restate: boolean, endLooseText: boolean): string {
	let rtf = '';

	if (node.nodeType === Node.TEXT_NODE) {
		if (isUnseen(node)) return '';
		const text = node.textContent || '';
		// Whitespace between two blocks (the newline in "</p>\n<p>") shows as
		// nothing in a browser. Written out, it became a space at the start of
		// the next paragraph.
		const tabsShow = ctx.inPre || showsTabs(node);
		if (!tabsShow && COLLAPSIBLE_WHITESPACE.test(text) && besideBlock(node)) return '';
		if (!ctx.inPre && restate) rtf += restateAfterBlock(node, ctx);
		if (ctx.inPre || showsLineBreaks(node)) {
			// Split before escaping — escapeRtf collapses newlines, so the
			// line structure a <pre> block depends on has to become \line
			// first. Handles CR, LF and CRLF alike. Text whose own white-space
			// keeps its line breaks (pre-wrap) is the same.
			rtf += text.split(/\r\n|\r|\n/).map((line) => escapeTabs(line, tabsShow)).join('\\line ');
		} else {
			rtf += escapeTabs(text, tabsShow);
		}
		return rtf;
	}

	if (node.nodeType !== Node.ELEMENT_NODE) return '';

	const el = node as HTMLElement;
	if (isHidden(el)) return '';
	const tag = tagOf(el);
	// Text typed straight into the parent before a block ("Diagnosis:<ul>…", the shape Chrome
	// makes when the line after it becomes a list) has no paragraph of its own: it is ended here,
	// or \pard would carry it into the block's first line. A <p> or <div>, and a table inside a
	// cell, end it themselves.
	if (endLooseText && BREAKS_LOOSE_TEXT.has(tag) && !(tag === 'table' && ctx.inTableCell) && followsInlineContent(el, ctx.root)) {
		rtf += '\\par ';
	}
	// A picture directly under the root writes its own paragraph.
	if (restate && !isBlock(el) && !(tag === 'img' && el.parentNode === ctx.root)) rtf += restateAfterBlock(el, ctx);

	switch (tag) {
		// Heading sizes keep their ratio to the body (HEADING_SCALE). <h4> to <h6> come in with
		// pasted text; each is a paragraph of its own, as large as a browser shows it.
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6': {
			const size = scaled(ctx, ALL_HEADING_SCALES[tag]);
			// The heading's own color and the like, on top of its size and bold.
			const own = charFormat(el, tag, { ...ctx, bold: true, size }, true);
			// A heading that holds a block (a list made in it with the browser's list command)
			// is not a paragraph itself; what is inside is written at the heading's size, bold.
			if (Array.from(el.children).some(isBlock)) {
				rtf += `\\fs${size}${ctx.bold ? '' : '\\b'} ${own.on}${walkChildren(el, own.ctx)}${own.off}${ctx.bold ? '' : '\\b0'}\\fs${ctx.size} `;
				break;
			}
			rtf += `\\pard${inCell(ctx)}${headingLayout(el, ctx)}\\f0\\fs${size}\\b ${own.on}${walkChildren(el, own.ctx)}${own.off}${ctx.bold ? '' : '\\b0'}\\fs${ctx.size}\\par `;
			break;
		}

		case 'p':
		case 'div': {
			// Inside a table cell the cell has already declared \pard\intbl. Each paragraph
			// ends with \par, so two paragraphs in one cell stay two (the cell drops the last
			// one's); one that follows a list or heading in the cell restates \pard\intbl,
			// so it does not inherit that block's indent.
			// Text typed straight into the parent before this block ("abc<div>def</div>",
			// the shape Chrome makes on Enter) has no paragraph of its own: end it here, or
			// the two lines run together.
			const afterLooseText = followsInlineContent(el, ctx.root);
			// A <div> that holds blocks (pasted content wraps paragraphs in one) is not a
			// paragraph itself: each block inside writes its own \\pard, which would drop the
			// div's indent, and the div's own \\par would add a blank line. Its left margin is
			// carried into the blocks instead, and loose text in it gets a paragraph. A <p> that
			// holds a block is the same: no parser makes one, but a browser's own list command
			// does, leaving the list inside the paragraph it was made from (<p><ul>…</ul></p>).
			// The block's own color, and bold and the like where its style sets them.
			const own = charFormat(el, tag, ctx, true);
			if (Array.from(el.children).some(isBlock)) {
				const indent = ctx.indent + leftMarginTwips(el);
				// Its alignment is that of the blocks inside it that set none: text-align is
				// inherited, and pasted pages center a run of paragraphs with one <div>.
				const inner = { ...own.ctx, indent, cellAlign: inheritedAlign(el, ctx) };
				const lead = startsWithInline(el) ? `\\pard${inCell(ctx)}${cellAlign(inner)}${liControl(indent)} ` : '';
				const tail = endsWithInline(el) ? '\\par ' : '';
				rtf += `${afterLooseText ? '\\par ' : ''}${lead}${own.on}${walkChildren(el, inner)}${own.off}${tail}`;
				break;
			}
			if (ctx.inTableCell) {
				// Alignment or an indent needs a paragraph of its own, even as the cell's first.
				const layout = paragraphLayout(el, ctx);
				const restate = afterLooseText
					? `\\par \\pard\\intbl${layout} `
					: el.previousElementSibling || layout ? `\\pard\\intbl${layout} ` : '';
				if (isBlankLine(el)) {
					rtf += `${restate}\\par `;
					break;
				}
				rtf += `${restate}${own.on}${walkChildren(el, own.ctx)}${own.off}\\par `;
				break;
			}
			// The paragraph's alignment, indents, spacing, keep-with-next and tab stops, if it
			// sets any.
			const para = paragraphFormat(el, ctx);
			// A <p> with no children or only a single <br> is a blank line —
			// emit a bare \par rather than \pard \line\par, which adds an extra line.
			// A bare \par keeps the formatting of the paragraph before it, so a blank line after a
			// formatted paragraph, or with formatting of its own, restates \pard.
			if (isBlankLine(el)) {
				const reset = para || followsFormattedParagraph(el, ctx) ? `\\pard${para} ` : '';
				rtf += `${afterLooseText ? '\\par ' : ''}${reset}\\par `;
				break;
			}
			rtf += `${afterLooseText ? '\\par ' : ''}\\pard${para} ${own.on}${walkChildren(el, own.ctx)}${own.off}\\par `;
			break;
		}

		case 'table':
			rtf += ctx.inTableCell ? nestedTableRtf(el, ctx) : tableRtf(el, ctx);
			break;

		case 'blockquote': {
			// The browser's Indent wraps the lines in a blockquote with a left margin and
			// border: none (Chromium, WebKit, Gmail): that is an indent, not a quotation, so it
			// is not italic. A quotation is indented half an inch, plus any margin of its own.
			// Either way the blocks inside carry the indent, and loose text gets a paragraph.
			const quote = !isIndentBlockquote(el);
			const indent = ctx.indent + leftMarginTwips(el) + (quote ? 720 : 0);
			const inner = { ...ctx, indent, italic: ctx.italic || quote };
			const lead = startsWithInline(el) ? `\\pard${inCell(ctx)}${cellAlign(ctx)}${liControl(indent)}` : '';
			const tail = endsWithInline(el) ? '\\par ' : '';
			const content = walkChildren(el, inner);
			const italicOn = quote && !ctx.italic;
			const italicOff = italicOn ? (tail ? '\\i0' : '\\i0 ') : '';
			rtf += `${lead}${italicOn ? '\\i ' : lead ? ' ' : ''}${content}${italicOff}${tail}`;
			break;
		}

		case 'pre': {
			const size = scaled(ctx, PRE_SCALE);
			rtf += `\\pard${inCell(ctx)}${cellAlign(ctx)}${liControl(ctx.indent + leftMarginTwips(el))}\\f1\\fs${size} ${walkChildren(el, { ...ctx, inPre: true, size })}\\f0\\fs${ctx.size}\\par `;
			break;
		}

		case 'hr':
			// A page break read from RTF is shown as a rule that says so, and goes back as \page.
			if (!ctx.inTableCell && isPageBreak(el)) {
				rtf += '\\page ';
				break;
			}
			rtf += `\\pard${inCell(ctx)}\\qc \\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\par `;
			break;

		case 'ul':
		case 'ol':
			rtf += listRtf(el, ctx);
			break;

		case 'li': {
			// An item with no list around it (a pasted fragment) shows with a bullet.
			const left = ctx.indent + LIST_STEP;
			const start = `\\pard${inCell(ctx)}${listAlign(ctx)}${liControl(left)}`;
			const own = charFormat(el, tag, ctx, true);
			rtf += `${own.on}${flowRtf(Array.from(el.childNodes), { ...own.ctx, indent: left }, `${start}\\fi-${LIST_HANG}\\bullet\\tab `, `${start} `)}${own.off}`;
			break;
		}

		case 'code': {
			const own = charFormat(el, tag, ctx);
			if (!ctx.inPre && !ctx.mono) {
				rtf += `${own.on}\\f1 ${walkChildren(el, { ...own.ctx, mono: true })}\\f0 ${own.off}`;
			} else {
				rtf += `${own.on}${walkChildren(el, own.ctx)}${own.off}`;
			}
			break;
		}

		case 'a': {
			const own = charFormat(el, tag, ctx);
			// A link is written only for an absolute web, mail or phone address; anything
			// else (a relative or UNC path, javascript:, data:, file:) as its text alone.
			const target = linkTarget(el.getAttribute('href') || '');
			if (target) {
				const inner = walkChildren(el, { ...own.ctx, underline: true, color: 1 });
				const underlineOff = own.ctx.underline ? '' : '\\ulnone';
				rtf += `${own.on}{\\field{\\*\\fldinst HYPERLINK "${escapeRtf(target)}"}{\\fldrslt\\ul\\cf1 ${inner}\\cf${own.ctx.color}${underlineOff} }}${own.off}`;
			} else {
				rtf += `${own.on}${walkChildren(el, own.ctx)}${own.off}`;
			}
			break;
		}

		// <figure><img><figcaption>caption</figcaption></figure> — the shape the
		// editor inserts. The caption is written as its own paragraph below the
		// picture, tagged with an ignorable {\*\inkcap} destination so it can be
		// re-attached to the figure on import. Other RTF readers skip the tag and
		// simply show an italic line under the image.
		case 'figure': {
			// The editor's figure is one picture and its caption. A figure with more in it (a
			// second picture, text typed beside the picture) is written as the block of what it
			// holds, like one with no picture: everything in it is kept, where only its first
			// picture was.
			// (What is hidden in a figure is no part of it: a picture, a caption, a note in one.)
			const within = <T extends Element>(found: T[]) => found.filter((f) => !hiddenWithin(f, el) && !isUnseen(f));
			const pictures = within(Array.from(el.querySelectorAll('img')));
			const anyCaption = within(Array.from(el.querySelectorAll('figcaption')))[0] ?? null;
			const img = pictures.length === 1 && !hasTextOutside(el, anyCaption) ? pictures[0] : null;
			// A figure with a picture takes the caption the editor gives it, wherever it sits. One
			// with no picture takes only its own (a child): a caption further in belongs to what
			// holds it (a figure inside this one), and is written there.
			const captionEl = img ? anyCaption : Array.from(el.children).find((c) => c.tagName === 'FIGCAPTION' && !isHidden(c));
			const caption = (captionEl ? shownText(captionEl) : '').trim();
			const align = `${ownAlign(el) ?? (cellAlign(ctx) || '\\ql')}${liControl(ctx.indent + leftMarginTwips(el))}`;

			if (img) {
				rtf += `\\pard${inCell(ctx)}${align} ${imageBody(img as HTMLElement)}\\par `;
			} else {
				// A figure with no picture is a block of what it holds: its lines end with \par, as a
				// <div>'s do, or its text ran into the next paragraph. Its caption is written below.
				const held = Array.from(el.childNodes).filter((n) => n !== captionEl);
				rtf += flowRtf(held, ctx, null, `\\pard${inCell(ctx)}${align} `);
			}

			if (caption) {
				rtf += `{\\*\\inkcap}\\pard${inCell(ctx)}${align}\\i ${escapeRtf(caption)}${ctx.italic ? '' : '\\i0'}\\par `;
			}
			break;
		}

		case 'img': {
			// A picture directly under the editor root has no paragraph of its
			// own; anywhere else it is inline content of the enclosing block.
			if (isUnseen(el)) break;
			const standalone = el.parentNode === ctx.root;
			rtf += standalone ? `\\pard ${imageBody(el)}\\par ` : imageBody(el);
			break;
		}

		case 'br':
			// The <br> a browser leaves at the end of a paragraph shows as nothing; written
			// as \line it added an empty line.
			if (ctx.inPre || !isTrailingBreak(el, ctx)) rtf += '\\line ';
			break;

		// Every other element is inline: <b>, <em>, <sup>, <span>, <font color> (which
		// execCommand('foreColor') makes) and whatever a paste brings. What it does to its text
		// is its tag's meaning and its own style (charFormat).
		default: {
			const own = charFormat(el, tag, ctx);
			rtf += `${own.on}${walkChildren(el, own.ctx)}${own.off}`;
			break;
		}
	}

	return rtf;
}

// ── Character formatting ──

/** What a tag by itself does to its text. */
const TAG_FORMAT: Record<string, { bold?: true; italic?: true; underline?: true; strike?: true; script?: 'super' | 'sub' }> = {
	b: { bold: true },
	strong: { bold: true },
	i: { italic: true },
	em: { italic: true },
	cite: { italic: true },
	var: { italic: true },
	dfn: { italic: true },
	u: { underline: true },
	ins: { underline: true },
	s: { strike: true },
	strike: { strike: true },
	del: { strike: true },
	sup: { script: 'super' },
	sub: { script: 'sub' }
};

/** Whether a font-weight is bold; null when it does not say. */
function cssBold(weight: string | undefined): boolean | null {
	if (!weight) return null;
	if (weight === 'bold' || weight === 'bolder') return true;
	if (weight === 'normal' || weight === 'lighter') return false;
	const n = Number(weight);
	return Number.isFinite(n) ? n >= 600 : null;
}

/**
 * The character formatting an element gives its text, as the control words that turn it on and
 * the ones that put back what was in force before, and the context its children are written in.
 *
 * It is what the tag means (<b>, <sup>), unless the element's own style says otherwise. Google
 * Docs wraps everything it pastes in <b style="font-weight:normal">, which is not bold, and writes
 * bold, italic, underline, strikethrough, superscript and subscript as styles on a <span>, which
 * are. Only what differs from the text around it is written: <b> inside <b> writes nothing.
 *
 * A block (`block`) takes its color and these toggles; a size is read from inline elements only.
 */
function charFormat(el: HTMLElement, rawTag: string, ctx: WalkContext, block = false): { on: string; off: string; ctx: WalkContext } {
	const style = el.style;
	const tagFormat = TAG_FORMAT[rawTag] ?? {};

	const weight = cssBold(style?.fontWeight);
	const bold = weight ?? (tagFormat.bold || ctx.bold);

	const fontStyle = style?.fontStyle ?? '';
	const italic = fontStyle === 'normal' ? false : fontStyle === 'italic' || fontStyle.startsWith('oblique') || tagFormat.italic || ctx.italic;

	// A line under or through text cannot be taken off by an element inside it (CSS draws it
	// across everything within), so "none" only stops the element's own tag: <u> or <s>.
	const decoration = `${style?.textDecorationLine ?? ''} ${style?.textDecoration ?? ''}`;
	const noLine = /\bnone\b/.test(decoration);
	const underline = /\bunderline\b/.test(decoration) || (!noLine && tagFormat.underline) || ctx.underline;
	const strike = /\bline-through\b/.test(decoration) || (!noLine && tagFormat.strike) || ctx.strike;

	const vertical = style?.verticalAlign ?? '';
	const script: WalkContext['script'] =
		vertical === 'super' ? 'super' : vertical === 'sub' ? 'sub' : vertical === 'baseline' ? null : (tagFormat.script ?? ctx.script);

	const color = colorIndexOf(el, ctx);
	const size = block ? null : sizeOf(el);

	let on = '';
	let off = '';
	if (color != null) {
		on += `\\cf${color} `;
		off = `\\cf${ctx.color} `;
	}
	if (size != null) {
		on += `\\fs${size} `;
		off = `\\fs${ctx.size} ${off}`;
	}
	if (bold !== ctx.bold) {
		on += bold ? '\\b ' : '\\b0 ';
		off = `${ctx.bold ? '\\b ' : '\\b0 '}${off}`;
	}
	if (italic !== ctx.italic) {
		on += italic ? '\\i ' : '\\i0 ';
		off = `${ctx.italic ? '\\i ' : '\\i0 '}${off}`;
	}
	if (underline !== ctx.underline) {
		on += '\\ul ';
		off = `\\ulnone ${off}`;
	}
	if (strike !== ctx.strike) {
		on += '\\strike ';
		off = `\\strike0 ${off}`;
	}
	if (script !== ctx.script) {
		on += script ? `\\${script} ` : '\\nosupersub ';
		off = `${ctx.script ? `\\${ctx.script} ` : '\\nosupersub '}${off}`;
	}

	if (!on) return { on, off, ctx };
	return { on, off, ctx: { ...ctx, bold, italic, underline, strike, script, color: color ?? ctx.color, size: size ?? ctx.size } };
}

/** Whether an element is shown and holds text or a picture: an empty <form> or a hidden <input> does not. */
function holdsSomething(el: Element): boolean {
	return !isHidden(el) && (el.tagName === 'IMG' || el.querySelector('img') !== null || hasTextOutside(el, null));
}

/** Whether an element holds text that shows, outside `skip`: any text other than collapsible whitespace. */
function hasTextOutside(el: Node, skip: Node | null): boolean {
	// (With a list of what is still to look at, not a call for each level of nesting.)
	const pending: Node[] = [el];
	while (pending.length > 0) {
		for (const child of Array.from(pending.pop()!.childNodes)) {
			if (child === skip) continue;
			if (child.nodeType === Node.TEXT_NODE) {
				if (!COLLAPSIBLE_WHITESPACE.test(child.textContent || '') && !isUnseen(child)) return true;
			} else if (child.nodeType === Node.ELEMENT_NODE && !isHidden(child as Element)) {
				pending.push(child);
			}
		}
	}
	return false;
}

// ── Lists ──

/** Each level of a list is indented half an inch further (\li720). */
const LIST_STEP = 720;

/** A list item's first line hangs a quarter inch left of its text, where the marker sits (\fi-360). */
const LIST_HANG = 360;

/**
 * A <ul> or <ol>: one hanging paragraph per item, opened by a bullet or the item's number and a
 * tab. A list inside an item, or straight inside the list (<ul><ul>, as some editors nest), is
 * indented one level further. Numbers start at the list's `start`.
 */
function listRtf(list: HTMLElement, ctx: WalkContext): string {
	// A list straight inside a list is written from here, not through walkNode, so the depth is
	// counted here too: six thousand of them, one in the next, ran out of stack.
	if (walkDepth >= MAX_ELEMENT_DEPTH) return isHidden(list) ? '' : escapeRtf(flatText(list));
	walkDepth++;
	try {
		return listRtfAt(list, ctx);
	} finally {
		walkDepth--;
	}
}

function listRtfAt(list: HTMLElement, ctx: WalkContext): string {
	const ordered = tagOf(list) === 'ol';
	// A list read back from RTF carries the indent beyond its level's own as a margin, which
	// is negative for a list nested by less than half an inch.
	const margin = lengthTwips(list.style?.marginLeft, true) ?? 0;
	const left = Math.max(LIST_HANG, ctx.indent + margin + LIST_STEP);
	const start = parseInt(list.getAttribute('start') ?? '', 10);
	let counter = ordered && Number.isFinite(start) ? start : 1;

	const itemCtx = { ...ctx, indent: left, cellAlign: listAlign(ctx) };
	const paragraph = `\\pard${inCell(ctx)}${listAlign(ctx)}${liControl(left)}`;
	let rtf = '';
	/** Text or inline elements written straight into the list, between its items. */
	let loose: Node[] = [];
	const flushLoose = () => {
		if (loose.length > 0) rtf += flowRtf(loose, itemCtx, null, `${paragraph} `);
		loose = [];
	};

	for (const child of Array.from(list.childNodes)) {
		const tag = child.nodeType === Node.ELEMENT_NODE ? tagOf(child as Element) : '';
		if (tag && isHidden(child as Element)) continue;
		if (tag === 'li') {
			flushLoose();
			const marker = ordered ? ` ${counter}.\\tab ` : '\\bullet\\tab ';
			// The item's own color and the like; its marker takes them too, as on screen.
			const own = charFormat(child as HTMLElement, tag, itemCtx, true);
			rtf += `${own.on}${flowRtf(Array.from(child.childNodes), own.ctx, `${paragraph}\\fi-${LIST_HANG}${marker}`, `${paragraph} `)}${own.off}`;
			counter++;
		} else if (tag === 'ul' || tag === 'ol') {
			flushLoose();
			rtf += listRtf(child as HTMLElement, itemCtx);
		} else if (child.nodeType === Node.TEXT_NODE && COLLAPSIBLE_WHITESPACE.test(child.textContent || '')) {
			// The line breaks of the source between items.
		} else {
			loose.push(child);
		}
	}
	flushLoose();
	return rtf;
}

/**
 * The alignment a list's items are written with: the table cell's, inside one. Anywhere else a
 * list is written left-aligned, whatever a <div> around it says, because only a left-aligned
 * list is read back as a list; centered, its items came back as paragraphs with a bullet typed
 * in front.
 */
function listAlign(ctx: WalkContext): string {
	return ctx.inTableCell ? ctx.cellAlign : '';
}

/**
 * The content of a list item, or of any place where text and blocks mix, as paragraphs. Text
 * and inline elements in a row are one paragraph; the first opens with `first` (the item's
 * marker) and any later one with `plain` (the same indent, no marker). A <p> inside the item,
 * which is how Word and Google Docs paste a list, is the item's text, not a block after it. A
 * list or other block inside the item is written as itself, at the item's indent.
 */
function flowRtf(nodes: Node[], ctx: WalkContext, first: string | null, plain: string): string {
	let rtf = '';
	let marker = first;
	let open = false;
	const start = () => {
		if (open) return;
		rtf += marker ?? plain;
		marker = null;
		open = true;
	};
	const end = () => {
		if (open) rtf += '\\par ';
		open = false;
	};

	for (const node of nodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (COLLAPSIBLE_WHITESPACE.test(node.textContent || '') && !showsTabs(node) && besideBlock(node)) continue;
			start();
			rtf += walkNode(node, ctx, false);
			continue;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) continue;
		const el = node as HTMLElement;
		if (isHidden(el)) continue;
		const tag = tagOf(el);

		// A caption outside a figure is text where it stands, as everywhere else.
		if (!endsItsLine(el)) {
			start();
			rtf += walkNode(el, ctx, false);
			// A wrapper that ends with a block (<b><p>a</p></b>) has ended the line itself.
			if (endsWithBlock(el)) open = false;
			continue;
		}
		end();
		if ((tag === 'p' || tag === 'div') && !Array.from(el.children).some(isBlock)) {
			start();
			const own = charFormat(el, tag, ctx, true);
			rtf += `${own.on}${walkChildren(el, own.ctx)}${own.off}`;
			end();
			continue;
		}
		// An item that begins with a block keeps its marker on a line of its own, except
		// before a list of its own, where the first marker shown is that list's.
		if (marker && tag !== 'ul' && tag !== 'ol') rtf += `${marker}\\par `;
		marker = null;
		rtf += walkNode(el, ctx, true, false);
	}
	end();
	// An empty item still shows its marker.
	if (marker) rtf += `${marker}\\par `;
	return rtf;
}

// ── Tables ──

/** The width a table is written at, in twips: 6 in, the text width of a Letter page with 1.25 in margins. */
const PAGE_WIDTH = 8640;

/**
 * A <table> as RTF rows. RTF has no table element: each row declares where its cells end
 * (\cellx), so the columns only line up if every row is written against the same column edges.
 * They are worked out once for the table (tableModel, columnShares), and then:
 *
 * - a cell across several columns (colspan) is one cell that ends at the right edge of the last
 *   column it covers;
 * - a cell down several rows (rowspan) is \clvmgf where it starts and an empty \clvmrg cell in
 *   the same columns of each row below, which is how RTF says "merged with the cell above";
 * - a row with fewer cells than the table has columns is filled with empty cells.
 *
 * A <th> gets a bottom border, which is how the parser knows a header cell, and a cell's own
 * text-align is its paragraphs' alignment.
 *
 * A cell's text ends with \cell inside its group and no \par before it. With "\par}\cell", as
 * cells were written up to 1.9.0, Apple's reader (TextEdit, Pages, Mail) put an empty paragraph
 * at the end of every cell, so every row was twice as tall. The last row carries \lastrow, which
 * is what tells a reader that a table following straight after is another table.
 */
function tableRtf(table: HTMLElement, ctx: WalkContext): string {
	const model = tableModel(table);
	let rtf = tableCaptionRtf(table, ctx, `\\pard${inCell(ctx)}`);
	if (model.columns === 0) return rtf;

	let cumulative = 0;
	const edges = columnShares(model, table).map((share) => {
		cumulative += share;
		return Math.round(cumulative * PAGE_WIDTH);
	});
	edges[edges.length - 1] = PAGE_WIDTH; // snap last edge to avoid rounding drift

	const started = new Set<GridCell>();
	for (let r = 0; r < model.rows.length; r++) {
		const row = model.rows[r];
		let definition = '';
		let bodies = '';

		for (let c = 0; c < model.columns; ) {
			const cell = row[c];
			// The run of columns this cell covers in this row. A slot no cell covers is an
			// empty cell of one column.
			let last = c;
			while (cell !== null && last + 1 < model.columns && row[last + 1] === cell) last++;

			const origin = cell !== null && cell.row === r && !started.has(cell);
			if (cell && origin) started.add(cell);
			const merged = cell !== null && cell.rowspan > 1;
			if (merged) definition += origin ? '\\clvmgf' : '\\clvmrg';
			if (cell?.el.tagName.toLowerCase() === 'th') definition += '\\clbrdrb\\brdrs';
			definition += `\\cellx${edges[last]}`;

			// A cell with no alignment of its own takes that of what the table is in.
			const align = cell && origin ? alignOf(cell.el, ctx) : '';
			let content = '';
			// (A cell that is not shown keeps its place in the row, empty.)
			if (cell && origin && !hiddenWithin(cell.el, table)) {
				// The cell's own color and the like. They end with the cell's group.
				const own = charFormat(cell.el, 'td', { ...ctx, inTableCell: true, cellAlign: align }, true);
				content = `${own.on}${withoutTrailingPar(walkChildren(cell.el, own.ctx))}`;
			}
			bodies += `{\\pard\\intbl${align} \\f0 \\sa0 \\li0 \\fi0 ${content}\\cell}`;
			c = last + 1;
		}

		const lastRow = r === model.rows.length - 1 ? '\\lastrow' : '';
		rtf += `{\\trowd\\trgaph120${definition}\\trkeep\\intbl{${bodies}}\\intbl${lastRow}\\row}`;
	}
	return rtf;
}

/**
 * A table's <caption>, as a centered paragraph before the table, which is where and how a
 * browser shows it. Anything else in a table that is in no cell (text a script put between the
 * rows) is written before the table too: nothing in a table is dropped for being outside a cell.
 */
function tableCaptionRtf(table: HTMLElement, ctx: WalkContext, paragraph: string): string {
	let rtf = '';
	const loose: Node[] = [];
	const collect = (parent: Element, depth: number) => {
		for (const child of Array.from(parent.childNodes)) {
			const tag = child.nodeType === Node.ELEMENT_NODE ? (child as Element).tagName.toLowerCase() : '';
			if (tag === 'caption') {
				if (isHidden(child as Element)) continue;
				const align = ownAlign(child as HTMLElement) ?? '\\qc';
				rtf += flowRtf(Array.from(child.childNodes), ctx, null, `${paragraph}${align === '\\ql' ? '' : align}${liControl(ctx.indent)} `);
			} else if (tag === 'td' || tag === 'th' || tag === 'colgroup' || tag === 'col') {
				// A cell is written in its row; a column definition holds no text.
			} else if (depth < 2 && (tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'tr')) {
				collect(child as Element, tag === 'tr' ? 2 : depth + 1);
			} else if (tag ? holdsSomething(child as Element) : child.nodeType === Node.TEXT_NODE && !COLLAPSIBLE_WHITESPACE.test(child.textContent || '')) {
				loose.push(child);
			}
		}
	};
	collect(table, 0);
	if (loose.length > 0) rtf += flowRtf(loose, ctx, null, `${paragraph}${cellAlign(ctx)}${liControl(ctx.indent)} `);
	return rtf;
}

/**
 * A table inside a table cell. RTF can nest tables (\itap, \nestcell), but many readers show a
 * nested table wrongly or not at all, and opening a row inside a cell, as the writer did, is not
 * valid RTF. So the inner table is written as lines of text in the cell it is in: each of its
 * rows a paragraph, its cells a tab apart. Every word is kept; the inner grid is not.
 */
function nestedTableRtf(table: HTMLElement, ctx: WalkContext): string {
	let rtf = followsInlineContent(table, ctx.root) ? '\\par ' : '';
	rtf += tableCaptionRtf(table, ctx, '\\pard\\intbl');
	for (const row of tableRowsInOrder(table)) {
		const cells = rowCells(row);
		if (cells.length === 0) continue;
		const line = cells.map((cell) => (hiddenWithin(cell, table) ? '' : withoutTrailingPar(walkChildren(cell, ctx)))).join('\\tab ');
		rtf += `\\pard\\intbl${cellAlign(ctx)} ${line}\\par `;
	}
	return rtf;
}

/** Body size times a ratio, in half-points. */
function scaled(ctx: WalkContext, ratio: number): number {
	return Math.round(ctx.bodySize * ratio);
}

/**
 * Whitespace a browser collapses: spaces, tabs and line breaks, but not a
 * non-breaking space, which is there on purpose.
 */
const COLLAPSIBLE_WHITESPACE = /^[ \t\r\n\f]*$/;

const BLOCK_TAGS = new Set([
	'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead',
	'tbody', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'pre', 'hr', 'figure', 'figcaption'
]);

/** (An element that is not shown is no block: it ends no line, and the space beside it is still a space.) */
function isBlock(node: Node | null): boolean {
	return node?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(tagOf(node as Element)) && !isHidden(node as Element);
}

/** A text node with a block element on either side, or at the edge of one. */
function besideBlock(node: Node): boolean {
	const prev = node.previousSibling;
	const next = node.nextSibling;
	return isBlock(prev) || isBlock(next) || (!prev && !next && isBlock(node.parentNode));
}

/**
 * Whether a <br> is one a browser shows nothing for: the last thing in its block, where an editor
 * leaves one so the line has height, or right before a block, which starts a new line anyway.
 */
function isTrailingBreak(br: Node, ctx: WalkContext): boolean {
	let node: Node = br;
	for (;;) {
		let next = node.nextSibling;
		while (
			next &&
			(next.nodeType === Node.COMMENT_NODE ||
				(next.nodeType === Node.ELEMENT_NODE && isHidden(next as Element)) ||
				(next.nodeType === Node.TEXT_NODE && COLLAPSIBLE_WHITESPACE.test(next.textContent || '') && !showsTabs(next)))
		) {
			next = next.nextSibling;
		}
		if (next) return isBlock(next);
		const parent = node.parentNode;
		if (!parent || parent === ctx.root || isBlock(parent)) return true;
		node = parent;
	}
}

/** Blocks other than <p> and <div> that end the loose text before them (walkNode). */
const BREAKS_LOOSE_TEXT = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote', 'pre', 'hr', 'ul', 'ol', 'li', 'figure']);

/** A <p> or <div> with no content, or only a <br>: a blank line. */
function isBlankLine(el: HTMLElement): boolean {
	return el.childNodes.length === 0 || (el.childNodes.length === 1 && el.childNodes[0].nodeName === 'BR');
}

/** Collapsible whitespace, a comment, or an element that is not shown: nothing that shows. */
function showsNothing(node: Node): boolean {
	if (node.nodeType === Node.ELEMENT_NODE) return isHidden(node as Element);
	return node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && COLLAPSIBLE_WHITESPACE.test(node.textContent || ''));
}

/**
 * Whether a block ends its own line in the RTF. Every block does, except a <figcaption> outside a
 * figure, whose text is written where it stands.
 */
function endsItsLine(node: Node): boolean {
	return isBlock(node) && node.nodeName !== 'FIGCAPTION';
}

/** Whether an inline element's content ends with a block, which has ended its own line. */
function endsWithBlock(el: Node): boolean {
	// (Down the last thing in the last thing, in a loop: no call for each level of nesting.)
	for (let at: Node = el; ; ) {
		let last = at.lastChild;
		while (last && showsNothing(last)) last = last.previousSibling;
		if (!last || last.nodeType !== Node.ELEMENT_NODE) return false;
		if (endsItsLine(last)) return true;
		at = last;
	}
}

/**
 * Whether the nearest sibling before this element, skipping collapsible whitespace and comments,
 * is text or an inline element: content with no paragraph of its own. Not when that content has
 * already ended its line: a picture straight under `root` writes its own paragraph, and a wrapper
 * whose last child is a block (Google Docs wraps a paste in <b id="docs-internal-guid-…">) ends
 * with that block's.
 */
function followsInlineContent(el: HTMLElement, root: Node | null = null): boolean {
	let node: Node = el;
	for (;;) {
		let prev = node.previousSibling;
		while (prev && showsNothing(prev)) prev = prev.previousSibling;
		if (prev) {
			if (prev.nodeType === Node.TEXT_NODE) return true;
			if (prev.nodeType !== Node.ELEMENT_NODE || endsItsLine(prev)) return false;
			if (prev.nodeName === 'IMG' && root !== null && prev.parentNode === root) return false;
			return !endsWithBlock(prev);
		}
		// The first thing in an inline wrapper (<b><p>…</p></b>, the wrapper of a Google Docs
		// paste, a <span> around a list) follows what the wrapper follows: text typed before
		// the paste was run into its first paragraph.
		const parent = node.parentNode;
		if (!parent || parent === root || parent.nodeType !== Node.ELEMENT_NODE || isBlock(parent)) return false;
		node = parent;
	}
}

/**
 * The nearest sibling before a node that shows something, past white space, comments and hidden
 * elements. Each node passed on the way is remembered with the same answer, so a page of
 * thousands of comments in a row is looked back over once, not from every piece of text among
 * them: that took seconds, and in a test DOM, where stepping to a sibling is itself slow, far more.
 */
function shownBefore(node: Node, ctx: WalkContext): Node | null {
	const passed: Node[] = [];
	let found = ctx.shownBefore.get(node);
	for (let at: Node = node; found === undefined; ) {
		passed.push(at);
		const prev: Node | null = at.previousSibling;
		if (!prev || !showsNothing(prev)) found = prev;
		else {
			found = ctx.shownBefore.get(prev);
			at = prev;
		}
	}
	for (const each of passed) ctx.shownBefore.set(each, found);
	return found;
}

/** Whether the nearest sibling after this element, skipping collapsible whitespace, is text or an inline element. */
function followedByInline(el: HTMLElement): boolean {
	let next = el.nextSibling;
	while (next && showsNothing(next)) next = next.nextSibling;
	if (!next) return false;
	return next.nodeType === Node.TEXT_NODE || (next.nodeType === Node.ELEMENT_NODE && !isBlock(next));
}

/**
 * Blocks whose last paragraph always carries an indent or alignment of its own. A table is one:
 * its rows are a group, and when the group ends the paragraph formatting in force is that of
 * whatever came before the table.
 */
const FORMATTED_BLOCK_TAGS = new Set(['ul', 'ol', 'li', 'blockquote', 'figure', 'hr', 'table']);

/**
 * Loose text or an inline element right after a block has no paragraph of its own, and would
 * keep that block's alignment and indent (a centered line's \qc, a list's \li). Start a plain
 * one, at the indent of the blocks around it. After a block with no formatting of its own,
 * nothing is written, as before.
 */
function restateAfterBlock(node: Node, ctx: WalkContext): string {
	const prev = shownBefore(node, ctx);
	if (!isBlock(prev)) return '';
	const block = prev as HTMLElement;
	const tag = tagOf(block);
	const formatted =
		FORMATTED_BLOCK_TAGS.has(tag) ||
		// (A container's own alignment or indent is its blocks': what is inside it had them.)
		(['p', 'div'].includes(tag) && ((ctx.inTableCell ? paragraphLayout(block, ctx) : paragraphFormat(block, ctx)) !== '' || Array.from(block.children).some(isBlock))) ||
		(HEADING_TAGS.has(tag) && headingLayout(block, ctx) !== '') ||
		(tag === 'pre' && ctx.indent + leftMarginTwips(block) > 0);
	return formatted ? `\\pard${inCell(ctx)}${cellAlign(ctx)}${liControl(ctx.indent)} ` : '';
}

/**
 * The cell's own \par ends its last paragraph, so that paragraph's mark is dropped. Only a
 * real control word: "\par " preceded by an odd run of backslashes is escaped text.
 */
function withoutTrailingPar(content: string): string {
	if (!content.endsWith('\\par ')) return content;
	let slashes = 0;
	for (let i = content.length - 6; i >= 0 && content[i] === '\\'; i--) slashes++;
	return slashes % 2 === 0 ? content.slice(0, -5) : content;
}

// ── Paragraph formatting ──

const TWIPS_PER_UNIT: Record<string, number> = { in: 1440, pt: 20, cm: 1440 / 2.54, mm: 144 / 2.54, px: TWIPS_PER_PX };

/**
 * A CSS length in whole twips, or null when it cannot be read: a unit other than in, pt, cm, mm or
 * px, a percentage, a keyword, or a negative value where one is not allowed.
 */
function lengthTwips(value: string | null | undefined, allowNegative = false): number | null {
	const m = (value ?? '').trim().toLowerCase().match(/^(-?\d+(?:\.\d+)?|-?\.\d+)(in|pt|cm|mm|px)$/);
	if (!m) return null;
	const twips = Math.round(parseFloat(m[1]) * TWIPS_PER_UNIT[m[2]]);
	if (twips < 0 && !allowNegative) return null;
	return Math.max(-MAX_TWIPS, Math.min(MAX_TWIPS, twips));
}

/**
 * An element's own left margin in twips, from its inline style: what the browser's Indent sets
 * (Firefox puts margin-left on the paragraph; Chromium and WebKit on a wrapping blockquote).
 * Units a reader cannot pin to a length (%, em) count as none.
 */
function leftMarginTwips(el: HTMLElement): number {
	return lengthTwips(el.style?.marginLeft) ?? 0;
}

/**
 * The indent shape Chromium, WebKit and Gmail write: a blockquote with border: none, where a
 * quotation keeps its border. The editor's Indent reads it the same way.
 */
function isIndentBlockquote(el: HTMLElement): boolean {
	return el.style?.borderLeftStyle === 'none';
}

/** \liN for a left indent in twips, or nothing when there is none. */
function liControl(twips: number): string {
	// (Indents add up through nested blocks: the sum is kept on the page too.)
	return twips > 0 ? `\\li${Math.min(twips, MAX_TWIPS)}` : '';
}

/**
 * \qc, \qr or \qj; left is the default and is not written. Inside a table cell that is aligned
 * itself, a block with no alignment of its own takes the cell's, and one set left says so.
 */
function alignOf(el: HTMLElement, ctx?: WalkContext): string {
	const own = ownAlign(el);
	const cell = ctx ? cellAlign(ctx) : '';
	if (own == null) return cell;
	if (own === '\\ql') return cell ? own : '';
	return own;
}

/**
 * A heading's, or a paragraph's inside a table cell: its alignment, and \liN for the indent of
 * the blocks around it plus its own margin.
 */
function paragraphLayout(el: HTMLElement, ctx: WalkContext): string {
	return `${alignOf(el, ctx)}${liControl(ctx.indent + leftMarginTwips(el))}`;
}

/**
 * A heading's layout: its alignment and left indent, and outside a table cell its right and
 * first-line indents too, so a heading read from RTF with a hanging number goes back as it came.
 */
function headingLayout(el: HTMLElement, ctx: WalkContext): string {
	return `${paragraphLayout(el, ctx)}${ctx.inTableCell ? '' : edgeIndents(el)}`;
}

/** \\riN for margin-right and \\fiN for text-indent, or nothing where the element sets none. */
function edgeIndents(el: HTMLElement): string {
	const ri = lengthTwips(el.style?.marginRight);
	const fi = lengthTwips(el.style?.textIndent, true);
	return `${ri ? `\\ri${ri}` : ''}${fi ? `\\fi${fi}` : ''}`;
}

/**
 * A <p> or <div>'s formatting outside a table cell: its alignment, then paragraphControls with the
 * indent of the blocks around it plus its own margin.
 */
function paragraphFormat(el: HTMLElement, ctx: WalkContext): string {
	return `${alignOf(el, ctx)}${paragraphControls(el, ctx.indent + leftMarginTwips(el))}`;
}

/** The alignment a container hands to the blocks inside it: its own, or the one it was handed. */
function inheritedAlign(el: HTMLElement, ctx: WalkContext): string {
	const own = ownAlign(el);
	if (own == null) return ctx.cellAlign;
	return own === '\\ql' ? '' : own;
}

/**
 * The RTF paragraph controls for a <p> or <div>'s own formatting, or '' when it sets none:
 *
 * | HTML                                             | RTF               |
 * |--------------------------------------------------|-------------------|
 * | data-rtf-tab-stops="1.75in" (comma-separated)    | \tx2520           |
 * | margin-left: 1.75in (the left indent, given)     | \li2520           |
 * | margin-right: 0.5in                              | \ri720            |
 * | text-indent: -1.75in                             | \fi-2520          |
 * | margin-top: 5pt / margin-bottom: 5pt             | \sb100 / \sa100   |
 * | break-after: avoid, or page-break-after: avoid   | \keepn            |
 *
 * CSS has no absolute tab stop, hence the data- attribute. A value that cannot be read writes
 * nothing, and so does zero, which is what \pard already sets. Not written inside a table cell,
 * where the cell declares its own paragraph.
 */
function paragraphControls(el: HTMLElement, leftTwips: number): string {
	let out = '';
	const stops = (el.getAttribute('data-rtf-tab-stops') ?? '')
		.split(',')
		.map((v) => lengthTwips(v))
		.filter((t): t is number => t != null && t > 0);
	for (const t of Array.from(new Set(stops)).sort((a, b) => a - b)) out += `\\tx${t}`;
	out += liControl(leftTwips);
	const style = el.style;
	if (!style) return out;
	out += edgeIndents(el);
	const sb = lengthTwips(style.marginTop);
	if (sb) out += `\\sb${sb}`;
	const sa = lengthTwips(style.marginBottom);
	if (sa) out += `\\sa${sa}`;
	const keep = (prop: string) => style.getPropertyValue(prop).trim() === 'avoid';
	if (keep('break-after') || keep('page-break-after')) out += '\\keepn';
	return out;
}

/** Whether the nearest element before this one is a <p> or <div> with formatting of its own. */
function followsFormattedParagraph(el: HTMLElement, ctx: WalkContext): boolean {
	const prev = el.previousElementSibling as HTMLElement | null;
	if (!prev) return false;
	const tag = tagOf(prev);
	return (tag === 'p' || tag === 'div') && paragraphFormat(prev, ctx) !== '';
}

/** Whether a container's first (or last) content is loose text or an inline element, not a block. */
function startsWithInline(el: HTMLElement): boolean {
	return edgeIsInline(el, 'first');
}

function endsWithInline(el: HTMLElement): boolean {
	return edgeIsInline(el, 'last');
}

function edgeIsInline(el: HTMLElement, edge: 'first' | 'last'): boolean {
	const nodes = Array.from(el.childNodes);
	if (edge === 'last') nodes.reverse();
	for (const n of nodes) {
		if (showsNothing(n)) continue;
		return !isBlock(n);
	}
	return false;
}

/** \intbl for a paragraph a block writes inside a table cell, so it stays in the cell. */
function inCell(ctx: WalkContext): string {
	return ctx.inTableCell ? '\\intbl' : '';
}

/**
 * The alignment a block takes when it sets none (\qc, \qr or \qj): that of the table cell the
 * walker is in, or of a <div> or <center> around the block.
 */
function cellAlign(ctx: WalkContext): string {
	return ctx.cellAlign;
}

/** Whether a rule stands for a page break: <hr style="break-after:page">, as the parser writes \page. */
function isPageBreak(el: HTMLElement): boolean {
	const value = (prop: string) => el.style?.getPropertyValue(prop).trim();
	return value('break-after') === 'page' || value('page-break-after') === 'always';
}

/** Color-table index of the element's own color, or null when it sets none. */
function colorIndexOf(el: HTMLElement, ctx: WalkContext): number | null {
	// Support both inline style.color (spans) and the color attribute (<font>)
	const color = el.style?.color ||
		(el.tagName.toLowerCase() === 'font' ? (el.getAttribute('color') ?? '') : '');
	if (!color) return null;
	const c = parseColor(color);
	if (!c) return null;
	return ctx.colorIndex.get(colorKey(c)) ?? null;
}

/**
 * The sizes of <font size="1"> to <font size="7">, in half-points, as browsers show them
 * (10, 13, 16, 18, 24, 32 and 48 px). Older pages and mail carry their sizes this way.
 */
const FONT_SIZE_ATTRIBUTE = [15, 20, 24, 27, 36, 48, 72];

/** The element's own font size in half-points, or null when it sets none. */
function sizeOf(el: HTMLElement): number | null {
	const fs = el.style?.fontSize;
	if (!fs) {
		const step = el.tagName === 'FONT' ? /^\s*([1-7])\s*$/.exec(el.getAttribute('size') ?? '') : null;
		return step ? FONT_SIZE_ATTRIBUTE[Number(step[1]) - 1] : null;
	}
	// From half a point to Word's largest size; a size that is no number, or zero, is no size.
	const halfPoints = (points: number): number | null =>
		Number.isFinite(points) && points > 0 ? Math.min(MAX_FONT_SIZE * 2, Math.max(1, Math.round(points * 2))) : null;
	const ptMatch = fs.match(/([\d.]+)\s*pt/);
	if (ptMatch) return halfPoints(parseFloat(ptMatch[1]));
	const pxMatch = fs.match(/([\d.]+)\s*px/);
	if (pxMatch) return halfPoints(parseFloat(pxMatch[1]) * 0.75);
	return null;
}
