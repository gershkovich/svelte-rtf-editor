/**
 * RTF to HTML converter
 *
 * Parses RTF control words and groups into an HTML string.
 * Supports: bold, italic, underline, strikethrough, super/subscript,
 * font size, foreground color (\cf), highlight background color (\highlight),
 * color table, font table (monospace text reads as code), paragraphs with their
 * alignment and indents, headings, bullet/numbered lists, hyperlinks, tables with
 * merged cells, embedded pictures (\pict PNG/JPEG blips, with captions),
 * Unicode characters, Windows-1252 hex escapes, and nested groups.
 *
 * \cb (character background) is silently ignored on import.
 */

import {
	HEADING_SCALE,
	PRE_SCALE,
	LINK_COLOR,
	isMonospaceFontName,
	linkTarget,
	normalizeFontSize
} from './rtf-writer.js';

// ── Types ──

interface RtfGroup {
	type: 'group';
	children: RtfNode[];
}

interface RtfControl {
	type: 'control';
	word: string;
	param: number | null;
}

interface RtfText {
	type: 'text';
	value: string;
	/** A \'xx escape: one character to a \u fallback count, even when it decodes to nothing. */
	hex?: boolean;
}

type RtfNode = RtfGroup | RtfControl | RtfText;

type Token =
	| { type: 'open' }
	| { type: 'close' }
	| { type: 'control'; word: string; param: number | null }
	| { type: 'text'; value: string; hex?: boolean };

interface RenderState {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	super_: boolean;
	sub: boolean;
	fontSize: number;
	colorIndex: number;
	highlightIndex: number;
	fontIndex: number;
	ucSkip: number;
	inList: boolean;
	/** The address of the link this text is in ({\field{\*\fldinst HYPERLINK …}}), or ''. */
	link: string;
	/**
	 * Paragraph indents in twips: \li (left), \ri (right) and \fi (first line, negative when the
	 * paragraph hangs). They hold from one paragraph to the next until \pard, and like the rest of
	 * this state they end with the group they were set in: a \pard inside {\listtext ...} or
	 * {\pntext ...} does not reach the paragraph around it.
	 */
	leftIndent: number;
	rightIndent: number;
	firstLineIndent: number;
}

/**
 * The character formatting one piece of text is shown with. Only what shows is kept: a color
 * index with no entry in the table, black, and the underline and color a link has anyway are all
 * "none" here, so two pieces that look the same are the same, and are joined.
 */
interface RunFormat {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	super_: boolean;
	sub: boolean;
	/** In half-points. */
	fontSize: number;
	/** The text color as CSS, or '' for the reader's own. */
	color: string;
	/** The highlight color as CSS, or ''. */
	background: string;
	/** Set in a monospace font that is not the document's own font: code. */
	mono: boolean;
	link: string;
}

/**
 * A paragraph is kept as its pieces until the whole document is read, because what a piece
 * becomes depends on the paragraph around it: the size on a heading's text is the heading's, the
 * bullet and tab that open a list item are the list's, and a paragraph set wholly in the code
 * font is a code block.
 */
type Run =
	| { type: 'text'; text: string; fmt: RunFormat }
	| { type: 'html'; kind: 'br' | 'tab' | 'gap' | 'img'; html: string; fmt: RunFormat };

/** A bullet or a number, then a tab, at the start of a paragraph. */
interface ListMarker {
	kind: 'ul' | 'ol';
	/** The number of a numbered item. */
	number: number;
	/** Index of the first run after the marker and its tab. */
	end: number;
}

interface ParagraphBlock {
	kind: 'paragraph';
	runs: Run[];
	align: string;
	/** \li, \ri and \fi in twips. */
	left: number;
	right: number;
	first: number;
	/** Tagged by {\*\inkcap}: the description of the figure above it. */
	caption: boolean;
	marker: ListMarker | null;
	/** Cell text that never met its \cell: its indents are the cell's, not a paragraph's. */
	inTable: boolean;
}

type Block =
	| ParagraphBlock
	| { kind: 'table'; html: string }
	| { kind: 'rule'; pageBreak: boolean };

/** One \cellx of a row definition, with the cell properties written before it. */
interface CellDef {
	right: number;
	/** A bottom border: a header cell, as the writer marks one. */
	header: boolean;
	/** \clvmgf: the first cell of a vertical merge. \clvmrg: a cell merged into the one above. */
	vmgf: boolean;
	vmrg: boolean;
	/** \clmgf and \clmrg, the same for a horizontal merge. */
	hmgf: boolean;
	hmrg: boolean;
}

interface RowCell {
	html: string;
	align: string;
}

interface TableRow {
	cells: RowCell[];
	defs: CellDef[];
}

// ── Highlight palette (RTF \highlight 1-16) ──

const HIGHLIGHT_COLORS: Record<number, string> = {
	1:  '#000000', // Black
	2:  '#0000ff', // Blue
	3:  '#00ffff', // Cyan
	4:  '#00ff00', // Green
	5:  '#ff00ff', // Magenta
	6:  '#ff0000', // Red
	7:  '#ffff00', // Yellow
	8:  '#ffffff', // White
	9:  '#000080', // Dark Blue
	10: '#008080', // Dark Cyan
	11: '#008000', // Dark Green
	12: '#800080', // Dark Magenta
	13: '#800000', // Dark Red
	14: '#808000', // Dark Yellow
	15: '#808080', // Dark Gray
	16: '#c0c0c0', // Light Gray
};

// ── Picture helpers ──

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 1 px at 96 dpi = 15 twips. */
const TWIPS_PER_PX = 15;

/** A paragraph made up of nothing but pictures is rendered as a <figure>. */
const IMAGE_ONLY_PARAGRAPH = /^(?:<img\b[^>]*>\s*)+$/;

/** Nibble value of each hex digit's char code; -1 for anything else. */
const HEX_NIBBLE = (() => {
	const table = new Int8Array(128).fill(-1);
	for (let i = 0; i < 10; i++) table[48 + i] = i; // '0'–'9'
	for (let i = 0; i < 6; i++) {
		table[97 + i] = 10 + i; // 'a'–'f'
		table[65 + i] = 10 + i; // 'A'–'F'
	}
	return table;
})();

/** A tab as the editor's Tab key inserts it (Chromium's own shape for a typed tab). */
const TAB_HTML = '<span style="white-space:pre">\t</span>';

/** Text so far holding only a list marker: a bullet, or a number and a period. */
const LIST_MARKER = /^\s*(?:\u2022|(\d+)\.)\s*$/;

/**
 * The bullet Word writes inside {\listtext …} and {\pntext …}: byte B7 of the Symbol font, which
 * arrives as a middle dot or as the font's private-use character.
 */
const SYMBOL_BULLET = /^\s*[\u00b7\uf0b7]\s*$/;

/** Text a browser shows as nothing but space. */
const ONLY_SPACES = /^[ \t\r\n\f]*$/;

/** The rule the writer sends for <hr>: a centered line of this many em dashes. */
const RULE_DASHES = '\u2014'.repeat(20);

/** A hanging indent of this many twips is the one the writer gives a list item (\fi-360). */
const LIST_HANG = 360;

/** The longest number a numbered list item is read with. */
const MAX_LIST_NUMBER_DIGITS = 9;

/** Each level of a list is indented this much further (\li720). */
const LIST_STEP = 720;

/**
 * The largest RTF string rtfToHtml reads unless told otherwise: 50 MB. A document is parsed in
 * one go on the main thread, and a picture is decoded from two characters per byte, so the size
 * of what is handed in is the only bound on how long the page stops responding.
 */
export const DEFAULT_MAX_RTF_BYTES = 50 * 1024 * 1024;

