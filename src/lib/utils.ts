export function htmlToMarkdown(el: HTMLElement): string {
	let md = '';

	el.childNodes.forEach((node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			md += node.textContent;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;

		const tag = (node as Element).tagName.toLowerCase();
		const inner = htmlToMarkdown(node as HTMLElement);

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
			case 'p':
				md += `${inner}\n\n`;
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
			case 'a':
				md += `[${inner}](${(node as HTMLAnchorElement).href || ''})`;
				break;
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
				md += `\`${inner}\``;
				break;
			case 'ul':
				(node as Element).querySelectorAll(':scope > li').forEach((li) => {
					md += `- ${htmlToMarkdown(li as HTMLElement).trim()}\n`;
				});
				md += '\n';
				break;
			case 'ol': {
				let i = 1;
				(node as Element).querySelectorAll(':scope > li').forEach((li) => {
					md += `${i++}. ${htmlToMarkdown(li as HTMLElement).trim()}\n`;
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
			case 'div':
				md += `${inner}\n`;
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
