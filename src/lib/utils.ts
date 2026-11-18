import { linkTarget } from './rtf-writer.js';
import { tableModel, type GridCell } from './table-model.js';

/** Where the converter is: Markdown means different things in code, in a table cell and in a heading. */
interface MarkdownContext {
	/** Inside a table cell, where a pipe ends the cell. */
	inCell: boolean;
	/** Inside a table cell or a heading, which Markdown writes on one line: a line break is a <br>. */
	oneLine: boolean;
	/**
	 * The formatting of the elements around that hold whole paragraphs, as <b><p>…</p><p>…</p></b>
	 * does, outermost first. Markdown cannot carry one pair of marks across paragraphs, so each
	 * line of text inside is marked on its own.
	 */
	open: readonly MarkdownFormat[];
	/** The emphasis marks already open, so bold inside bold is marked once. */
	marks: readonly string[];
	/** Inside a figure: the caption, which describes a picture that has no description of its own. */
	figure: { alt: string } | null;
	/** Inside an element with visibility:hidden, whose text the screen does not show. */
	unseen: boolean;
	/** Captions their figure writes itself, after what it holds. */
	captions: ReadonlySet<Node>;
}

/** A kind of formatting: what is written around the text, and a name that tells two kinds apart. */
interface MarkdownFormat {
	key: string;
	wrap: (text: string) => string;
}

/** Text with one formatting around all of it; the text can hold formatted parts of its own. */
interface MarkdownSpan extends MarkdownFormat {
	parts: MarkdownPart[];
	/** For a code span: its code, which is written as it is, and to which code right after it is added. */
	code?: string;
}

/** A part of a line: plain Markdown, or a span of formatted text. */
type MarkdownPart = string | MarkdownSpan;

/** What has been written so far: the finished blocks, and the line of text still being written. */
interface MarkdownOutput {
	blocks: string[];
	line: MarkdownPart[];
}

/** Elements whose text is never shown. */
const UNSHOWN_TAGS = new Set(['style', 'script', 'template', 'noscript', 'title', 'head']);

/** Elements that are a line of their own and nothing more, as a <div> is. */
const LINE_TAGS = [
	'p', 'div', 'dl', 'dt', 'dd', 'section', 'article', 'address', 'details', 'summary', 'center', 'header', 'footer',
	'main', 'aside', 'nav', 'figcaption', 'li', 'fieldset', 'form', 'legend', 'hgroup'
];

/** Every element that starts a line of its own; anything else is part of the line it stands in. */
const BLOCK_TAGS = new Set([
	...LINE_TAGS, 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'menu', 'dir', 'blockquote', 'pre', 'hr', 'table', 'figure'
]);
const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).join(',');

/**
 * Text as Markdown shows it: the characters Markdown reads as markup are escaped, so "2*3*4" is
 * not emphasis, "#1" not a heading, "[x]" not a link, "<b>" not HTML and "&copy;" not a ©.
 * An "&" is escaped only where a name and a ";" follow it, so "H&E" stays as it is typed.
 * ("&#35;" needs nothing more: its "#" is escaped already.)
 * A "|" is escaped everywhere, not only in a table cell: two lines typed as "Stain | Result" and
 * "--- | ---" are a table to a viewer that knows tables, which then drops what does not fit its
 * columns and cuts a code span in the lines below at its "|", letting the code out.
 */
function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_[\]#<~|]/g, '\\$&').replace(/&(?=[a-z][a-z0-9]*;)/gi, '\\&');
}

/**
 * Code as a Markdown code span: fenced with more backticks than it holds, and in a table cell its
 * pipes escaped. A line break in it is a space, which is how Markdown shows one in a code span:
 * left as it is, an empty line would end the paragraph and the span with it, and the rest of the
 * code would be read as Markdown and as HTML.
 */