/** Hex picture data → base64, without depending on btoa/Buffer. */
function hexToBase64(hex: string): string {
	const byteCount = hex.length >> 1;
	// A multi-MB picture runs to millions of digits, so this reads char codes
	// against a lookup table rather than slicing and parsing per byte, and
	// collects into an array rather than concatenating per output character.
	const out: string[] = new Array(Math.ceil(byteCount / 3) * 4);
	let written = 0;
	let buffer = 0;
	let bits = 0;

	for (let i = 0; i < byteCount; i++) {
		const hi = HEX_NIBBLE[hex.charCodeAt(i * 2)] ?? -1;
		const lo = HEX_NIBBLE[hex.charCodeAt(i * 2 + 1)] ?? -1;
		if (hi < 0 || lo < 0) return '';
		buffer = (buffer << 8) | ((hi << 4) | lo);
		bits += 8;
		while (bits >= 6) {
			bits -= 6;
			out[written++] = B64_ALPHABET[(buffer >> bits) & 0x3f];
		}
	}

	if (bits > 0) {
		out[written++] = B64_ALPHABET[(buffer << (6 - bits)) & 0x3f];
	}
	while (written % 4 !== 0) out[written++] = '=';

	out.length = written;
	return out.join('');
}

/**
 * Render a {\pict …} group as an <img> with a data URL. Returns '' for picture
 * formats a browser cannot display (metafiles, device-dependent bitmaps).
 *
 * Only hexadecimal picture data is read. RTF also allows \binN, where the next
 * N bytes are raw binary — rare outside of Word's own output, and it cannot
 * survive readRtfFile() reading the document as text anyway. Such a picture is
 * skipped rather than mis-decoded: \bin is not a recognised control word here,
 * so its bytes fall through the tokenizer and the hex filter discards them.
 */
function renderPicture(group: RtfGroup): string {
	let mime = '';
	let picw = 0, pich = 0, wgoal = 0, hgoal = 0;
	let scaleX = 100, scaleY = 100;
	const hexParts: string[] = [];

	for (const node of group.children) {
		if (node.type === 'control') {
			switch (node.word) {
				case 'pngblip': mime = 'image/png'; break;
				case 'jpegblip': mime = 'image/jpeg'; break;
				case 'picw': picw = node.param ?? 0; break;
				case 'pich': pich = node.param ?? 0; break;
				case 'picwgoal': wgoal = node.param ?? 0; break;
				case 'pichgoal': hgoal = node.param ?? 0; break;
				case 'picscalex': scaleX = node.param ?? 100; break;
				case 'picscaley': scaleY = node.param ?? 100; break;
				default: break;
			}
		} else if (node.type === 'text') {
			hexParts.push(node.value);
		}
		// Nested groups such as {\*\blipuid …} carry no picture data.
	}

	if (!mime) return '';

	const hex = hexParts.join('').replace(/[^0-9a-fA-F]/g, '');
	if (hex.length < 8) return '';

	const base64 = hexToBase64(hex);
	if (!base64) return '';

	const widthPx = wgoal
		? Math.round(wgoal / TWIPS_PER_PX)
		: Math.round((picw * scaleX) / 100);
	const heightPx = hgoal
		? Math.round(hgoal / TWIPS_PER_PX)
		: Math.round((pich * scaleY) / 100);

	const styles: string[] = [];
	if (widthPx > 0) styles.push(`width:${widthPx}px`);
	if (widthPx > 0 && heightPx > 0) styles.push('height:auto');
	const style = styles.length ? ` style="${styles.join(';')}"` : '';

	return `<img src="data:${mime};base64,${base64}"${style} alt="">`;
}

// ── Tokenizer ──

/**
 * What \'80 to \'9f stand for in Windows-1252, the code page RTF's \ansi text is written in:
 * curly quotes, dashes, the euro sign and the like, where Latin-1 has invisible control
 * characters. \'92 is the apostrophe in "It's" as TextEdit and many Windows programs write it.
 * The five bytes Windows-1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their own value.
 */
const WINDOWS_1252_C1 = [
	0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
	0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
	0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
	0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178
];

/**
 * The character a \'xx byte stands for. A NUL is no character and decodes to nothing: it would
 * end the text where a browser or a receiving system reads it.
 */
function cp1252Char(byte: number): string {
	const code = WINDOWS_1252_C1[byte - 0x80] ?? byte;
	return code ? String.fromCharCode(code) : '';
}

function tokenize(rtf: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const len = rtf.length;

	while (i < len) {
		const ch = rtf[i];

		if (ch === '{') {
			tokens.push({ type: 'open' });
			i++;
		} else if (ch === '}') {
			tokens.push({ type: 'close' });
			i++;
		} else if (ch === '\\') {
			i++;
			if (i >= len) break;

			const next = rtf[i];

			// Hex escape \'xx: one byte of Windows-1252.
			if (next === "'") {
				i++;
				const hi = HEX_NIBBLE[rtf.charCodeAt(i)] ?? -1;
				const lo = HEX_NIBBLE[rtf.charCodeAt(i + 1)] ?? -1;
				// A \' with no two hex digits after it is damage, not a character: it is
				// dropped, and what follows is read as it stands. (parseInt on it gave NaN,
				// which became a NUL in the HTML.)
				if (hi >= 0 && lo >= 0) {
					i += 2;
					tokens.push({ type: 'text', value: cp1252Char((hi << 4) | lo), hex: true });
				}
			}
			// Special escapes
			else if (next === '\\' || next === '{' || next === '}') {
				tokens.push({ type: 'text', value: next });
				i++;
			}
			// Line breaks as control
			else if (next === '\n' || next === '\r') {
				tokens.push({ type: 'control', word: 'par', param: null });
				i++;
				if (i < len && rtf[i] === '\n') i++;
			}
			// Tilde = non-breaking space
			else if (next === '~') {
				tokens.push({ type: 'text', value: '\u00A0' });
				i++;
			}
			// Hyphen shortcuts
			else if (next === '-') {
				tokens.push({ type: 'text', value: '\u00AD' }); // soft hyphen
				i++;
			} else if (next === '_') {
				tokens.push({ type: 'text', value: '\u2011' }); // non-breaking hyphen
				i++;
			}
			// Control word or control symbol
			else if (/[a-zA-Z]/.test(next)) {
				let word = '';
				while (i < len && /[a-zA-Z]/.test(rtf[i])) {
					word += rtf[i];
					i++;
				}
				// Optional numeric parameter (can be negative)
				let param: number | null = null;
				if (i < len && (rtf[i] === '-' || /[0-9]/.test(rtf[i]))) {
					let numStr = '';
					if (rtf[i] === '-') {
						numStr += '-';
						i++;
					}
					while (i < len && /[0-9]/.test(rtf[i])) {
						numStr += rtf[i];
						i++;
					}
					// A lone "-" is no number.
					const value = parseInt(numStr, 10);
					param = Number.isFinite(value) ? value : null;
				}
				// Consume optional trailing space delimiter
				if (i < len && rtf[i] === ' ') i++;

				tokens.push({ type: 'control', word, param });
			}
			// Control symbol (single non-alpha char)
			else {
				tokens.push({ type: 'control', word: next, param: null });
				i++;
			}
		} else if (ch === '\r' || ch === '\n') {
			// Skip bare newlines (they're not meaningful in RTF)
			i++;
		} else {
			// Plain text — slice up to the next special char. Slicing rather than
			// appending char-by-char keeps embedded picture data (which arrives as
			// one very long text run) from being quadratic.
			const start = i;
			while (i < len) {
				const c = rtf[i];
				if (c === '\\' || c === '{' || c === '}' || c === '\r' || c === '\n') break;
				i++;
			}
			if (i > start) {
				tokens.push({ type: 'text', value: rtf.substring(start, i) });
			}
		}
	}

	return tokens;
}

// ── AST Builder ──

/**
 * The deepest group the tree holds. The renderer walks groups recursively, and thousands of
 * nested groups (damaged or hostile input) would overflow the stack; real documents nest a few
 * dozen deep at most. Groups below this depth are folded into the one at it: their text is kept,
 * and their formatting carries on to the end of that group.
 */
