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

export function htmlToMarkdown(el: HTMLElement): string {
	return childrenToMarkdown(el, { inCell: false });
}

function childrenToMarkdown(el: HTMLElement, ctx: MarkdownContext): string {
	let md = '';

	el.childNodes.forEach((node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			md += escapeMarkdown(node.textContent || '', ctx);
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
				md += target ? `[${inner}](${target.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : inner;
				break;
			}
			case 'img':
				md += `![${(node as HTMLImageElement).alt || ''}](${(node as HTMLImageElement).src || ''})`;
				break;
			case 'figure': {
				const img = (node as Element).querySelector('img');
				const caption = ((node as Element).querySelector('figcaption')?.textContent || '').trim();
				if (img) {
					md += `![${img.getAttribute('alt') || caption}](${img.getAttribute('src') || ''})\n\n`;
					if (caption) md += `*${caption}*\n\n`;
				}
				break;
			}
			case 'figcaption':
				// Rendered by the enclosing <figure>.
				break;
			case 'blockquote':
				md += `> ${inner.trim()}\n\n`;
				break;
			case 'pre':
				md += `\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
				break;
			case 'code':
				md += `\`${node.textContent}\``;
				break;
			case 'ul':
				(node as Element).querySelectorAll(':scope > li').forEach((li) => {
					md += `- ${childrenToMarkdown(li as HTMLElement, ctx).trim()}\n`;
				});
				md += '\n';
				break;
			case 'ol': {
				const start = parseInt((node as Element).getAttribute('start') ?? '', 10);
				let i = Number.isFinite(start) ? start : 1;
				(node as Element).querySelectorAll(':scope > li').forEach((li) => {
					md += `${i++}. ${childrenToMarkdown(li as HTMLElement, ctx).trim()}\n`;
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
				md += tableToMarkdown(node as HTMLElement);
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