function codeSpan(code: string, ctx: MarkdownContext): string {
	const line = code.replace(/[\r\n]+/g, ' ');
	const longest = Math.max(0, ...Array.from(line.matchAll(/`+/g), (m) => m[0].length));
	const fence = '`'.repeat(longest + 1);
	const pad = /^`|`$/.test(line) ? ' ' : '';
	const body = ctx.inCell ? line.replace(/\|/g, '\\|') : line;
	return `${fence}${pad}${body}${pad}${fence}`;
}

/**
 * An address as a Markdown link or image target: what would end it, or a table cell, is encoded.
 * Markdown reads "&copy;" in an address as it does in text, so there the "&" is written out.
 */
function markdownUrl(url: string): string {
	return url
		.replace(/[()|\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
		.replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;');
}

/**
 * A picture's address, if it is one a Markdown viewer may load: a web address, a relative path,
 * or PNG/JPEG/GIF/WebP data. Any other scheme (javascript:, file:) is not. Nor is an address with
 * a control character in it: a browser drops some of those before it reads the scheme, so
 * "\x01javascript:…" would pass for a relative path here and be a script there.
 */
function imageTarget(src: string): string | null {
	const value = src.trim();
	if (!value) return null;
	if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return value.replace(/\s+/g, '');
	if (/[\u0000-\u001f\u007f]/.test(value)) return null;
	if (/^https?:\/\//i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value)) return markdownUrl(value);
	return null;
}

/** A picture as Markdown, or its description alone where its address is not one to load. */
function imageToMarkdown(alt: string, src: string, ctx: MarkdownContext): string {
	const target = imageTarget(src);
	const text = escapeMarkdown(alt);
	return target ? `![${text}](${target})` : text;
}

/**
 * A list item's Markdown under its marker: later lines are indented to the item's text, so a
 * table, a code block or a list inside the item stays in it.
 */
function listItem(marker: string, body: string): string {
	// (Spaces and line breaks only are taken off its ends: other white space is the document's.)
	return `${marker}${body.replace(/^[ \n]+|[ \n]+$/g, '').replace(/\n(?=[^\n])/g, `\n${' '.repeat(marker.length)}`)}`;
}

/**
 * A block's text with the marks escaped that mean something only where a line starts: "-", "+"
 * and "1." open a list, ">" a quotation (with or without a space after it). A report line typed
 * as "- Benign." stays that line. A line made only of "=" or of "-" is escaped too: under a line
 * of text it would turn that line into a heading, and on its own "---" would be a rule.
 */
function escapeLineStarts(markdown: string): string {
	// A line starts at the start of the text and after "\n", and nowhere else: with the "m" flag
	// a pattern also takes U+2028 for a line break, and put backslashes into a code span.
	return markdown.replace(
		/(^|\n)([ \t]*)(?:(>|[-+](?=\s|$)|-(?=[- \t]*(?:\n|$))|=(?=[= \t]*(?:\n|$)))|(\d+)([.)])(?=\s|$))/g,
		(_m, start, lead, mark, digits, dot) => (mark ? `${start}${lead}\\${mark}` : `${start}${lead}${digits}\\${dot}`)
	);
}

/**
 * Two pieces of one line put together.
 * - A space on each side of the join is one space, as it is on screen ("is <i> benign</i>").
 * - "!" right before a link would make the link a picture, so that "!" is escaped.
 * - "&" in one piece and "copy;" in the next would be read as ©, so that "&" is escaped.
 */
function joinLine(line: string, piece: string): string {
	if (!piece) return line;
	if (line.endsWith(' ') && piece.startsWith(' ')) piece = piece.slice(1);
	if (line.endsWith('!') && piece.startsWith('[')) return `${line.slice(0, -1)}\\!${piece}`;
	const open = line.match(/&[a-z0-9]*$/i);
	if (open && /^[a-z0-9]*;/i.test(piece) && /^&[a-z][a-z0-9]*;/i.test(open[0] + piece)) {
		return `${line.slice(0, open.index)}\\${open[0]}${piece}`;
	}
	return line + piece;
}

/**
 * Text between a pair of emphasis marks. Markdown reads "**word **" as plain asterisks, so white
 * space at either end is written outside the marks; with nothing left between them, no marks.
 */
function emphasis(inner: string, mark: string): string {
	return around(inner, mark, mark);
}

/**
 * Text with something written around it: around the text itself, with the white space and line
 * breaks at either end left outside. (Found with trim, not with one pattern for all three parts:
 * on a long run of spaces inside the text such a pattern took a second.)
 */
function around(text: string, open: string, close: string): string {
	const core = text.trim();
	if (!core) return text;
	const start = text.length - text.trimStart().length;
	return `${text.slice(0, start)}${open}${core}${close}${text.slice(start + core.length)}`;
}

/**
 * Add a part to a line. Formatted text right after text formatted the same way goes on from it:
 * "<b>Diag</b><b>nosis</b>", which is what a paste from a word processor often holds, is one bold
 * word, where two pairs of marks back to back ("**Diag****nosis**") would show as asterisks.
 */
function addPart(parts: MarkdownPart[], part: MarkdownPart): void {
	const last = parts[parts.length - 1];
	if (typeof part === 'string') {
		if (!part) return;
		if (typeof last === 'string') parts[parts.length - 1] = joinLine(last, part);
		else parts.push(part);
	} else if (part.code !== undefined) {
		// Code right after code is one code span. Two spans back to back run their backticks
		// together ("`a``b`"), which Markdown reads as other fences than the ones written: the
		// two show as one, and with a backtick at the end of the first the code is out of its span.
		if (last !== undefined && typeof last !== 'string' && last.code !== undefined) last.code += part.code;
		else parts.push({ ...part });
	} else if (part.parts.length) {
		if (last !== undefined && typeof last !== 'string' && last.code === undefined && last.key === part.key) part.parts.forEach((inner) => addPart(last.parts, inner));
		else parts.push({ ...part, parts: [...part.parts] });
	}
}

/** The parts of a line as Markdown, each span inside its formatting. */
function lineOf(parts: readonly MarkdownPart[]): string {
	return parts.reduce<string>(
		(line, part) => joinLine(line, typeof part === 'string' ? part : part.wrap(part.code ?? lineOf(part.parts))),
		''
	);
}

/** Parts of a line, inside the formatting of the elements around their block (see MarkdownContext.open). */
function inOpenFormats(parts: MarkdownPart[], ctx: MarkdownContext): MarkdownPart[] {
	return ctx.open.reduceRight<MarkdownPart[]>((inner, format) => (inner.length ? [{ ...format, parts: inner }] : inner), parts);
}

/** The formatting of a pair of emphasis marks; none where the same marks are open already, so bold in bold is marked once. */
function emphasisFormat(mark: string, ctx: MarkdownContext): { inner: MarkdownContext } & MarkdownFormat {
	if (ctx.marks.includes(mark)) return { key: '', inner: ctx, wrap: (text) => text };
	return { key: mark, inner: { ...ctx, marks: [...ctx.marks, mark] }, wrap: (text) => emphasis(text, mark) };
}

/**
 * A finished line of text. White space at its ends shows as nothing and is dropped, and so is a
 * line break at its end. A line break inside it is one Markdown keeps: two spaces before the new
 * line. A second break in a row is an empty line, which Markdown would read as the end of the
 * paragraph (and of any bold running through it), so it is written as a <br> at the end of the
 * line before it. Never on a line of its own: a line that holds one tag and nothing else opens a
 * block of HTML, in which "\<" is no escape and the text after it is read as HTML.
 * Where the text must stay on one line (a table cell, a heading), every break is a <br>.
 */
function finishLine(line: string, ctx: MarkdownContext): string {
	const text = line.replace(/ *\n */g, '\n').replace(/^[ \n]+|[ \n]+$/g, '');
	if (ctx.oneLine) return text.replace(/\n/g, '<br>');
	// Split into what each line holds and the breaks after it, by turns.
	return text
		.split(/(\n+)/)
		.map((piece, i) => (i % 2 ? `${'<br>'.repeat(piece.length - 1)}  \n` : startOfLine(piece)))
		.join('');
}

/**
 * What a line of a paragraph holds, made safe at its start. White space there is not text to
 * Markdown: a tab makes the line a code block, and a line of white space alone (a tab, a no-break
 * space) is no line at all, so the <br> after it would stand first, as a tag alone on a line does.
 * Such a line is written as "&nbsp;", and a tab at the start as "&#9;", which are text.
 */
function startOfLine(held: string): string {
	if (held && !/\S/.test(held)) return '&nbsp;';
	return held.replace(/^[ \t]+/, (lead) => lead.replace(/\t/g, '&#9;'));
}

/** End the line of text being written: loose text before a block is a paragraph of its own. */
function endLine(out: MarkdownOutput, ctx: MarkdownContext): void {
	const text = finishLine(lineOf(out.line), ctx);
	out.line = [];
	if (text) out.blocks.push(escapeLineStarts(text));
}

/**
 * The context for what an element holds, or null if the screen shows none of it: a <style> or a
 * <script>, the hidden attribute, display:none, or visibility:hidden. Text inside a
 * visibility:hidden element can be shown again by visibility:visible, and then it is written.
 */
function shown(el: HTMLElement, ctx: MarkdownContext): MarkdownContext | null {
	if (UNSHOWN_TAGS.has(el.tagName.toLowerCase()) || el.hasAttribute('hidden')) return null;
	// Word's hidden text, which a paste from Word carries as a style no browser knows.
	if (/mso-hide\s*:\s*all/i.test(el.getAttribute('style') ?? '')) return null;
	const style = el.style;
	if (!style) return ctx;
	if (style.display === 'none') return null;
	if (style.visibility === 'visible') return ctx.unseen ? { ...ctx, unseen: false } : ctx;
	if (style.visibility === 'hidden' || style.visibility === 'collapse') {
		const shownAgain = Array.from(el.querySelectorAll<HTMLElement>('[style]')).some((d) => d.style?.visibility === 'visible');
		return shownAgain ? { ...ctx, unseen: true } : null;
	}
	return ctx;
}

/** The same for an element some levels down, as a table's cell is: null if it or anything around it is hidden. */
function shownIn(el: HTMLElement, root: HTMLElement, ctx: MarkdownContext): MarkdownContext | null {
	const path: HTMLElement[] = [];
	for (let at: HTMLElement | null = el; at && at !== root; at = at.parentElement) path.unshift(at);
	let inside: MarkdownContext | null = ctx;
	for (const step of path) inside = inside && shown(step, inside);
	return inside;
}

/**
 * The text of a code block or a code span, as the screen shows it: a <br> is a new line and a
 * <div> (which is what Enter leaves in a code block) is a line of its own.
 */
function codeText(el: HTMLElement, ctx: MarkdownContext): string {
	let code = '';
	// A block has started or ended: what comes next starts a new line.
	let lineDue = false;
	const newLineIfDue = () => {
		if (lineDue && code && !code.endsWith('\n')) code += '\n';
		lineDue = false;
	};
	const visit = (node: Node, at: MarkdownContext) => {
		if (node.nodeType === Node.TEXT_NODE) {
			if (at.unseen || !node.textContent) return;
			newLineIfDue();
			code += node.textContent;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const inside = shown(node as HTMLElement, at);
		if (!inside) return;
		const tag = (node as Element).tagName.toLowerCase();
		if (tag === 'br') {
			if (inside.unseen) return;
			newLineIfDue();
			code += '\n';
			return;
		}
		const block = BLOCK_TAGS.has(tag);
		if (block) lineDue = true;
		node.childNodes.forEach((child) => visit(child, inside));
		if (block) lineDue = true;
	};
	el.childNodes.forEach((child) => visit(child, ctx));
	return code;
}

/**
 * How an element formats the text it holds: the context for that text, and what is written
 * around it. Used the same way for a word in a line and for an element around whole paragraphs.
 */
function formatOf(el: HTMLElement, tag: string, ctx: MarkdownContext): { inner: MarkdownContext } & MarkdownFormat {
	const plain = { key: '', inner: ctx, wrap: (text: string) => text };
	const marked = (mark: string) => emphasisFormat(mark, ctx);
	// What is written around the text goes around the text itself, and white space and line
	// breaks at either end stay outside it. For an HTML tag this is what keeps the text text: a
	// tag alone on a line opens a block of HTML, in which "\<" is no escape.
	const within = (open: string, close: string) => ({
		key: open + close,
		inner: ctx,
		wrap: (text: string) => around(text, open, close)
	});
	switch (tag) {
		case 'strong':
		case 'b':
			// A paste from Google Docs is wrapped in <b style="font-weight:normal">, which is not bold.
			return /^(normal|[1-4]00)$/.test(el.style?.fontWeight ?? '') ? plain : marked('**');
		case 'em':
		case 'i':
			return el.style?.fontStyle === 'normal' ? plain : marked('*');
		case 's':
		case 'strike':
		case 'del':
			return marked('~~');
		case 'u':
		case 'ins':
		case 'sup':
		case 'sub':
			// Markdown has no mark for these; it allows the HTML itself.
			return within(`<${tag}>`, `</${tag}>`);
		case 'a': {
			// As in the RTF: only a web, mail or phone address is a link; a javascript:
			// address, which a Markdown viewer would run, is written as its text alone.
			const target = linkTarget(el.getAttribute('href') || '');
			return target ? within('[', `](${markdownUrl(target)})`) : plain;
		}
		default:
			return plain;
	}
}

/** A piece of a line, as its parts: text, or an element that holds no block. */
function inlineParts(node: Node, ctx: MarkdownContext): MarkdownPart[] {
	if (node.nodeType === Node.TEXT_NODE) {
		if (ctx.unseen) return [];
		// A line break in the HTML source shows as a space, as it does on screen; where white
		// space is kept (the editor's tab, <span style="white-space:pre">), it stays.
		const text = node.textContent || '';
		const kept = node.parentElement?.closest('[style*="white-space"]') as HTMLElement | null;
		const keeps = kept !== null && /^pre/.test(kept.style.whiteSpace);
		return [escapeMarkdown(keeps ? text.replace(/\r\n?/g, '\n') : text.replace(/[ \t\r\n]+/g, ' '))];
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return [];

	const el = node as HTMLElement;
	const inside = shown(el, ctx);
	if (!inside) return [];
	const tag = el.tagName.toLowerCase();
	switch (tag) {
		case 'br':
			return inside.unseen ? [] : ['\n'];
		case 'img':
			return inside.unseen ? [] : [imageToMarkdown(el.getAttribute('alt') || inside.figure?.alt || '', el.getAttribute('src') || '', inside)];
		case 'code': {
			// Code is written as it is. With no code in it there is nothing to show: an empty
			// code span is not Markdown, it would be read as two backticks.
			const code = codeText(el, inside);
			return code ? [{ key: 'code', code, parts: [], wrap: (text: string) => codeSpan(text, inside) }] : [];
		}
	}
	const format = formatOf(el, tag, inside);
	const parts: MarkdownPart[] = [];
	el.childNodes.forEach((child) => inlineParts(child, format.inner).forEach((part) => addPart(parts, part)));
	return format.key ? [{ key: format.key, wrap: format.wrap, parts }] : parts;
}

/**
 * Write what a run of nodes holds. Text and the elements that are part of a line are added to the
 * line being written; a block ends that line first, so text typed before a block (which is what a
 * browser leaves when a line is typed and Enter pressed) is a paragraph of its own. An element
 * that is not a block but holds one (<b><p>…</p></b>, a <span> around a list) is opened up: its
 * blocks are written as blocks, each with the element's formatting on its text.
 */
function nodesToMarkdown(nodes: Iterable<Node>, ctx: MarkdownContext, out: MarkdownOutput): void {
	let run: MarkdownPart[] = [];
	const endRun = () => {
		inOpenFormats(run, ctx).forEach((part) => addPart(out.line, part));
		run = [];
	};

	for (const node of nodes) {
		if (node.nodeType !== Node.ELEMENT_NODE) {
			inlineParts(node, ctx).forEach((part) => addPart(run, part));
			continue;
		}
		const el = node as HTMLElement;
		if (ctx.captions.has(el)) continue;
		const inside = shown(el, ctx);
		if (!inside) continue;

		const tag = el.tagName.toLowerCase();
		// In a figure a picture is a block of its own, so text typed beside it is not run into it.
		const isBlock = BLOCK_TAGS.has(tag) || (tag === 'img' && ctx.figure !== null);
		if (!isBlock && (tag === 'code' || !el.querySelector(BLOCK_SELECTOR))) {
			inlineParts(el, ctx).forEach((part) => addPart(run, part));
			continue;
		}
		endRun();
		if (!isBlock) {
			const format = formatOf(el, tag, inside);
			nodesToMarkdown(el.childNodes, { ...format.inner, open: format.key ? [...inside.open, format] : inside.open }, out);
			continue;
		}
		endLine(out, ctx);
		blockToMarkdown(el, tag, inside, out);
	}
	endRun();
}

/** The blocks a run of nodes holds, with any loose text among them as paragraphs. */
function blocksOf(nodes: Iterable<Node>, ctx: MarkdownContext): string[] {
	const out: MarkdownOutput = { blocks: [], line: [] };
	nodesToMarkdown(nodes, ctx, out);
	endLine(out, ctx);
	return out.blocks;
}

/**
 * What an element holds, as Markdown: each block followed by a blank line. Text at the very end
 * that is in no block ends with no line break, so a caller can go on from it.
 */
function childrenToMarkdown(el: HTMLElement, ctx: MarkdownContext): string {
	const out: MarkdownOutput = { blocks: [], line: [] };
	nodesToMarkdown(el.childNodes, ctx, out);
	return out.blocks.map((block) => `${block}\n\n`).join('') + escapeLineStarts(finishLine(lineOf(out.line), ctx));
}

/** What a table cell holds, on the one line a cell has; nothing for a cell, or a row, that is hidden. */
function cellToMarkdown(cell: HTMLElement, table: HTMLElement, ctx: MarkdownContext, lineBreak: string): string {
	const inside = shownIn(cell, table, ctx);
	return inside ? childrenToMarkdown(cell, inside).trim().replace(/\s*\n\s*/g, lineBreak) : '';
}

/** Whether a row of the table is one the screen shows: a hidden row is not written as an empty one. */
function rowShown(row: readonly (GridCell | null)[], r: number, table: HTMLElement, ctx: MarkdownContext): boolean {
	const own = row.find((cell) => cell?.row === r);
	return !own?.el.parentElement || shownIn(own.el.parentElement, table, ctx) !== null;
}

/** A table's caption, which stands above it: a line of its own, so its text is not lost. */
function captionBlocks(table: HTMLElement, ctx: MarkdownContext): string[] {
	return Array.from(table.children)
		.filter((child) => child.tagName.toLowerCase() === 'caption')
		.flatMap((caption) => blocksOf([caption], ctx));
}

/** A table as a Markdown (GFM) table. */
function tableToMarkdown(table: HTMLElement, ctx: MarkdownContext): string {
	const model = tableModel(table);
	if (model.columns === 0) return '';
	const inCell: MarkdownContext = { ...ctx, inCell: true, oneLine: true, figure: null };
	// The first row is always written: it is the header Markdown requires.
	const lines = model.rows.filter((row, r) => r === 0 || rowShown(row, r, table, ctx)).map((row) => {
		// Markdown has no merged cells: a cell that spans is written where it starts, and the
		// other columns and rows it covers are left empty so the columns still line up.
		const cells = row.map((cell, c) => {
			if (!cell || cell.col !== c || model.rows[cell.row] !== row) return '';
			return cellToMarkdown(cell.el, table, inCell, '<br>');
		});
		return `| ${cells.join(' | ')} |`;
	});
	// The first row is the header if it holds a header cell; a table with none gets an empty
	// one, which Markdown requires.
	const hasHeader = model.rows[0].some((cell) => cell?.row === 0 && cell.el.tagName.toLowerCase() === 'th');
	if (!hasHeader) lines.unshift(`| ${model.rows[0].map(() => ' ').join(' | ')} |`);
	lines.splice(1, 0, `| ${model.rows[0].map(() => '---').join(' | ')} |`);
	return lines.join('\n');
}

/** A table inside a table cell, as text: its caption, then each row a line, its cells a slash apart. */
function nestedTableToText(table: HTMLElement, ctx: MarkdownContext): string {
	const model = tableModel(table);
	const rows = model.rows
		.filter((row, r) => rowShown(row, r, table, ctx))
		.map((row) =>
			row
				.filter((cell, c) => cell && cell.col === c && model.rows[cell.row] === row)
				.map((cell) => cellToMarkdown(cell!.el, table, ctx, ' '))
				.join(' / ')
		);
	return [...captionBlocks(table, ctx), ...rows].filter(Boolean).join('\n');
}

/**
 * A list. An item is its marker and what it holds. A list written straight inside a list, which
 * is not valid HTML but is what some editors and pastes produce, is nested under the item before
 * it, as the screen shows it. Anything else that is not an item (loose text, a paragraph) is kept
 * as a line of its own between the items; a numbered list goes on counting after it.
 */
function listToMarkdown(list: HTMLElement, ordered: boolean, ctx: MarkdownContext, out: MarkdownOutput): void {
	const start = parseInt(list.getAttribute('start') ?? '', 10);
	// Markdown writes a list number in up to nine digits and none below zero. A number it cannot
	// write ("-3.", or ten digits) is text, not a marker, and a code block in that item no code
	// block: the list starts as near to its own number as Markdown can count from.
	const itemCount = Array.from(list.children).filter((child) => child.tagName === 'LI').length;
	let number = Number.isFinite(start) ? Math.max(0, Math.min(start, 1_000_000_000 - Math.max(itemCount, 1))) : 1;
	let items: { marker: string; blocks: string[] }[] = [];
	let loose: Node[] = [];

	const endItems = () => {
		if (items.length) out.blocks.push(items.map((item) => listItem(item.marker, item.blocks.join('\n\n'))).join('\n'));
		items = [];
	};
	const endLoose = () => {
		const blocks = blocksOf(loose, ctx);
		loose = [];
		if (!blocks.length) return;
		endItems();
		out.blocks.push(...blocks);
	};

	list.childNodes.forEach((node) => {
		const tag = node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName.toLowerCase() : '';
		if (tag === 'li') {
			endLoose();
			const inside = shown(node as HTMLElement, ctx);
			if (!inside) return;
			const blocks = blocksOf(node.childNodes, inside);
			// An item whose text is hidden shows no marker either.
			if (blocks.length || !inside.unseen) items.push({ marker: ordered ? `${number++}. ` : '- ', blocks });
		} else if (['ul', 'ol', 'menu', 'dir'].includes(tag)) {
			endLoose();
			if (items.length) items[items.length - 1].blocks.push(...blocksOf([node], ctx));
			else loose.push(node);
		} else {
			loose.push(node);
		}
	});
	endLoose();
	endItems();
}

/** Write one block element. The line before it has been ended. */
function blockToMarkdown(el: HTMLElement, tag: string, ctx: MarkdownContext, out: MarkdownOutput): void {
	switch (tag) {
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6': {
			// A heading is one line: a line break in it, written as a new line, would put the
			// rest of its text outside the heading.
			const text = blocksOf(el.childNodes, { ...ctx, oneLine: true }).join('<br>').replace(/\s*\n\s*/g, '<br>');
			if (text) out.blocks.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
			break;
		}
		case 'ul':
		case 'menu':
		case 'dir':
		case 'ol':
			listToMarkdown(el, tag === 'ol', ctx, out);
			break;
		case 'blockquote': {
			// Every line of the quotation carries the mark, the blank ones too: a line without it
			// would end the quotation, and a code block opened in it would close outside it.
			const held = blocksOf(el.childNodes, ctx).join('\n\n');
			if (held) out.blocks.push(held.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n'));
			break;
		}
		case 'pre': {
			// A lone carriage return ends a line in Markdown too, and the lines of a code block
			// are indented and quoted one by one: left in, it would start a line without the
			// ">" or the indent, outside the block.
			const code = codeText(el, ctx).replace(/\r\n?/g, '\n');
			if (ctx.oneLine) {
				// A table cell holds one line: each line of the block is a code span of its own.
				const spans = code.split('\n').map((line) => (line ? codeSpan(line, ctx) : '')).join('<br>');
				if (spans) out.blocks.push(spans);
				break;
			}
			const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
			const fence = '`'.repeat(longest + 1);
			out.blocks.push(`${fence}\n${code}\n${fence}`);
			break;
		}
		case 'hr':
			if (!ctx.unseen) out.blocks.push('\n---');
			break;
		case 'table': {
			// Markdown cannot put a table in a table cell: the inner one is its rows as lines,
			// its cells a slash apart, as the RTF writes them a tab apart.
			if (ctx.oneLine) {
				const text = nestedTableToText(el, ctx);
				if (text) out.blocks.push(text);
				break;
			}
			out.blocks.push(...captionBlocks(el, ctx));
			const table = tableToMarkdown(el, ctx);
			if (table) out.blocks.push(table);
			break;
		}
		case 'figure': {
			// A figure writes everything it holds: each picture as a block of its own, text typed
			// beside a picture as paragraphs, and last its own caption (not the caption of a
			// figure inside it, which that figure writes). The caption and a picture's description
			// are text like any other, so a "[x](javascript:…)" in either stays text.
			const captions = Array.from(el.querySelectorAll<HTMLElement>('figcaption')).filter((c) => c.parentElement?.closest('figure') === el);
			const seen = captions.filter((c) => shownIn(c, el, ctx) !== null);
			const alt = seen.map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
			nodesToMarkdown(el.childNodes, { ...ctx, figure: { alt }, captions: new Set([...ctx.captions, ...captions]) }, out);
			endLine(out, ctx);
			// A caption is written in italics, as it always was.
			const italic = emphasisFormat('*', { ...ctx, figure: null });
			const inCaption: MarkdownContext = { ...italic.inner, open: italic.key ? [...ctx.open, italic] : ctx.open };
			for (const caption of seen) out.blocks.push(...blocksOf(caption.childNodes, inCaption));
			break;
		}
		case 'img': {
			// Reached only inside a figure (see nodesToMarkdown).
			const image = ctx.unseen ? '' : imageToMarkdown(el.getAttribute('alt') || ctx.figure?.alt || '', el.getAttribute('src') || '', ctx);
			if (image) out.blocks.push(lineOf(inOpenFormats([image], ctx)));
			break;
		}
		default:
			// A paragraph, a <div>, or a block Markdown has no word for (<section>, <dd>, …): what
			// it holds, as a paragraph of its own.
			nodesToMarkdown(el.childNodes, ctx, out);
			endLine(out, ctx);
			break;
	}
}

export function htmlToMarkdown(el: HTMLElement): string {
	return childrenToMarkdown(el, {
		inCell: false,
		oneLine: false,
		open: [],
		marks: [],
		figure: null,
		unseen: false,
		captions: new Set()
	});
}

export function downloadFile(filename: string, content: string, mimeType: string): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