const MAX_GROUP_DEPTH = 500;

function buildTree(tokens: Token[]): RtfGroup {
	const root: RtfGroup = { type: 'group', children: [] };
	const stack: RtfGroup[] = [root];
	/** Groups opened past MAX_GROUP_DEPTH and not closed yet. */
	let folded = 0;

	for (const tok of tokens) {
		const current = stack[stack.length - 1];

		if (tok.type === 'open') {
			if (stack.length > MAX_GROUP_DEPTH) {
				folded++;
				continue;
			}
			const group: RtfGroup = { type: 'group', children: [] };
			current.children.push(group);
			stack.push(group);
		} else if (tok.type === 'close') {
			if (folded > 0) folded--;
			else if (stack.length > 1) stack.pop();
		} else if (tok.type === 'control') {
			current.children.push({ type: 'control', word: tok.word, param: tok.param ?? null });
		} else if (tok.type === 'text') {
			current.children.push(tok.hex ? { type: 'text', value: tok.value, hex: true } : { type: 'text', value: tok.value });
		}
	}

	return root;
}

// ── Color table parser ──

/** A color component as a reader may use it: a damaged table can hold \red999 or \green-5. */
function colorComponent(value: number | null): number {
	return Math.min(255, Math.max(0, value ?? 0));
}

function parseColorTable(group: RtfGroup): string[] {
	const colors: string[] = [''];  // index 0 = auto/default
	let r = 0, g = 0, b = 0;
	let hasComponents = false;

	function finalizeEntry() {
		// In standard RTF, a leading ";" represents the auto color (index 0).
		// We already reserve colors[0] for auto, so do not append another entry.
		if (colors.length === 1 && !hasComponents) return;
		colors.push(`rgb(${r},${g},${b})`);
	}

	for (const node of group.children) {
		if (node.type === 'control') {
			if (node.word === 'red') { r = colorComponent(node.param); hasComponents = true; }
			else if (node.word === 'green') { g = colorComponent(node.param); hasComponents = true; }
			else if (node.word === 'blue') { b = colorComponent(node.param); hasComponents = true; }
		} else if (node.type === 'text' && node.value.includes(';')) {
			// Each ';' terminates one color entry
			const semiCount = (node.value.match(/;/g) || []).length;
			for (let i = 0; i < semiCount; i++) {
				finalizeEntry();
				r = 0; g = 0; b = 0;
				hasComponents = false;
			}
		}
	}

	return colors;
}

// ── Font table parser ──

/**
 * The numbers of the fonts that are monospace: named like one (Courier New, Consolas), or declared
 * \fmodern or fixed-pitch (\fprq1). Reads both shapes a font table comes in: one group per font
 * ({\f1\fmodern Courier New;}), and TextEdit's run of entries with no groups
 * (\f0\fswiss Helvetica;\f1\fmodern Courier;).
 */
function monospaceFonts(group: RtfGroup): Set<number> {
	const mono = new Set<number>();
	let num: number | null = null;
	let name = '';
	let fixed = false;

	const finish = () => {
		if (num != null && (fixed || isMonospaceFontName(name))) mono.add(num);
		num = null;
		name = '';
		fixed = false;
	};

	const read = (nodes: RtfNode[]) => {
		for (const node of nodes) {
			if (node.type === 'control') {
				if (node.word === 'f' && node.param != null) {
					if (num != null) finish();
					num = node.param;
				} else if (node.word === 'fmodern' || (node.word === 'fprq' && node.param === 1)) {
					fixed = true;
				}
			} else if (node.type === 'text') {
				// A name ends at its ';'.
				const parts = node.value.split(';');
				name += parts[0];
				if (parts.length > 1) finish();
			}
			// A group inside an entry ({\*\panose …}, {\*\falt …}) is not part of the name.
		}
	};

	for (const child of group.children) {
		if (child.type === 'group') {
			read(child.children);
			finish();
		}
	}
	read(group.children.filter((n) => n.type !== 'group'));
	finish();

	return mono;
}

// ── Links ──

/** The longest field instruction looked at for a link's address. */
const MAX_FIELD_INSTRUCTION = 8192;

/**
 * The text of a field's instruction group, {\*\fldinst HYPERLINK "…"}, or null when it holds a
 * \u escape: the address would then be the fallback character's, not the one meant.
 */
function fieldInstruction(group: RtfGroup): string | null {
	let text = '';
	const pending: RtfNode[] = [...group.children].reverse();
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (node.type === 'group') {
			for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
		} else if (node.type === 'control') {
			if (node.word === 'u') return null;
		} else {
			text += node.value;
			if (text.length > MAX_FIELD_INSTRUCTION) return null;
		}
	}
	return text;
}

/**
 * The address a {\field …} group links to, or '' when it is not a link, or not one that may be
 * followed. Only what the writer itself would write is accepted (linkTarget): an absolute web,
 * mail or phone address. A javascript: or file: address, or a link to a bookmark, stays text.
 */
function fieldLink(field: RtfGroup): string {
	const instruction = field.children.find(
		(n): n is RtfGroup => n.type === 'group' && n.children.some((c) => c.type === 'control' && c.word === 'fldinst')
	);
	if (!instruction) return '';
	const text = fieldInstruction(instruction);
	if (text == null) return '';
	const m = text.match(/^\s*HYPERLINK\s+(?:"([^"]*)"|([^\s"\\]\S*))/i);
	if (!m) return '';
	return linkTarget(m[1] ?? m[2] ?? '') ?? '';
}

// ── Body size ──

/** Groups whose content is not document text. */
const destinationWords = new Set([
	'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer',
	'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
	// \nonshppict duplicates the picture already carried by \*\shppict
	'nonshppict',
	// {\nonesttables \par} is for readers that do not know nested tables; \nestrow is read here
	'nonesttables',
	'object', 'fldinst', 'xmlnstbl', 'listtable', 'listoverridetable',
	'rsidtbl', 'generator', 'datafield', 'themedata', 'colorschememapping',
	'latentstyles', 'datastore', 'mmathPr', 'author', 'operator',
	'title', 'subject', 'doccomm', 'company', 'category', 'keywords'
]);

// ── Renderer ──

/** Options for rtfToHtml. */
export interface RtfReadOptions {
	/**
	 * The body text size of the screen the HTML will be shown on, in points:
	 * the editor's or viewer's fontSize. Text at this size carries no size of
	 * its own, text at any other size keeps its font-size, and headings are
	 * recognized by their ratio to it (HEADING_SCALE). Default: 12, which reads
	 * a document exactly as 1.4.0 did.
	 */
	fontSize?: number;
	/**
	 * The largest RTF string to read, in characters (RTF is ASCII, so also bytes). A longer one
	 * is refused with a RangeError before any of it is parsed. Default: DEFAULT_MAX_RTF_BYTES
	 * (50 MB). 0 reads a document of any size.
	 */
	maxBytes?: number;
}

/** Twips as a CSS length in points (20 twips), which the writer reads back as the same twips. */
function twipsToPt(twips: number): string {
	return `${Math.round(twips * 5) / 100}pt`;
}

function resetIndents(state: RenderState): void {
	state.leftIndent = 0;
	state.rightIndent = 0;
	state.firstLineIndent = 0;
}

/**
 * A paragraph's indents as CSS, in points (20 twips), which the writer reads back as the same
 * \li, \ri and \fi: "margin-left:36pt;text-indent:-36pt". A first line may not start left of
 * the page margin, where a browser would clip it.
 */
function indentStyle(block: ParagraphBlock): string {
	const left = Math.max(0, block.left);
	const first = Math.max(-left, block.first);
	const parts: string[] = [];
	if (left > 0) parts.push(`margin-left:${twipsToPt(left)}`);
	if (block.right > 0) parts.push(`margin-right:${twipsToPt(block.right)}`);
	if (first !== 0) parts.push(`text-indent:${twipsToPt(first)}`);
	return parts.join(';');
}

