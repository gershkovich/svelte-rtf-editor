/**
 * RTF to HTML converter
 *
 * Parses RTF control words and groups into an HTML string.
 * Supports: bold, italic, underline, strikethrough, super/subscript,
 * font size, foreground color (\cf), highlight background color (\highlight),
 * color table, font table, paragraphs, bullet/numbered lists, tables,
 * embedded pictures (\pict PNG/JPEG blips, with captions),
 * Unicode characters, hex escapes, and nested groups.
 *
 * \cb (character background) is silently ignored on import.
 */

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
}

type RtfNode = RtfGroup | RtfControl | RtfText;

type Token =
	| { type: 'open' }
	| { type: 'close' }
	| { type: 'control'; word: string; param: number | null }
	| { type: 'text'; value: string };

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

			// Hex escape \'xx
			if (next === "'") {
				i++;
				const hex = rtf.substring(i, i + 2);
				i += 2;
				const code = parseInt(hex, 16);
				tokens.push({ type: 'text', value: String.fromCharCode(code) });
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
					param = parseInt(numStr, 10);
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

function buildTree(tokens: Token[]): RtfGroup {
	const root: RtfGroup = { type: 'group', children: [] };
	const stack: RtfGroup[] = [root];

	for (const tok of tokens) {
		const current = stack[stack.length - 1];

		if (tok.type === 'open') {
			const group: RtfGroup = { type: 'group', children: [] };
			current.children.push(group);
			stack.push(group);
		} else if (tok.type === 'close') {
			if (stack.length > 1) stack.pop();
		} else if (tok.type === 'control') {
			current.children.push({ type: 'control', word: tok.word, param: tok.param ?? null });
		} else if (tok.type === 'text') {
			current.children.push({ type: 'text', value: tok.value });
		}
	}

	return root;
}

// ── Color table parser ──

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
			if (node.word === 'red') { r = node.param ?? 0; hasComponents = true; }
			else if (node.word === 'green') { g = node.param ?? 0; hasComponents = true; }
			else if (node.word === 'blue') { b = node.param ?? 0; hasComponents = true; }
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

function parseFontTable(group: RtfGroup): Map<number, string> {
	const fonts = new Map<number, string>();

	for (const child of group.children) {
		if (child.type === 'group') {
			let fNum = 0;
			let fName = '';
			for (const node of child.children) {
				if (node.type === 'control' && node.word === 'f' && node.param != null) {
					fNum = node.param;
				}
				if (node.type === 'text') {
					fName += node.value;
				}
			}
			// Remove trailing semicolons
			fName = fName.replace(/;$/, '').trim();
			if (fName) fonts.set(fNum, fName);
		}
	}

	return fonts;
}

// ── Renderer ──

export function rtfToHtml(rtfString: string): string {
	const tokens = tokenize(rtfString);
	const tree = buildTree(tokens);

	let colorTable: string[] = [''];
	let fontTable = new Map<number, string>();
	let currentParagraph = '';
	const paragraphs: string[] = [];
	const paragraphAligns: string[] = [];
	const paragraphCaptions: boolean[] = [];
	let paragraphHasText = false;
	let paragraphHasListMarker = false;
	let paragraphIsCaption = false;

	/** Append a finished paragraph, keeping the parallel metadata arrays in sync. */
	function pushParagraph(html: string, align: string, isCaption = false): void {
		paragraphs.push(html);
		paragraphAligns.push(align);
		paragraphCaptions.push(isCaption);
	}

	// Paragraph alignment (reset by \pard, affects cells and paragraphs)
	let currentAlign = 'left';

	// Table state
	let tableRows: Array<{ cells: string[]; isHeader: boolean; cellRights: number[]; cellAligns: string[] }> = [];
	let currentRowCells: string[] = [];
	let currentRowIsHeader = false;
	let currentRowCellRights: number[] = [];
	let currentRowCellAligns: string[] = [];
	let inTableCell = false;
	let pendingBottomBorder = false; // set by \clbrdrb, confirmed by a real border type

	// First pass: extract color table and font table from the root group
	const rootGroup = tree.children[0]?.type === 'group' ? (tree.children[0] as RtfGroup) : tree;

	for (let i = 0; i < rootGroup.children.length; i++) {
		const child = rootGroup.children[i];
		if (child.type === 'group') {
			const firstControl = child.children.find((n) => n.type === 'control') as RtfControl | undefined;
			if (firstControl?.word === 'colortbl') {
				colorTable = parseColorTable(child);
			} else if (firstControl?.word === 'fonttbl') {
				fontTable = parseFontTable(child);
			}
		}
	}

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
			fontIndex: 0,
			ucSkip: 1,
			inList: false,
		};
	}

	const stateStack: RenderState[] = [defaultState()];

	function currentState(): RenderState {
		return stateStack[stateStack.length - 1];
	}

	function cloneState(): RenderState {
		return { ...currentState() };
	}

	function buildSpanOpen(state: RenderState): string {
		const styles: string[] = [];

		if (state.colorIndex > 0 && state.colorIndex < colorTable.length) {
			const color = colorTable[state.colorIndex];
			if (color && color !== 'rgb(0,0,0)') {
				styles.push(`color:${color}`);
			}
		}

		if (state.highlightIndex > 0) {
			const bg = HIGHLIGHT_COLORS[state.highlightIndex];
			if (bg) styles.push(`background-color:${bg}`);
		}

		const ptSize = state.fontSize / 2;
		if (ptSize && ptSize !== 12) {
			styles.push(`font-size:${ptSize}pt`);
		}

		if (styles.length === 0) return '';
		return `<span style="${styles.join(';')}">`;
	}

	function wrapText(text: string, state: RenderState): string {
		if (!text) return '';

		let result = text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');

		// Apply span styles
		const spanOpen = buildSpanOpen(state);
		if (spanOpen) {
			result = `${spanOpen}${result}</span>`;
		}

		if (state.bold) result = `<strong>${result}</strong>`;
		if (state.italic) result = `<em>${result}</em>`;
		if (state.underline) result = `<u>${result}</u>`;
		if (state.strike) result = `<s>${result}</s>`;
		if (state.super_) result = `<sup>${result}</sup>`;
		if (state.sub) result = `<sub>${result}</sub>`;

		return result;
	}

	let skipDepth = 0;

	const destinationWords = new Set([
		'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer',
		'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
		// \nonshppict duplicates the picture already carried by \*\shppict
		'nonshppict',
		'object', 'fldinst', 'xmlnstbl', 'listtable', 'listoverridetable',
		'rsidtbl', 'generator', 'datafield', 'themedata', 'colorschememapping',
		'latentstyles', 'datastore', 'mmathPr', 'author', 'operator',
		'title', 'subject', 'doccomm', 'company', 'category', 'keywords'
	]);

	function flushTable() {
		if (tableRows.length === 0) return;
		let html = '<table style="border-collapse:collapse;width:100%;margin:4px 0">';
		for (const row of tableRows) {
			html += '<tr>';
			const tag = row.isHeader ? 'th' : 'td';
			const total = row.cellRights[row.cellRights.length - 1] || 1;
			let prevRight = 0;
			for (let ci = 0; ci < row.cells.length; ci++) {
				const right = row.cellRights[ci] ?? total;
				const pct = ((right - prevRight) / total * 100).toFixed(1);
				prevRight = right;
				const align = row.cellAligns[ci] ?? 'left';
				const alignStyle = align !== 'left' ? `;text-align:${align}` : '';
				const style = row.isHeader
					? `border-bottom:1px solid;padding:2px 6px;text-align:${align};width:${pct}%`
					: `padding:2px 6px;width:${pct}%${alignStyle}`;
				html += `<${tag} style="${style}">${row.cells[ci] || ''}</${tag}>`;
			}
			html += '</tr>';
		}
		html += '</table>';
		pushParagraph(html, 'left');
		tableRows = [];
	}

	function flushParagraph() {
		flushTable();
		const trimmed = currentParagraph.trim();
		if (trimmed || !paragraphHasListMarker) {
			pushParagraph(currentParagraph, currentAlign, paragraphIsCaption);
		}
		currentParagraph = '';
		paragraphHasText = false;
		paragraphHasListMarker = false;
		paragraphIsCaption = false;
		currentAlign = 'left';
	}

	let pendingUnicodeSkip = 0;

	function walk(nodes: RtfNode[]) {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];

			if (skipDepth > 0 && node.type !== 'group') {
				continue;
			}

			if (node.type === 'group') {
				if (skipDepth > 0) {
					skipDepth++;
					walk(node.children);
					skipDepth--;
					continue;
				}

				const firstCtrl = node.children.find((n) => n.type === 'control') as RtfControl | undefined;

				if (firstCtrl?.word === 'pict') {
					const img = renderPicture(node);
					if (img) {
						currentParagraph += img;
						paragraphHasText = true;
					}
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
						stateStack.push(cloneState());
						walk(node.children);
						stateStack.pop();
					} else if (dest?.word === 'inkcap') {
						// Marks the paragraph that follows as a picture caption.
						paragraphIsCaption = true;
					}
					continue;
				}

				stateStack.push(cloneState());
				walk(node.children);
				stateStack.pop();
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
					case 'par':
						if (!inTableCell) flushParagraph();
						break;
					case 'trowd':
						currentRowCells = [];
						currentRowIsHeader = false;
						currentRowCellRights = [];
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
						if (pendingBottomBorder) currentRowIsHeader = true;
						pendingBottomBorder = false;
						break;
					case 'cellx':
						if (p != null) currentRowCellRights.push(p);
						break;
					case 'intbl':
						inTableCell = true;
						break;
					case 'cell':
						currentRowCells.push(currentParagraph.trim());
						currentRowCellAligns.push(currentAlign);
						currentParagraph = '';
						paragraphHasText = false;
						currentAlign = 'left';
						break;
					case 'row':
						tableRows.push({ cells: currentRowCells, isHeader: currentRowIsHeader, cellRights: currentRowCellRights, cellAligns: currentRowCellAligns });
						currentRowCells = [];
						currentRowIsHeader = false;
						currentRowCellRights = [];
						currentRowCellAligns = [];
						inTableCell = false;
						break;
					case 'pard':
						state.bold = false;
						state.italic = false;
						state.underline = false;
						state.strike = false;
						currentAlign = 'left';
						break;
					case 'line':
						currentParagraph += '<br>';
						paragraphHasText = true;
						break;
					case 'tab':
						currentParagraph += '&emsp;';
						paragraphHasText = true;
						break;
					case 'pntext':
					case 'listtext':
						state.inList = true;
						paragraphHasListMarker = true;
						break;
					case 'u': {
						if (p != null) {
							let codePoint = p;
							if (codePoint < 0) codePoint += 65536;
							currentParagraph += wrapText(String.fromCodePoint(codePoint), state);
							paragraphHasText = true;
							pendingUnicodeSkip = state.ucSkip ?? 1;
						}
						break;
					}
					case 'uc':
						if (p != null) {
							state.ucSkip = p;
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
						state.fontIndex = 0;
						break;
					case 'page':
						flushParagraph();
						pushParagraph('<hr>', 'left');
						break;
					case 'emspace':
					case 'enspace':
						currentParagraph += '&emsp;';
						paragraphHasText = true;
						break;
					case 'emdash':
						currentParagraph += '—';
						paragraphHasText = true;
						break;
					case 'endash':
						currentParagraph += '–';
						paragraphHasText = true;
						break;
					case 'lquote':
						currentParagraph += '\u2018';
						paragraphHasText = true;
						break;
					case 'rquote':
						currentParagraph += '\u2019';
						paragraphHasText = true;
						break;
					case 'ldblquote':
						currentParagraph += '\u201C';
						paragraphHasText = true;
						break;
					case 'rdblquote':
						currentParagraph += '\u201D';
						paragraphHasText = true;
						break;
					case 'bullet':
						currentParagraph += '\u2022';
						paragraphHasText = true;
						break;
					default:
						break;
				}
			} else if (node.type === 'text') {
				if (skipDepth > 0) continue;
				const state = currentState();
				if (pendingUnicodeSkip > 0) {
					const skipCount = Math.min(pendingUnicodeSkip, node.value.length);
					pendingUnicodeSkip -= skipCount;
					const remainder = node.value.slice(skipCount);
					if (remainder) {
						currentParagraph += wrapText(remainder, state);
						if (/[^\s]/.test(remainder)) paragraphHasText = true;
					}
					continue;
				}
				currentParagraph += wrapText(node.value, state);
				if (/[^\s]/.test(node.value)) paragraphHasText = true;
			}
		}
	}

	walk(rootGroup.children);
	flushTable(); // flush any trailing table rows
	// Only flush if there's actually pending content — the final \par in most RTF
	// files already flushed the last paragraph, so an unconditional call here
	// would push a spurious empty paragraph that becomes a trailing <p><br></p>.
	if (currentParagraph || paragraphHasText) {
		flushParagraph();
	}

	// Build final HTML from paragraphs (collapse repeated empty lines)
	const rendered: string[] = [];
	const trimmedParagraphs = paragraphs.map((p) => p.trim());
	const isListLine = (text: string) => /^[-\u2022]/.test(text.replace(/^&emsp;+/g, ''));

	for (let i = 0; i < trimmedParagraphs.length; i++) {
		const trimmed = trimmedParagraphs[i];
		const align = paragraphAligns[i] ?? 'left';
		const prev = i > 0 ? trimmedParagraphs[i - 1] : '';
		const next = i + 1 < trimmedParagraphs.length ? trimmedParagraphs[i + 1] : '';

		if (!trimmed) {
			if (isListLine(prev) && isListLine(next)) {
				continue;
			}
			const last = rendered[rendered.length - 1];
			if (last === '<p><br></p>') {
				continue;
			}
			rendered.push('<p><br></p>');
			continue;
		}

		if (trimmed === '<hr>') {
			rendered.push('<hr>');
			continue;
		}
		if (trimmed.startsWith('<table')) {
			rendered.push(trimmed);
			continue;
		}

		// A paragraph tagged by {\*\inkcap} is the description of the figure above it.
		if (paragraphCaptions[i]) {
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
			const alignAttr = align !== 'left' ? ` style="text-align:${align}"` : '';
			rendered.push(`<figure${alignAttr}>${trimmed}</figure>`);
			continue;
		}
		const sizeMatch = trimmed.match(/font-size:\s*([\d.]+)pt/);
		if (sizeMatch) {
			const pt = parseFloat(sizeMatch[1]);
			const alignAttr = align !== 'left' ? ` style="text-align:${align}"` : '';
			if (pt >= 24) { rendered.push(`<h1${alignAttr}>${stripSizeSpan(trimmed)}</h1>`); continue; }
			if (pt >= 18) { rendered.push(`<h2${alignAttr}>${stripSizeSpan(trimmed)}</h2>`); continue; }
			if (pt >= 14) { rendered.push(`<h3${alignAttr}>${stripSizeSpan(trimmed)}</h3>`); continue; }
		}
		const pStyle = align !== 'left' ? ` style="text-align:${align}"` : '';
		rendered.push(`<p${pStyle}>${trimmed}</p>`);
	}

	const output = rendered.join('\n');

	// fontTable is parsed (for future font rendering) but not yet used in output
	void fontTable;

	return output || '<p></p>';
}

function stripSizeSpan(html: string): string {
	return html.replace(/^<span style="[^"]*font-size:[^"]*">([\s\S]*)<\/span>$/, '$1');
}

/** Captions are written as italic text; <figcaption> supplies its own styling. */
function stripWrappingEm(html: string): string {
	return html.replace(/^<em>([\s\S]*)<\/em>$/, '$1');
}

export function readRtfFile(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const text = reader.result as string;
				const html = rtfToHtml(text);
				resolve(html);
			} catch (err) {
				reject(new Error(`Failed to parse RTF: ${(err as Error).message}`));
			}
		};
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file, 'ascii');
	});
}
