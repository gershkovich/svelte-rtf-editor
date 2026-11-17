import { linkTarget } from './rtf-writer.js';
import { tableModel } from './table-model.js';

/** Where the converter is: Markdown means different things in code and in a table cell. */
interface MarkdownContext {
	/** Inside a table cell, where a pipe ends the cell and a line break ends the row. */
	inCell: boolean;
}

/**
 * Text as Markdown shows it: the characters Markdown reads as markup are escaped, so "2*3*4" is
 * not emphasis, "#1" not a heading, "[x]" not a link and "<b>" not HTML.
 */
function escapeMarkdown(text: string, ctx: MarkdownContext): string {
	const escaped = text.replace(/[\\`*_[\]#<~]/g, '\\$&');
	return ctx.inCell ? escaped.replace(/\|/g, '\\|') : escaped;
}

/** Code as a Markdown code span: fenced with more backticks than it holds, and in a table cell its pipes escaped. */
function codeSpan(code: string, ctx: MarkdownContext): string {
	const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
	const fence = '`'.repeat(longest + 1);
	const pad = /^`|`$/.test(code) ? ' ' : '';
	const body = ctx.inCell ? code.replace(/\|/g, '\\|') : code;
	return `${fence}${pad}${body}${pad}${fence}`;
}

/** An address as a Markdown link or image target: what would end it, or a table cell, is encoded. */
function markdownUrl(url: string): string {
	return url.replace(/[()|\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/**
 * A picture's address, if it is one a Markdown viewer may load: a web address, a relative path,
 * or PNG/JPEG/GIF/WebP data. Any other scheme (javascript:, file:) is not.
 */
function imageTarget(src: string): string | null {
	const value = src.trim();
	if (!value) return null;
	if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return value.replace(/\s+/g, '');
	if (/^https?:\/\//i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value)) return markdownUrl(value);
	return null;
}

/** A picture as Markdown, or its description alone where its address is not one to load. */
function imageToMarkdown(alt: string, src: string, ctx: MarkdownContext): string {
	const target = imageTarget(src);
	const text = escapeMarkdown(alt, ctx);
	return target ? `![${text}](${target})` : text;
}

/**
 * A list item's Markdown under its marker: later lines are indented to the item's text, so a
 * table, a code block or a list inside the item stays in it.
 */
function listItem(marker: string, body: string): string {
	return `${marker}${body.trim().replace(/\n(?=[^\n])/g, `\n${' '.repeat(marker.length)}`)}\n`;
}

/**
 * A block's text with the marks escaped that mean something only where a line starts: "-", "+"
 * and "1." open a list, ">" a quotation. A report line typed as "- Benign." stays that line.
 */
function escapeLineStarts(markdown: string): string {
	return markdown.replace(/^(\s*)(?:([-+>])(?=\s|$)|(\d+)([.)])(?=\s|$))/gm, (_m, lead, mark, digits, dot) =>
		mark ? `${lead}\\${mark}` : `${lead}${digits}\\${dot}`
	);
}

/** A table as a Markdown (GFM) table. */
function tableToMarkdown(table: HTMLElement): string {
	const model = tableModel(table);
	if (model.columns === 0) return '';
	const lines = model.rows.map((row) => {
		// Markdown has no merged cells: a cell that spans is written where it starts, and the
		// other columns and rows it covers are left empty so the columns still line up.
		const cells = row.map((cell, c) => {
			if (!cell || cell.col !== c || model.rows[cell.row] !== row) return '';
			return childrenToMarkdown(cell.el, { inCell: true })
				.trim()
				.replace(/\s*\n\s*/g, '<br>');
		});
		return `| ${cells.join(' | ')} |`;
	});
	// The first row is the header if it holds a header cell; a table with none gets an empty
	// one, which Markdown requires.
	const hasHeader = model.rows[0].some((cell) => cell?.row === 0 && cell.el.tagName.toLowerCase() === 'th');
	if (!hasHeader) lines.unshift(`| ${model.rows[0].map(() => ' ').join(' | ')} |`);
	lines.splice(1, 0, `| ${model.rows[0].map(() => '---').join(' | ')} |`);
	return `${lines.join('\n')}\n\n`;
}

/** A blank line before a block that follows text on the same line, as in "See<table>…". */
function blockStart(md: string): string {
	return md && !md.endsWith('\n') ? '\n\n' : '';
}

/** A table inside a table cell, as text: each row a line, its cells a slash apart. */
function nestedTableToText(table: HTMLElement, ctx: MarkdownContext): string {
	const model = tableModel(table);
	return model.rows
		.map((row) =>
			row
				.filter((cell, c) => cell && cell.col === c && model.rows[cell.row] === row)
				.map((cell) => childrenToMarkdown(cell!.el, ctx).trim().replace(/\s*\n\s*/g, ' '))
				.join(' / ')
		)
		.filter(Boolean)
		.join('\n');
}

export function htmlToMarkdown(el: HTMLElement): string {
	return childrenToMarkdown(el, { inCell: false });
}

function childrenToMarkdown(el: HTMLElement, ctx: MarkdownContext): string {
	let md = '';

	el.childNodes.forEach((node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			// A line break in the HTML source shows as a space, as it does on screen; where white
			// space is kept (the editor's tab, <span style="white-space:pre">), it stays.
			const text = node.textContent || '';
			const kept = node.parentElement?.closest('[style*="white-space"]') as HTMLElement | null;
			const keeps = kept !== null && /^pre/.test(kept.style.whiteSpace);
			md += escapeMarkdown(keeps ? text : text.replace(/[ \t\r\n]+/g, ' '), ctx);
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;

		const tag = (node as Element).tagName.toLowerCase();
		// Code is written as it is, and a table and a picture build their own text.
		const inner = tag === 'pre' || tag === 'code' || tag === 'table' || tag === 'figure'
			? ''
			: childrenToMarkdown(node as HTMLElement, ctx);

		switch (tag) {
			case 'h1':
				md += `# ${inner}\n\n`;
				break;
			case 'h2':
				md += `## ${inner}\n\n`;
				break;
			case 'h3':
				md += `### ${inner}\n\n`;
				break;
			case 'h4':
				md += `#### ${inner}\n\n`;
				break;
			case 'h5':
				md += `##### ${inner}\n\n`;
				break;
			case 'h6':
				md += `###### ${inner}\n\n`;
				break;
			case 'p':
				md += `${escapeLineStarts(inner)}\n\n`;
				break;
			case 'strong':
			case 'b':
				md += `**${inner}**`;
				break;
			case 'em':
			case 'i':
				md += `*${inner}*`;
				break;
			case 'u':
				md += `<u>${inner}</u>`;
				break;
			case 's':
			case 'strike':
				md += `~~${inner}~~`;
				break;
			case 'a': {
				// As in the RTF: only a web, mail or phone address is a link; a javascript:
				// address, which a Markdown viewer would run, is written as its text alone.
				const target = linkTarget((node as Element).getAttribute('href') || '');
				md += target ? `[${inner}](${markdownUrl(target)})` : inner;
				break;
			}
			case 'img':
				md += imageToMarkdown((node as HTMLImageElement).getAttribute('alt') || '', (node as HTMLImageElement).getAttribute('src') || '', ctx);
				break;
			case 'figure': {
				// The caption and the description are text like any other, so a "[x](javascript:…)"
				// in either stays text. A figure with no picture keeps what it holds.
				const img = (node as Element).querySelector('img');
				const caption = ((node as Element).querySelector('figcaption')?.textContent || '').trim();
				if (img) md += `${imageToMarkdown(img.getAttribute('alt') || caption, img.getAttribute('src') || '', ctx)}\n\n`;
				else {
					const held = childrenToMarkdown(node as HTMLElement, ctx);
					if (held.trim()) md += held.endsWith('\n\n') ? held : `${held.replace(/\n*$/, '')}\n\n`;
				}
				if (caption) md += `*${escapeMarkdown(caption, ctx)}*\n\n`;
				break;
			}
			case 'figcaption':
				// Rendered by the enclosing <figure>.
				break;
			case 'blockquote':
				md += `> ${inner.trim()}\n\n`;
				break;
			case 'pre': {
				const code = node.textContent || '';
				if (ctx.inCell) {
					// A table cell holds one line: each line of the block is a code span of its own.
					md += code.split(/\r\n|\r|\n/).map((line) => (line ? codeSpan(line, ctx) : '')).join('<br>');
					break;
				}
				const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
				const fence = '`'.repeat(longest + 1);
				md += `${blockStart(md)}${fence}\n${code}\n${fence}\n\n`;
				break;
			}
			case 'code':
				md += codeSpan(node.textContent || '', ctx);
				break;
			case 'ul':
				md += blockStart(md);
				(node as Element).querySelectorAll(':scope > li').forEach((li) => {
					md += listItem('- ', childrenToMarkdown(li as HTMLElement, ctx));
				});
				md += '\n';
				break;
			case 'ol': {
				md += blockStart(md);
				const start = parseInt((node as Element).getAttribute('start') ?? '', 10);
				let i = Number.isFinite(start) ? start : 1;
				(node as Element).querySelectorAll(':scope > li').forEach((li) => {
					md += listItem(`${i++}. `, childrenToMarkdown(li as HTMLElement, ctx));
				});
				md += '\n';
				break;
			}
			case 'li':
				md += inner;
				break;
			case 'br':
				md += '\n';
				break;
			case 'hr':
				md += '\n---\n\n';
				break;
			case 'table':
				// Markdown cannot put a table in a table cell: the inner one is its rows as lines,
				// its cells a slash apart, as the RTF writes them a tab apart.
				md += ctx.inCell ? nestedTableToText(node as HTMLElement, ctx) : `${blockStart(md)}${tableToMarkdown(node as HTMLElement)}`;
				break;
			case 'div':
				md += `${escapeLineStarts(inner)}\n`;
				break;
			default:
				md += inner;
				break;
		}
	});

	return md;
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