/**
 * The indent of a picture's paragraph: where its one line starts, as a left margin. A figure
 * is written back with a left indent only, and a first-line indent on it would be passed on to
 * its caption.
 */
function figureIndentStyle(block: ParagraphBlock): string {
	const left = Math.max(0, block.left);
	const start = left + Math.max(-left, block.first);
	return start > 0 ? `margin-left:${twipsToPt(start)}` : '';
}

/**
 * A paragraph's HTML without the spaces at its ends, which a browser does not show. Only those:
 * a non-breaking space or an em space there is text someone put there, and is kept.
 */
function trimSpaces(html: string): string {
	return html.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');
}

function escapeText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Text as an attribute value in double quotes. */
function escapeAttribute(text: string): string {
	return escapeText(text).replace(/"/g, '&quot;');
}

function sameFormat(a: RunFormat, b: RunFormat): boolean {
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.super_ === b.super_ &&
		a.sub === b.sub &&
		a.fontSize === b.fontSize &&
		sameFormatButSize(a, b)
	);
}

function sameFormatButSize(a: RunFormat, b: RunFormat): boolean {
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.super_ === b.super_ &&
		a.sub === b.sub &&
		a.color === b.color &&
		a.background === b.background &&
		a.mono === b.mono &&
		a.link === b.link
	);
}

/** How a paragraph's pieces are written out, where it is not as an ordinary paragraph. */
interface RenderOptions {
	/** A font size, in half-points, the element around the text already gives it. */
	dropSize?: number;
	/** The element around the text is bold already (a heading). */
	dropBold?: boolean;
	/** Inside <pre>: no <code>, a line break is a newline and a tab is a tab. */
	pre?: boolean;
}

export function rtfToHtml(rtfString: string, options: RtfReadOptions = {}): string {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_RTF_BYTES;
	if (maxBytes > 0 && rtfString.length > maxBytes) {
		throw new RangeError(
			`RTF document is too large to read: ${rtfString.length} bytes, and the limit is ${maxBytes}`
		);
	}

	const tokens = tokenize(rtfString);
	const tree = buildTree(tokens);

	let colorTable: string[] = [''];
	let monoFonts = new Set<number>();
	let defaultFont = 0;

	const blocks: Block[] = [];

	// The paragraph being read
	let runs: Run[] = [];
	let marker: ListMarker | null = null;
	let paragraphHasListMarker = false;
	let paragraphIsCaption = false;

	// Paragraph alignment (reset by \pard, affects cells and paragraphs)
	let currentAlign = 'left';

	// Table state
	let tableRows: TableRow[] = [];
	let currentRowCells: RowCell[] = [];
	let currentRowDefs: CellDef[] = [];
	/** The definition of the row before, which a row with no \trowd of its own repeats. */
	let lastRowDefs: CellDef[] = [];
	let pendingDef = newCellDef();
	let pendingBottomBorder = false; // set by \clbrdrb, confirmed by a real border type
	let inTableCell = false;
	/** \par seen in a table cell since its last text: line breaks owed if more text follows. */
	let cellBreaks = 0;
	/** \nestcell seen: a tab is owed if more text follows on the line. */
	let nestTabPending = false;

	function newCellDef(): CellDef {
		return { right: 0, header: false, vmgf: false, vmrg: false, hmgf: false, hmrg: false };
	}

	// First pass: extract color table and font table from the root group
	const rootGroup = tree.children[0]?.type === 'group' ? (tree.children[0] as RtfGroup) : tree;

	for (let i = 0; i < rootGroup.children.length; i++) {
		const child = rootGroup.children[i];
		if (child.type === 'group') {
			const firstControl = child.children.find((n) => n.type === 'control') as RtfControl | undefined;
			if (firstControl?.word === 'colortbl') {
				colorTable = parseColorTable(child);
			} else if (firstControl?.word === 'fonttbl') {
				monoFonts = monospaceFonts(child);
			}
		} else if (child.type === 'control' && child.word === 'deff' && child.param != null) {
			defaultFont = child.param;
		}
	}

	// In a document whose own font is monospace, code cannot be told from text by its font.
	const documentIsMono = monoFonts.has(defaultFont);
	const linkColor = `rgb(${LINK_COLOR.r},${LINK_COLOR.g},${LINK_COLOR.b})`;

	// The screen's body size, in half-points. It is given, not guessed from the
	// document: guessing misread short documents and ones set below 12 pt.
	const bodySize = normalizeFontSize(options.fontSize) * 2;
	/** The size the writer sets a code block in, in half-points. */
	const preSize = Math.round(bodySize * PRE_SCALE);

	// State stack for nested groups
	function defaultState(): RenderState {
		return {
			bold: false,
			italic: false,
			underline: false,
			strike: false,
			super_: false,
			sub: false,
			fontSize: 24, // 12pt default
			colorIndex: 0,
			highlightIndex: 0,
			fontIndex: defaultFont,
			ucSkip: 1,
			inList: false,
			link: '',
			leftIndent: 0,
			rightIndent: 0,
			firstLineIndent: 0,
		};
	}

	const stateStack: RenderState[] = [defaultState()];

	function currentState(): RenderState {
		return stateStack[stateStack.length - 1];
	}

	function cloneState(): RenderState {
		return { ...currentState() };
	}

	function formatOf(state: RenderState): RunFormat {
		let color = state.colorIndex > 0 && state.colorIndex < colorTable.length ? colorTable[state.colorIndex] : '';
		// Black is the color text has anyway, and a link's own color is the <a>'s to give.
		if (color === 'rgb(0,0,0)' || (state.link && color === linkColor)) color = '';
		return {
			bold: state.bold,
			italic: state.italic,
			// A link is underlined as a link; the writer adds that underline itself.
			underline: state.underline && !state.link,
			strike: state.strike,
			super_: state.super_,
			sub: state.sub,
			fontSize: state.fontSize || bodySize,
			color,
			background: (state.highlightIndex > 0 && HIGHLIGHT_COLORS[state.highlightIndex]) || '',
			mono: !documentIsMono && monoFonts.has(state.fontIndex),
			link: state.link
		};
	}

	// ── Writing a paragraph's pieces as HTML ──

	function renderText(text: string, fmt: RunFormat, opts: RenderOptions): string {
		if (!text) return '';
		// A size on spaces alone is not shown and would be read as the
		// paragraph's size, so it is dropped. Underline, strikethrough and
		// highlight are kept: an underlined blank is a signature line.
		const onlySpaces = ONLY_SPACES.test(text);

		let result = escapeText(text);

		const styles: string[] = [];
		if (fmt.color) styles.push(`color:${fmt.color}`);
		if (fmt.background) styles.push(`background-color:${fmt.background}`);
		if (!onlySpaces && fmt.fontSize !== bodySize && fmt.fontSize !== opts.dropSize) {
			styles.push(`font-size:${fmt.fontSize / 2}pt`);
		}
		if (styles.length > 0) result = `<span style="${styles.join(';')}">${result}</span>`;

		if (fmt.mono && !opts.pre) result = `<code>${result}</code>`;
		if (fmt.bold && !opts.dropBold) result = `<strong>${result}</strong>`;
		if (fmt.italic) result = `<em>${result}</em>`;
		if (fmt.underline) result = `<u>${result}</u>`;
		if (fmt.strike) result = `<s>${result}</s>`;
		if (fmt.super_) result = `<sup>${result}</sup>`;
		if (fmt.sub) result = `<sub>${result}</sub>`;

		return result;
	}

	function renderRun(run: Run, opts: RenderOptions): string {
		if (run.type === 'text') return renderText(run.text, run.fmt, opts);
		if (opts.pre && run.kind === 'br') return '\n';
		if (opts.pre && run.kind === 'tab') return '\t';
		return run.html;
	}

	/** The opening tag of a link. The address has been through linkTarget; a web page opens in a tab of its own. */
	function linkOpen(href: string): string {
		const newTab = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
		return `<a href="${escapeAttribute(href)}"${newTab}>`;
	}

	function renderRuns(list: Run[], opts: RenderOptions = {}): string {
		// A line break that ends the paragraph (\line\par) leaves an empty last line. A browser
		// shows nothing for a <br> at the end of a block, so that one is written twice; the
		// writer, which drops a closing <br>, then sends the one \line back.
		let closing = -1;
		if (!opts.pre) {
			let k = list.length - 1;
			while (k >= 0 && list[k].type === 'text' && ONLY_SPACES.test((list[k] as { text: string }).text)) k--;
			if (k >= 0 && list[k].type === 'html' && (list[k] as { kind: string }).kind === 'br') closing = k;
		}
		const render = (i: number) => renderRun(list[i], opts) + (i === closing ? '<br>' : '');

		let out = '';
		for (let i = 0; i < list.length; ) {
			const link = list[i].fmt.link;
			if (!link) {
				out += render(i++);
				continue;
			}
			// Every piece in a row that carries the same address is one link.
			let inner = '';
			while (i < list.length && list[i].fmt.link === link) inner += render(i++);
			out += `${linkOpen(link)}${inner}</a>`;
		}
		return out;
	}

	// ── Collecting a paragraph ──

	/** Half of a surrogate pair read from \uN, waiting for the \uN that completes the character. */
	let pendingHighSurrogate = 0;

	function pushText(text: string, state: RenderState): void {
		if (!text) return;
		const fmt = formatOf(state);
		const last = runs[runs.length - 1];
		if (last && last.type === 'text') {
			// Text in the same formatting as the text before it is one piece: "caf" and the
			// \'e9 after it, or the two \u halves of an emoji, are not two elements.
			if (sameFormat(last.fmt, fmt)) {
				last.text += text;
				return;
			}
			// A size does not show on spaces, so spaces go with the text beside them
			// whatever size they were set in.
			if (sameFormatButSize(last.fmt, fmt)) {
				if (ONLY_SPACES.test(text)) {
					last.text += text;
					return;
				}
				if (ONLY_SPACES.test(last.text)) {
					last.text += text;
					last.fmt = fmt;
					return;
				}
			}
		}
		runs.push({ type: 'text', text, fmt });
	}

	/** What is owed before the next piece of a paragraph: see cellBreaks and nestTabPending. */
	function beforeContent(state: RenderState): void {
		if (pendingHighSurrogate) {
			// A lone half of a pair is no character.
			pendingHighSurrogate = 0;
			pushText('\ufffd', state);
		}
		if (cellBreaks > 0) {
			const count = cellBreaks;
			cellBreaks = 0;
			if (inTableCell) {
				// A paragraph mark inside a cell: the cell's text goes on, on a new line.
				for (let k = 0; k < count; k++) runs.push({ type: 'html', kind: 'br', html: '<br>', fmt: formatOf(state) });
			} else {
				// \pard has left the table without a \cell: what was read is a paragraph.
				for (let k = 0; k < count; k++) flushParagraph();
			}
		}
		if (nestTabPending) {
			nestTabPending = false;
			runs.push({ type: 'html', kind: 'tab', html: TAB_HTML, fmt: formatOf(state) });
		}
	}

	function appendText(text: string, state: RenderState): void {
		if (!text) return;
		beforeContent(state);
		pushText(text, state);
	}

	function appendHtml(kind: 'br' | 'tab' | 'gap' | 'img', html: string, state: RenderState): void {
		beforeContent(state);
		runs.push({ type: 'html', kind, html, fmt: formatOf(state) });
	}

	/** The text of the line being read, back to the last line break, if text is all it holds. */
	function lineText(): string | null {
		let text = '';
		for (let i = runs.length - 1; i >= 0; i--) {
			const run = runs[i];
			if (run.type === 'html' && run.kind === 'br') break;
			if (run.type !== 'text') return null;
			text = run.text + text;
		}
		return text;
	}

	function appendTab(state: RenderState): void {
		beforeContent(state);
		// A real tab, in the shape the editor's Tab key inserts, so it shows as
		// one and is written back as \tab (an em space came back as 膕).
		// After a list marker ("\bullet\tab", "1.\tab") the gap stays an em
		// space where the line is read as a plain one: a full tab there is too wide.
		const lead = lineText();
		// Only a marker that opens the paragraph can make it a list item.
		const opensParagraph = marker === null && runs.every((r) => r.type === 'text');
		const listed = lead != null ? lead.match(LIST_MARKER) : null;
		if (listed) {
			runs.push({ type: 'html', kind: 'gap', html: '&emsp;', fmt: formatOf(state) });
			// (A number too long to be an item's number is text.)
			if (opensParagraph && (!listed[1] || listed[1].length <= MAX_LIST_NUMBER_DIGITS)) {
				marker = listed[1]
					? { kind: 'ol', number: Number(listed[1]), end: runs.length }
					: { kind: 'ul', number: 0, end: runs.length };
			}
			return;
		}
		runs.push({ type: 'html', kind: 'tab', html: TAB_HTML, fmt: formatOf(state) });
		// Word's bullet, inside {\listtext …} or {\pntext …}.
		if (opensParagraph && lead != null && state.inList && SYMBOL_BULLET.test(lead)) {
			marker = { kind: 'ul', number: 0, end: runs.length };
		}
	}

	// ── Tables ──

	/** Column edges closer than this, in twips (2 px), are the same edge. */
	const EDGE_TOLERANCE = 30;

	function flushTable() {
		if (tableRows.length === 0) return;
		const rows = tableRows;
		tableRows = [];

		// Each row as its cells with their right edges. A cell with no \cellx of its own takes
		// an edge past the last one, so its text is kept; a cell merged to the left (\clmrg)
		// joins the cell before it.
		interface Placed {
			html: string;
			align: string;
			def: CellDef;
			left: number;
			right: number;
			start: number;
			end: number;
			rowspan: number;
			merged: boolean;
		}
		const placedRows: Placed[][] = rows.map((row) => {
			const placed: Placed[] = [];
			let prevRight = 0;
			let step = 0;
			for (let ci = 0; ci < row.cells.length; ci++) {
				const def = row.defs[ci] ?? { ...newCellDef(), right: prevRight + (step || 1440) };
				const cell = row.cells[ci];
				const last = placed[placed.length - 1];
				if (def.hmrg && last) {
					last.right = Math.max(last.right, def.right);
					if (cell.html) last.html += (last.html ? ' ' : '') + cell.html;
				} else {
					placed.push({
						html: cell.html, align: cell.align, def,
						left: prevRight, right: Math.max(def.right, prevRight),
						start: 0, end: 0, rowspan: 1, merged: false
					});
				}
				step = Math.max(1, def.right - prevRight);
				prevRight = Math.max(def.right, prevRight);
			}
			return placed;
		});

		// One set of columns for the table: every edge any row has. A cell that crosses edges
		// of other rows spans those columns.
		const allEdges = placedRows.flatMap((row) => row.map((c) => c.right)).sort((a, b) => a - b);
		const edges: number[] = [];
		for (const e of allEdges) {
			if (edges.length === 0 || e - edges[edges.length - 1] > EDGE_TOLERANCE) edges.push(e);
		}
		const columnOf = (right: number): number => {
			let best = 0;
			for (let k = 0; k < edges.length; k++) {
				if (Math.abs(edges[k] - right) < Math.abs(edges[best] - right)) best = k;
			}
			return best;
		};
		for (const row of placedRows) {
			let start = 0;
			for (const cell of row) {
				cell.start = start;
				cell.end = Math.max(start, columnOf(cell.right));
				start = cell.end + 1;
			}
		}

		// A vertical merge: the cell marked \clvmgf takes in each \clvmrg cell under it, row
		// after row. A \clvmrg cell with nothing above it to join stays an ordinary cell.
		for (let r = 0; r < placedRows.length; r++) {
			for (const cell of placedRows[r]) {
				if (!cell.def.vmgf || cell.merged) continue;
				for (let below = r + 1; below < placedRows.length; below++) {
					const under = placedRows[below].find((c) => c.start === cell.start && c.def.vmrg && !c.merged);
					if (!under) break;
					under.merged = true;
					cell.rowspan++;
					// A merged cell is empty; if a damaged file has text there, it is kept.
					if (under.html) cell.html += (cell.html ? '<br>' : '') + under.html;
				}
			}
		}

		const total = edges[edges.length - 1] || 1;
		// A cell's width is the difference of where it ends and where it starts, each as a
		// share of the table rounded to a hundredth of a percent. Written that way the widths
		// of a row add up exactly, and the writer puts every column edge back where it was;
		// each width rounded by itself moved an edge a few twips on every save.
		const shareAt = (edge: number) => Math.round((edge / total) * 10000) / 100;
		let html = '<table style="border-collapse:collapse;width:100%;margin:4px 0">';
		for (const row of placedRows) {
			html += '<tr>';
			for (const cell of row) {
				if (cell.merged) continue;
				const tag = cell.def.header ? 'th' : 'td';
				const pct = (shareAt(cell.right) - shareAt(cell.left)).toFixed(2).replace(/0$/, '');
				const alignStyle = cell.align !== 'left' ? `;text-align:${cell.align}` : '';
				const style = cell.def.header
					? `border-bottom:1px solid;padding:2px 6px;text-align:${cell.align};width:${pct}%`
					: `padding:2px 6px;width:${pct}%${alignStyle}`;
				const colspan = cell.end > cell.start ? ` colspan="${cell.end - cell.start + 1}"` : '';
				const rowspan = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
				html += `<${tag}${colspan}${rowspan} style="${style}">${cell.html}</${tag}>`;
			}
			html += '</tr>';
		}
		html += '</table>';
		blocks.push({ kind: 'table', html });
	}

	function flushParagraph() {
		const state = currentState();
		if (pendingHighSurrogate) {
			pendingHighSurrogate = 0;
			pushText('\ufffd', state);
		}
		flushTable();
		// A paragraph that held a list marker and nothing else is no line of its own.
		if (!paragraphHasListMarker || trimSpaces(renderRuns(runs))) {
			blocks.push({
				kind: 'paragraph',
				runs,
				align: currentAlign,
				left: state.leftIndent,
				right: state.rightIndent,
				first: state.firstLineIndent,
				caption: paragraphIsCaption,
				marker,
				inTable: inTableCell
			});
		}
		runs = [];
		marker = null;
		paragraphHasListMarker = false;
		paragraphIsCaption = false;
		currentAlign = 'left';
		nestTabPending = false;
	}

	let pendingUnicodeSkip = 0;

	// ── Walking the document ──
	// With a stack of its own rather than a call per group: a document nested tens of
	// thousands of groups deep, which a damaged or hostile file can be, overflowed the call stack.

	interface Frame {
		nodes: RtfNode[];
		index: number;
		/** Whether leaving this group ends a formatting state. */
		scoped: boolean;
	}
	const frames: Frame[] = [{ nodes: rootGroup.children, index: 0, scoped: false }];

	const enterGroup = (group: RtfGroup, state: RenderState) => {
		stateStack.push(state);
		frames.push({ nodes: group.children, index: 0, scoped: true });
	};

	while (frames.length > 0) {
		const frame = frames[frames.length - 1];
		if (frame.index >= frame.nodes.length) {
			frames.pop();
			if (frame.scoped) stateStack.pop();
			continue;
		}
		const node = frame.nodes[frame.index++];

		if (node.type === 'group') {
			const firstCtrl = node.children.find((n) => n.type === 'control') as RtfControl | undefined;

			if (firstCtrl?.word === 'pict') {
				const img = renderPicture(node);
				if (img) appendHtml('img', img, currentState());
				continue;
			}

			if (firstCtrl && destinationWords.has(firstCtrl.word)) {
				continue;
			}

			const hasStarDest = node.children.length >= 2 &&
				node.children[0].type === 'control' && (node.children[0] as RtfControl).word === '*';
			if (hasStarDest) {
				const dest = node.children.find(
					(n) => n.type === 'control' && n.word !== '*'
				) as RtfControl | undefined;

				// Word wraps pictures in {\*\shppict{\pict …}} — descend into it
				// rather than dropping the picture with the rest of the ignorables.
				if (dest?.word === 'shppict') {
					enterGroup(node, cloneState());
				} else if (dest?.word === 'inkcap') {
					// Marks the paragraph that follows as a picture caption.
					paragraphIsCaption = true;
				} else if (dest?.word === 'nesttableprops') {
					// Word ends each row of a table inside a cell with this group, which holds
					// the row's definition and its \nestrow.
					nestTabPending = false;
					cellBreaks++;
				}
				continue;
			}

			const state = cloneState();
			// {\field{\*\fldinst HYPERLINK "…"}{\fldrslt text}}: the text is a link, if the
			// address is one the writer would write.
			if (firstCtrl?.word === 'field') {
				const href = fieldLink(node);
				if (href) state.link = href;
			}
			enterGroup(node, state);
		} else if (node.type === 'control') {
			const state = currentState();
			const w = node.word;
			const p = node.param;

			switch (w) {
				case 'b':
					state.bold = p !== 0;
					break;
				case 'i':
					state.italic = p !== 0;
					break;
				case 'ul':
				case 'ulnone':
					state.underline = w === 'ul' && p !== 0;
					break;
				case 'strike':
					state.strike = p !== 0;
					break;
				case 'super':
					state.super_ = true;
					state.sub = false;
					break;
				case 'sub':
					state.sub = true;
					state.super_ = false;
					break;
				case 'nosupersub':
					state.super_ = false;
					state.sub = false;
					break;
				case 'fs':
					if (p != null) state.fontSize = p;
					break;
				case 'cf':
					if (p != null) state.colorIndex = p;
					break;
				case 'cb':
					break; // \cb not rendered on import
				case 'highlight':
					if (p != null) state.highlightIndex = p;
					break;
				case 'f':
					if (p != null) state.fontIndex = p;
					break;
				case 'ql':
					currentAlign = 'left';
					break;
				case 'qr':
					currentAlign = 'right';
					break;
				case 'qc':
					currentAlign = 'center';
					break;
				case 'qj':
					currentAlign = 'justify';
					break;
				case 'li':
					state.leftIndent = p ?? 0;
					break;
				case 'ri':
					state.rightIndent = p ?? 0;
					break;
				case 'fi':
					state.firstLineIndent = p ?? 0;
					break;
				case 'par':
				case 'sect':
					// \sect ends a section, and with it the paragraph: "A\sect B" is two lines.
					if (inTableCell) {
						cellBreaks++;
					} else {
						// Paragraph marks from a cell that \pard has since left end paragraphs too.
						for (; cellBreaks > 0; cellBreaks--) flushParagraph();
						flushParagraph();
					}
					break;
				case 'trowd':
					// A row's definition, not its start: Word writes the definition before the
					// cells and again before \row, so the cells read so far are kept.
					currentRowDefs = [];
					pendingDef = newCellDef();
					pendingBottomBorder = false;
					break;
				case 'trgaph':
				case 'trkeep':
				case 'trleft':
				case 'trhdr':
				case 'clbrdrr':
				case 'clbrdrl':
				case 'clbrdrt':
					pendingBottomBorder = false;
					break; // table formatting, ignored
				case 'clbrdrb':
					pendingBottomBorder = true;
					break;
				case 'brdrnone':
				case 'brdrnil':
					pendingBottomBorder = false;
					break;
				case 'brdrs':
				case 'brdrdb':
				case 'brdrth':
				case 'brdrdot':
				case 'brdrdash':
					if (pendingBottomBorder) pendingDef.header = true;
					pendingBottomBorder = false;
					break;
				case 'clvmgf':
					pendingDef.vmgf = true;
					break;
				case 'clvmrg':
					pendingDef.vmrg = true;
					break;
				case 'clmgf':
					pendingDef.hmgf = true;
					break;
				case 'clmrg':
					pendingDef.hmrg = true;
					break;
				case 'cellx':
					if (p != null) {
						pendingDef.right = p;
						currentRowDefs.push(pendingDef);
					}
					pendingDef = newCellDef();
					pendingBottomBorder = false;
					break;
				case 'intbl':
					inTableCell = true;
					break;
				case 'cell':
					if (pendingHighSurrogate) {
						pendingHighSurrogate = 0;
						pushText('\ufffd', state);
					}
					currentRowCells.push({ html: trimSpaces(renderRuns(runs)), align: currentAlign });
					runs = [];
					marker = null;
					currentAlign = 'left';
					// The paragraph mark that ends a cell's last paragraph adds no line.
					cellBreaks = 0;
					nestTabPending = false;
					break;
				case 'nestcell':
					// A table inside a cell is read as lines of text in that cell: its cells a
					// tab apart, each of its rows a line. The writer sends one the same way.
					nestTabPending = true;
					break;
				case 'nestrow':
					nestTabPending = false;
					cellBreaks++;
					break;
				case 'row': {
					// Text after the row's last \cell is a cell that was not closed, not the
					// start of the paragraph after the table.
					if (trimSpaces(renderRuns(runs))) {
						currentRowCells.push({ html: trimSpaces(renderRuns(runs)), align: currentAlign });
						runs = [];
						marker = null;
					}
					// A row with no definition of its own repeats the one before it.
					const defs = currentRowDefs.length > 0 ? currentRowDefs : lastRowDefs;
					tableRows.push({ cells: currentRowCells, defs });
					lastRowDefs = defs;
					currentRowCells = [];
					currentRowDefs = [];
					pendingDef = newCellDef();
					inTableCell = false;
					cellBreaks = 0;
					nestTabPending = false;
					// The cell's indents end with the table, in whichever group set them:
					// \row may sit in a group of its own ({\row}).
					stateStack.forEach(resetIndents);
					break;
				}
				case 'pard':
					// \pard resets the paragraph, not the characters: bold, italic, underline
					// and strikethrough carry on until \plain or their own \b0. Word relies on it.
					currentAlign = 'left';
					resetIndents(state);
					// Being in a table is a paragraph property too. Without this, one \intbl with
					// no \row made a single cell of the rest of the document. The marker group
					// of a list item ({\listtext\pard …}) resets only itself. Between a row's
					// first \cell and its \row the table goes on whatever \pard says: a writer
					// that leaves \intbl out there still means the next cell.
					if (!state.inList && currentRowCells.length === 0) inTableCell = false;
					break;
				case 'line':
					appendHtml('br', '<br>', state);
					break;
				case 'tab':
					appendTab(state);
					break;
				case 'pntext':
				case 'listtext':
					state.inList = true;
					paragraphHasListMarker = true;
					break;
				case 'u': {
					if (p != null) {
						pendingUnicodeSkip = state.ucSkip ?? 1;
						// \uN is a signed 16-bit number; some writers give the code point itself.
						const code = p < 0 ? p + 65536 : p;
						if (code <= 0 || code > 0x10ffff) break; // no character: a NUL, or out of range
						if (code >= 0xd800 && code <= 0xdbff) {
							// The first half of a pair: one character with the \u that follows.
							if (pendingHighSurrogate) appendText('\ufffd', state);
							pendingHighSurrogate = code;
						} else if (code >= 0xdc00 && code <= 0xdfff) {
							const high = pendingHighSurrogate;
							pendingHighSurrogate = 0;
							appendText(high ? String.fromCharCode(high, code) : '\ufffd', state);
						} else {
							appendText(String.fromCodePoint(code), state);
						}
					}
					break;
				}
				case 'uc':
					if (p != null) {
						state.ucSkip = Math.max(0, p);
					}
					break;
				case 'plain':
					state.bold = false;
					state.italic = false;
					state.underline = false;
					state.strike = false;
					state.super_ = false;
					state.sub = false;
					state.fontSize = 24;
					state.colorIndex = 0;
					state.highlightIndex = 0;
					state.fontIndex = defaultFont;
					break;
				case 'page':
					// A page break. On screen it is a rule; the writer sends it back as \page.
					if (inTableCell) {
						cellBreaks++;
						break;
					}
					for (; cellBreaks > 0; cellBreaks--) flushParagraph();
					if (runs.length > 0) flushParagraph();
					flushTable();
					blocks.push({ kind: 'rule', pageBreak: true });
					break;
				case 'emspace':
				case 'enspace':
					appendHtml('gap', '&emsp;', state);
					break;
				case 'emdash':
					appendText('\u2014', state);
					break;
				case 'endash':
					appendText('\u2013', state);
					break;
				case 'lquote':
					appendText('\u2018', state);
					break;
				case 'rquote':
					appendText('\u2019', state);
					break;
				case 'ldblquote':
					appendText('\u201C', state);
					break;
				case 'rdblquote':
					appendText('\u201D', state);
					break;
				case 'bullet':
					appendText('\u2022', state);
					break;
				default:
					break;
			}
		} else {
			const state = currentState();
			if (pendingUnicodeSkip > 0) {
				// The characters after \uN that stand in for it where Unicode is not read.
				if (node.hex) {
					pendingUnicodeSkip--;
					continue;
				}
				const skipCount = Math.min(pendingUnicodeSkip, node.value.length);
				pendingUnicodeSkip -= skipCount;
				appendText(node.value.slice(skipCount), state);
				continue;
			}
			appendText(node.value, state);
		}
	}

	if (pendingHighSurrogate) {
		pendingHighSurrogate = 0;
		pushText('\ufffd', currentState());
	}
	// A row the file ends in the middle of, with cells and no \row, is still a row.
	if (currentRowCells.length > 0) {
		tableRows.push({ cells: currentRowCells, defs: currentRowDefs.length > 0 ? currentRowDefs : lastRowDefs });
		currentRowCells = [];
		inTableCell = false;
	}
	flushTable(); // flush any trailing table rows
	// Only flush if there's actually pending content — the final \par in most RTF
	// files already flushed the last paragraph, so an unconditional call here
	// would push a spurious empty paragraph that becomes a trailing <p><br></p>.
	if (runs.length > 0) {
		flushParagraph();
	}

	// ── Building the HTML ──

	/** Each block as an ordinary paragraph's content: what it is unless it turns out to be more. */
	const plain = blocks.map((b) => (b.kind === 'paragraph' ? trimSpaces(renderRuns(b.runs)) : b.kind === 'table' ? b.html : '<hr>'));

	/**
	 * A list item as the writer sends one: a bullet or "N.", a tab, and a paragraph that hangs by
	 * 360 twips with nothing else set. Only that shape is rebuilt as <ul> or <ol>, because only
	 * that shape is written back the same. A line someone typed with a dash or a bullet, a list
	 * hung by another distance, lettered or centered, stays the paragraph it is, marker and all.
	 */
	interface ListItem {
		kind: 'ul' | 'ol';
		number: number;
		left: number;
		html: string;
	}
	const items: (ListItem | null)[] = blocks.map((b) => {
		if (b.kind !== 'paragraph' || !b.marker || b.inTable || b.caption) return null;
		if (b.first !== -LIST_HANG || b.left < LIST_HANG || b.right !== 0 || b.align !== 'left') return null;
		return {
			kind: b.marker.kind,
			number: b.marker.number,
			left: b.left,
			html: trimSpaces(renderRuns(b.runs.slice(b.marker.end)))
		};
	});

	/** Consecutive list items as nested <ul> and <ol>, one string per list at the top level. */
	function renderLists(list: ListItem[]): string[] {
		const out: string[] = [];
		let html = '';
		const open: { kind: 'ul' | 'ol'; left: number; next: number }[] = [];
		const closeList = () => {
			const done = open.pop()!;
			html += `</li></${done.kind}>`;
			if (open.length === 0) {
				out.push(html);
				html = '';
			}
		};
		for (const item of list) {
			// A smaller indent ends the lists nested deeper than it.
			while (open.length > 0 && item.left < open[open.length - 1].left) closeList();
			const top = open[open.length - 1];
			if (top && item.left === top.left && item.kind === top.kind && (item.kind === 'ul' || item.number === top.next)) {
				html += '</li><li>';
				top.next = item.number + 1;
			} else {
				// A change from bullets to numbers, or a number out of sequence, is a new list
				// in the same place.
				if (top && item.left === top.left) closeList();
				const parent = open[open.length - 1];
				// What the indent adds to the half inch a list level has by itself.
				const margin = item.left - (parent ? parent.left : 0) - LIST_STEP;
				const style = margin !== 0 ? ` style="margin-left:${twipsToPt(margin)}"` : '';
				const start = item.kind === 'ol' && item.number !== 1 ? ` start="${item.number}"` : '';
				html += `<${item.kind}${start}${style}><li>`;
				open.push({ kind: item.kind, left: item.left, next: item.number + 1 });
			}
			html += item.html || '<br>';
		}
		while (open.length > 0) closeList();
		return out;
	}

	/** Whether a paragraph is a heading or a code block, from the formatting of all its text. */
	function classify(b: ParagraphBlock): { tag: 'h1' | 'h2' | 'h3'; options: RenderOptions } | { tag: 'pre' } | null {
		const visible = b.runs.filter((r): r is Extract<Run, { type: 'text' }> => r.type === 'text' && !ONLY_SPACES.test(r.text));
		if (visible.length === 0 || b.runs.some((r) => r.type === 'html' && r.kind === 'img')) return null;
		// The size must be the whole paragraph's: one large word does not make a heading.
		const size = visible[0].fmt.fontSize;
		if (visible.some((r) => r.fmt.fontSize !== size)) return null;
		if (size === preSize && visible.every((r) => r.fmt.mono)) return { tag: 'pre' };
		if (size === bodySize) return null;
		const allBold = visible.every((r) => r.fmt.bold);
		// At the default 12 pt, size alone makes a heading, as it always has. At
		// another screen size, ordinary 12 pt text can be a step above the body,
		// so a heading must also be bold, as every heading the writer emits is.
		if (bodySize !== 24 && !allBold) return null;
		// Compared in half-points, rounded the way the writer rounds them, so
		// a heading written at any body size is read back as the same level.
		for (const tag of ['h1', 'h2', 'h3'] as const) {
			const nominal = Math.round(bodySize * HEADING_SCALE[tag]);
			// The heading's own size and bold are the element's: only a size that differs
			// from it is kept inside.
			if (size >= nominal) return { tag, options: { dropSize: nominal, dropBold: true } };
		}
		return null;
	}

	const rendered: string[] = [];
	// A typed line that starts with a dash or a bullet; a rebuilt list item is not one.
	const isListLine = (i: number) =>
		i >= 0 && i < plain.length && !items[i] && /^[-\u2022]/.test(plain[i].replace(/^&emsp;+/g, ''));

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const trimmed = plain[i];

		if (block.kind === 'rule') {
			rendered.push(block.pageBreak ? '<hr style="break-after:page">' : '<hr>');
			continue;
		}
		if (block.kind === 'table') {
			rendered.push(trimmed);
			continue;
		}

		if (items[i]) {
			const list: ListItem[] = [];
			for (; i < blocks.length && items[i]; i++) list.push(items[i]!);
			i--;
			rendered.push(...renderLists(list));
			continue;
		}

		const align = block.align;
		// The paragraph's style attribute: its alignment, then its indents.
		const blockStyle = [align !== 'left' ? `text-align:${align}` : '', block.inTable ? '' : indentStyle(block)]
			.filter(Boolean)
			.join(';');
		const styleAttr = blockStyle ? ` style="${blockStyle}"` : '';

		if (!trimmed) {
			if (isListLine(i - 1) && isListLine(i + 1)) {
				continue;
			}
			const last = rendered[rendered.length - 1];
			if (last === '<p><br></p>') {
				continue;
			}
			rendered.push('<p><br></p>');
			continue;
		}

		// The rule the writer sends for <hr>: a centered line of em dashes, and nothing else.
		if (
			align === 'center' &&
			block.runs.every((r) => r.type === 'text' && !r.fmt.bold && !r.fmt.italic && !r.fmt.underline && !r.fmt.strike && !r.fmt.link) &&
			block.runs.map((r) => (r.type === 'text' ? r.text : '')).join('') === RULE_DASHES
		) {
			rendered.push('<hr>');
			continue;
		}

		// A paragraph tagged by {\*\inkcap} is the description of the figure above it.
		if (block.caption) {
			const last = rendered.length - 1;
			if (last >= 0 && rendered[last].startsWith('<figure') && !rendered[last].includes('<figcaption')) {
				rendered[last] = rendered[last].replace(
					'</figure>',
					`<figcaption>${stripWrappingEm(trimmed)}</figcaption></figure>`
				);
				continue;
			}
		}

		// A paragraph holding nothing but pictures becomes a figure, so it can carry
		// a caption and be aligned/resized as a unit in the editor.
		if (IMAGE_ONLY_PARAGRAPH.test(trimmed)) {
			const figureStyle = [align !== 'left' ? `text-align:${align}` : '', block.inTable ? '' : figureIndentStyle(block)]
				.filter(Boolean)
				.join(';');
			rendered.push(`<figure${figureStyle ? ` style="${figureStyle}"` : ''}>${trimmed}</figure>`);
			continue;
		}

		const kind = classify(block);
		if (kind?.tag === 'pre') {
			// A code block keeps its spaces, and is written back with a left indent only.
			const left = block.inTable ? 0 : Math.max(0, block.left);
			const preStyle = left > 0 ? ` style="margin-left:${twipsToPt(left)}"` : '';
			rendered.push(`<pre${preStyle}>${renderRuns(block.runs, { pre: true, dropSize: preSize })}</pre>`);
			continue;
		}
		if (kind) {
			// A heading is bold throughout, on screen and when it is written again, so its
			// pieces are joined as if they all were: what differed only in bold is one piece.
			const bold: Run[] = [];
			for (const run of block.runs) {
				const fmt = { ...run.fmt, bold: true };
				const last = bold[bold.length - 1];
				if (run.type === 'text' && last?.type === 'text' && sameFormat(last.fmt, fmt)) last.text += run.text;
				else bold.push({ ...run, fmt });
			}
			rendered.push(`<${kind.tag}${styleAttr}>${trimSpaces(renderRuns(bold, kind.options))}</${kind.tag}>`);
			continue;
		}
		rendered.push(`<p${styleAttr}>${trimmed}</p>`);
	}

	const output = rendered.join('\n');

	return output || '<p></p>';
}

/** Captions are written as italic text; <figcaption> supplies its own styling. */
function stripWrappingEm(html: string): string {
	return html.replace(/^<em>([\s\S]*)<\/em>$/, '$1');
}

export function readRtfFile(file: File, options: RtfReadOptions = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const maxBytes = options.maxBytes ?? DEFAULT_MAX_RTF_BYTES;
		// Refused before it is read: reading is what takes the memory.
		if (maxBytes > 0 && file.size > maxBytes) {
			const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
			reject(new Error(`This file is too large to import: ${mb(file.size)}, and the limit is ${mb(maxBytes)}`));
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const text = reader.result as string;
				const html = rtfToHtml(text, options);
				resolve(html);
			} catch (err) {
				reject(new Error(`Failed to parse RTF: ${(err as Error).message}`));
			}
		};
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file, 'ascii');
	});
}
