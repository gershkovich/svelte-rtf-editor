import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * The size of text: the toolbar's size list, what it leaves in the document, and what the RTF
 * carries. The editor asks the browser's own font-size command to mark the selection (as
 * <font size="7">, the only kind of size that command knows) and then gives what was marked the
 * size meant, in points. The test DOM has no such command, so one is stood in here that marks
 * the selection the way Chromium does. What Chromium really makes (across paragraphs, over text
 * that has a size already, with undo) was checked in Chromium 156. Invented text.
 */

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** The body of an RTF document: what follows the first paragraph's font and size. */
const body = (rtf: string) => rtf.slice(rtf.indexOf('\\fs24 ') + 6, -1);

describe('htmlToRtf: the size of text', () => {
	it('a size in points on any element in a line is written, and the body size comes back after it', () => {
		expect(body(htmlToRtf(el('<p>Margin <font style="font-size: 16pt;">clear</font> at 2 mm</p>')))).toBe(
			'\\pard Margin \\fs32 clear\\fs24  at 2 mm\\par '
		);
		expect(body(htmlToRtf(el('<p><span style="font-size:9pt">Note</span></p>')))).toBe('\\pard \\fs18 Note\\fs24 \\par ');
		expect(body(htmlToRtf(el('<p><font style="font-size:10.5pt">Half</font></p>')))).toContain('\\fs21 Half');
	});

	it('a size of 1em, which is what setting text back to the size around it leaves, writes none; nor does no size', () => {
		expect(body(htmlToRtf(el('<p>Margin <font style="font-size: 1em;">clear</font></p>')))).toBe('\\pard Margin clear\\par ');
		expect(body(htmlToRtf(el('<p>Margin <font>clear</font></p>')))).toBe('\\pard Margin clear\\par ');
		expect(body(htmlToRtf(el('<h1>Final <font style="font-size: 1em;">diagnosis</font></h1>')))).not.toMatch(/\\fs\d+ diagnosis/);
	});

	it('inside a heading, the heading size comes back after it', () => {
		expect(body(htmlToRtf(el('<h1>Final <font style="font-size:12pt">diagnosis</font> A</h1>')))).toContain(
			'Final \\fs24 diagnosis\\fs48  A'
		);
	});

	it('<font size="1"> to <font size="7">, as older pages and mail carry sizes, are the sizes a browser shows', () => {
		const sizes = [1, 2, 3, 4, 5, 6, 7].map((n) => /\\fs(\d+) x/.exec(htmlToRtf(el(`<p>a<font size="${n}">x</font></p>`)))?.[1]);
		expect(sizes).toEqual(['15', '20', '24', '27', '36', '48', '72']);
	});

	it('a size it cannot read is not written: a relative one, or none', () => {
		for (const size of ['+1', '-2', '8', '0', '', 'large']) {
			expect(body(htmlToRtf(el(`<p>a<font size="${size}">x</font></p>`))), size).toBe('\\pard ax\\par ');
		}
		expect(body(htmlToRtf(el('<p>a<span size="5">x</span></p>')))).toBe('\\pard ax\\par ');
	});

	it('a size in the style is the one that counts when both are there', () => {
		expect(body(htmlToRtf(el('<p><font size="7" style="font-size:11pt">x</font></p>')))).toBe('\\pard \\fs22 x\\fs24 \\par ');
	});

	it('the size estimate is never below the real size for either kind', () => {
		for (const html of [
			`<p>${'<font style="font-size: 16pt;">a</font>'.repeat(40)}</p>`,
			`<p>${'<font size="7">a</font>'.repeat(40)}</p>`,
			`<h2>${'<font size="1">a</font><font style="font-size:128pt">b</font>'.repeat(20)}</h2>`
		]) {
			const root = el(html);
			expect(estimateRtfBytes(root), html.slice(0, 40)).toBeGreaterThanOrEqual(htmlToRtf(root).length);
		}
	});
});

describe('a size through the RTF and back', () => {
	const back = (html: string) => rtfToHtml(htmlToRtf(el(html)));

	it('text keeps its size, and the text around it has none', () => {
		expect(back('<p>Margin <font style="font-size: 16pt;">clear</font> at 2 mm</p>')).toBe(
			'<p>Margin <span style="font-size:16pt">clear</span> at 2 mm</p>'
		);
	});

	it('a whole paragraph made larger stays a paragraph of that size', () => {
		expect(back('<p><font style="font-size: 18pt;">Addendum</font></p>')).toBe('<p><span style="font-size:18pt">Addendum</span></p>');
	});

	it('made larger and bold, at a size a heading has, it is read back as that heading: it looks the same', () => {
		expect(back('<p><b><font style="font-size: 18pt;">Addendum</font></b></p>')).toBe('<h2>Addendum</h2>');
		// At a size between two headings it is the smaller heading, with its own size stated.
		expect(back('<p><b><font style="font-size: 16pt;">Addendum</font></b></p>')).toBe('<h3><span style="font-size:16pt">Addendum</span></h3>');
	});
});

// ── The editor ────────────────────────────────────────────────────────────────

interface EditorApi {
	getHTML: () => string;
	getRTF: () => string;
	setFontSize: (points: number) => void;
}

let host: HTMLDivElement;
let editor: EditorApi | null = null;
/** The size command's calls, and what a caret would carry into the next typing. */
let asked: string[] = [];

/**
 * The browser's font-size command, as far as these tests need it: the selected text of one text
 * node is wrapped in <font size="N">; a size already on a <font> the selection covers is replaced.
 */
function fontSizeCommand(size: string): boolean {
	asked.push(size);
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return true;
	const range = selection.getRangeAt(0);
	const start = range.startContainer;
	const sized = (start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement)?.closest('font');
	if (sized && range.toString() === sized.textContent) {
		sized.setAttribute('size', size);
		sized.setAttribute('style', '');
		return true;
	}
	const font = document.createElement('font');
	font.setAttribute('size', size);
	font.appendChild(range.extractContents());
	range.insertNode(font);
	selection.removeAllRanges();
	const again = document.createRange();
	again.selectNodeContents(font);
	selection.addRange(again);
	return true;
}

function mountEditor(props: Record<string, unknown> = {}): void {
	editor = mount(InkEditor, {
		target: host,
		props: { autosave: false, content: '<p>Report body text</p>', ...props }
	}) as unknown as EditorApi;
	flushSync();
}

const contentEl = () => host.querySelector('.ink-content') as HTMLElement;
const sizeList = () => host.querySelector('select.tb-size') as HTMLSelectElement | null;
const offered = () => Array.from(sizeList()!.options).map((o) => o.value).filter(Boolean);

/** Select part of the first text node of an element, the way a drag with the mouse does. */
function selectText(target: Element, from: number, to: number): void {
	const text = target.firstChild!;
	const range = document.createRange();
	range.setStart(text, from);
	range.setEnd(text, to);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	contentEl().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
	flushSync();
}

function choose(points: number): void {
	const list = sizeList()!;
	list.value = String(points);
	list.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

/** The test DOM does not work out sizes from styles: the size of an element is its own, or its nearest sized ancestor's, or the body's. */
function sizesFromStyles(bodyPoints = 12): void {
	vi.spyOn(window, 'getComputedStyle').mockImplementation(((target: Element) => {
		let points = bodyPoints;
		for (let at: Element | null = target; at && !at.classList.contains('ink-content'); at = at.parentElement) {
			const own = /([\d.]+)pt/.exec((at as HTMLElement).style?.fontSize ?? '');
			if (own) {
				points = Number(own[1]);
				break;
			}
			if (at.tagName === 'H1') {
				points = bodyPoints * 2;
				break;
			}
		}
		return { fontSize: `${points / 0.75}px`, getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
	}) as typeof window.getComputedStyle);
}

beforeEach(() => {
	asked = [];
	const doc = document as Document & { queryCommandState?: unknown; queryCommandValue?: unknown; execCommand?: unknown };
	doc.queryCommandState = () => false;
	doc.queryCommandValue = () => '';
	doc.execCommand = (command: string, _ui?: boolean, value?: string) => (command === 'fontSize' ? fontSizeCommand(value ?? '') : false);
	host = document.createElement('div');
	document.body.appendChild(host);
});

afterEach(() => {
	if (editor) unmount(editor as never);
	editor = null;
	host.remove();
	vi.restoreAllMocks();
});

describe('InkEditor: the size list in the toolbar', () => {
	it('offers the usual sizes, and always the body size', () => {
		mountEditor();
		expect(offered()).toEqual(['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36']);
		expect(sizeList()!.getAttribute('aria-label')).toBe('Font size');
	});

	it('a body size that is not one of them is added in its place', () => {
		mountEditor({ fontSize: 10.5 });
		expect(offered()).toEqual(['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '20', '24', '28', '36']);
	});

	it('offers the sizes it is given', () => {
		mountEditor({ fontSizes: [10, 12, 14] });
		expect(offered()).toEqual(['10', '12', '14']);
	});

	it('is not there with no sizes to offer, or with no toolbar', () => {
		mountEditor({ fontSizes: [] });
		expect(sizeList()).toBeNull();
		unmount(editor as never);
		editor = null;
		host.innerHTML = '';
		mountEditor({ showToolbar: false });
		expect(sizeList()).toBeNull();
	});
});

describe('InkEditor: setting the size of selected text', () => {
	it('gives the selected text the size chosen, in points, and the RTF carries it', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);

		expect(contentEl().innerHTML).toBe('<p>Report <font style="font-size: 16pt;">body</font> text</p>');
		expect(editor!.getRTF()).toContain('Report \\fs32 body\\fs24  text');
	});

	it('asks the browser for the one size nothing else makes, and leaves no trace of that size', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(9);

		expect(asked).toEqual(['7']);
		expect(contentEl().querySelector('font')!.hasAttribute('size')).toBe(false);
		expect(editor!.getRTF()).not.toContain('\\fs72');
	});

	it('a second size on the same text takes the place of the first', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		choose(10);

		expect(contentEl().innerHTML).toBe('<p>Report <font style="font-size: 10pt;">body</font> text</p>');
	});

	it('set back to the size the text around it has, it is the size around it (1em), and follows the document again', () => {
		sizesFromStyles();
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		choose(12);

		expect(contentEl().innerHTML).toBe('<p>Report <font style="font-size: 1em;">body</font> text</p>');
		expect(editor!.getRTF()).toContain('\\pard Report body text\\par ');
	});

	it('in a heading the size of the text around it is the heading\'s: 12 pt is stated there, and 24 pt is not', () => {
		sizesFromStyles();
		mountEditor({ content: '<h1>Final diagnosis</h1>' });
		selectText(contentEl().querySelector('h1')!, 6, 15);
		choose(12);
		expect(contentEl().innerHTML).toBe('<h1>Final <font style="font-size: 12pt;">diagnosis</font></h1>');
		choose(24);
		expect(contentEl().innerHTML).toBe('<h1>Final <font style="font-size: 1em;">diagnosis</font></h1>');
	});

	it('text that came in marked size 7, from an old page, is not taken for the selection', () => {
		mountEditor({ content: '<p>Report body text</p><p><font size="7">Old page</font></p>' });
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);

		expect(contentEl().querySelectorAll('p')[1].innerHTML).toBe('<font size="7">Old page</font>');
		expect(editor!.getRTF()).toContain('\\fs72 Old page');
	});

	it('the editor\'s own setFontSize does the same, for a host with its own toolbar', () => {
		mountEditor({ showToolbar: false });
		selectText(contentEl().querySelector('p')!, 0, 6);
		editor!.setFontSize(14);
		flushSync();

		expect(contentEl().innerHTML).toBe('<p><font style="font-size: 14pt;">Report</font> body text</p>');
	});

	it('a size that is no size is not set, and a half-point is kept', () => {
		mountEditor({ showToolbar: false });
		selectText(contentEl().querySelector('p')!, 0, 6);
		for (const size of [0, -4, NaN, Infinity]) editor!.setFontSize(size);
		expect(asked).toEqual([]);
		editor!.setFontSize(10.5);
		expect(contentEl().querySelector('font')!.style.fontSize).toBe('10.5pt');
	});

	it('a read-only editor does nothing', () => {
		mountEditor({ readonly: true });
		selectText(contentEl().querySelector('p')!, 0, 6);
		editor!.setFontSize(14);

		expect(asked).toEqual([]);
		expect(contentEl().innerHTML).toBe('<p>Report body text</p>');
	});

	it('tells the host the document changed', () => {
		const changes: string[] = [];
		mountEditor({ onchange: (payload: { html: string }) => changes.push(payload.html) });
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);

		expect(changes[changes.length - 1]).toContain('font-size: 16pt');
	});
});

describe('InkEditor: a change of size through undo and redo', () => {
	// Found by clicking the real Undo and Redo buttons in Chromium. The browser undoes and redoes
	// its own step: the element it made, the size it took off one, and the mark for size 7. It
	// knows nothing of the size given afterwards. What it does at each step is stood in here, as
	// Chromium 156 was seen to do it, followed by the input event it sends.

	const history = (kind: 'historyUndo' | 'historyRedo', change: () => void) => {
		change();
		const event = new Event('input', { bubbles: true });
		Object.defineProperty(event, 'inputType', { value: kind });
		contentEl().dispatchEvent(event);
		flushSync();
	};
	const typed = () => {
		const event = new Event('input', { bubbles: true });
		Object.defineProperty(event, 'inputType', { value: 'insertText' });
		contentEl().dispatchEvent(event);
		flushSync();
	};
	/** The browser redoing a change of size on an element that was there: it marks it and takes its size off. */
	const markAgain = (font: HTMLElement) => {
		font.setAttribute('size', '7');
		font.style.removeProperty('font-size');
	};

	it('a redone change gets its size again: it came back as the mark alone, at 36 pt', async () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		choose(9);
		const font = contentEl().querySelector('font') as HTMLElement;

		history('historyUndo', () => (font.style.fontSize = '16pt'));
		expect(font.style.fontSize).toBe('16pt');
		history('historyRedo', () => markAgain(font));

		expect(font.hasAttribute('size')).toBe(false);
		expect(font.style.fontSize).toBe('9pt');
		expect(editor!.getRTF()).toContain('\\fs18 body');
		expect(editor!.getRTF()).not.toContain('\\fs72');
	});

	it('three sizes, all undone and all redone, come back in order', () => {
		mountEditor();
		const p = contentEl().querySelector('p')!;
		selectText(p, 7, 11);
		choose(16);
		choose(9);
		choose(20);
		const font = contentEl().querySelector('font') as HTMLElement;
		const text = font.firstChild!;

		history('historyUndo', () => (font.style.fontSize = '9pt'));
		history('historyUndo', () => (font.style.fontSize = '16pt'));
		history('historyUndo', () => font.replaceWith(text));
		expect(p.innerHTML).toBe('Report body text');

		history('historyRedo', () => {
			text.parentNode!.insertBefore(font, text);
			font.appendChild(text);
		});
		expect(font.style.fontSize).toBe('16pt');
		history('historyRedo', () => markAgain(font));
		expect(font.style.fontSize).toBe('9pt');
		history('historyRedo', () => markAgain(font));
		expect(font.style.fontSize).toBe('20pt');
		expect(font.hasAttribute('size')).toBe(false);
	});

	it('undone, redone, undone and redone again', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		choose(9);
		const font = contentEl().querySelector('font') as HTMLElement;

		for (let round = 0; round < 3; round++) {
			history('historyUndo', () => (font.style.fontSize = '16pt'));
			history('historyRedo', () => markAgain(font));
			expect(font.style.fontSize, `round ${round}`).toBe('9pt');
		}
	});

	it('the toolbar\'s own Undo and Redo buttons do the same', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		choose(9);
		const font = contentEl().querySelector('font') as HTMLElement;
		const doc = document as unknown as { execCommand: (command: string, ui?: boolean, value?: string) => boolean };
		const before = doc.execCommand;
		doc.execCommand = (command, ui, value) => {
			if (command === 'undo') font.style.fontSize = '16pt';
			else if (command === 'redo') markAgain(font);
			else return before(command, ui, value);
			return true;
		};
		(host.querySelector('button[title="Undo (Ctrl+Z)"]') as HTMLElement).click();
		flushSync();
		expect(font.style.fontSize).toBe('16pt');
		(host.querySelector('button[title="Redo"]') as HTMLElement).click();
		flushSync();

		expect(font.hasAttribute('size')).toBe(false);
		expect(font.style.fontSize).toBe('9pt');
	});

	it('other edits undone and redone in between do not lose the place', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		choose(9);
		const font = contentEl().querySelector('font') as HTMLElement;
		const p = contentEl().querySelector('p')!;

		// A word is typed after the two changes, and everything is undone.
		p.append(' more');
		typed();
		history('historyUndo', () => p.lastChild!.remove());
		history('historyUndo', () => (font.style.fontSize = '16pt'));
		// Redone: the change of size, then the typing.
		history('historyRedo', () => markAgain(font));
		expect(font.style.fontSize).toBe('9pt');
		history('historyRedo', () => p.append(' more'));
		expect(font.style.fontSize).toBe('9pt');
	});

	it('after a new edit, what was undone cannot be redone: a mark that comes with no change to go with it is taken off', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		choose(9);
		const font = contentEl().querySelector('font') as HTMLElement;
		history('historyUndo', () => (font.style.fontSize = '16pt'));
		contentEl().querySelector('p')!.append('!');
		typed();

		history('historyRedo', () => markAgain(font));

		// Not 36 pt: the size of the text around it.
		expect(font.hasAttribute('size')).toBe(false);
		expect(font.style.fontSize).toBe('1em');
	});

	it('a new size chosen after an undo takes the place of the one that was undone', () => {
		mountEditor();
		const p = contentEl().querySelector('p')!;
		selectText(p, 7, 11);
		choose(16);
		choose(9);
		const font = contentEl().querySelector('font') as HTMLElement;
		const text = font.firstChild!;
		history('historyUndo', () => (font.style.fontSize = '16pt'));
		// 9 pt can no longer be redone: 20 pt is the change after 16 pt now.
		selectText(font, 0, 4);
		choose(20);

		history('historyUndo', () => (font.style.fontSize = '16pt'));
		history('historyUndo', () => font.replaceWith(text));
		history('historyRedo', () => {
			text.parentNode!.insertBefore(font, text);
			font.appendChild(text);
		});
		history('historyRedo', () => markAgain(font));

		expect(font.style.fontSize).toBe('20pt');
	});

	it('text that came in marked size 7 from an old page is left alone by undo and redo', () => {
		mountEditor({ content: '<p>Report body text</p><p><font size="7">Old page</font></p>' });
		selectText(contentEl().querySelector('p')!, 7, 11);
		choose(16);
		const font = contentEl().querySelector('font') as HTMLElement;
		history('historyUndo', () => font.replaceWith(font.firstChild!));

		expect(contentEl().querySelectorAll('p')[1].innerHTML).toBe('<font size="7">Old page</font>');
	});

	it('a <font> element that was there with no size is given 1em before the change, so that undo has a size to put back', () => {
		// The browser may use such an element for the change, and records only the size it takes off.
		mountEditor({ content: '<p><font color="#ff0000">Report</font> body text</p>' });
		const p = contentEl().querySelector('p')!;
		const range = document.createRange();
		range.setStart(p.lastChild!, 1);
		range.setEnd(p.lastChild!, 5);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		contentEl().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		flushSync();
		choose(16);

		expect((contentEl().querySelector('font[color]') as HTMLElement).style.fontSize).toBe('1em');
		expect(editor!.getRTF()).toContain('Report');
		expect(editor!.getRTF()).not.toMatch(/\\fs\d+ Report/);
	});

	it('choosing the size the selected text already has changes nothing, and makes no step to undo', () => {
		sizesFromStyles();
		mountEditor({ content: '<p>Report <font style="font-size: 16pt;">body</font> text</p>' });
		selectText(contentEl().querySelector('font')!, 0, 4);
		choose(16);
		selectText(contentEl().querySelector('p')!, 0, 6);
		choose(12);

		expect(asked).toEqual([]);
		expect(contentEl().innerHTML).toBe('<p>Report <font style="font-size: 16pt;">body</font> text</p>');
	});
});

describe('InkEditor: a size chosen at a caret', () => {
	/** What the browser does when text is typed after the command: the text comes in marked. */
	function type(text: string): void {
		const p = contentEl().querySelector('p')!;
		p.insertAdjacentHTML('beforeend', `<font size="7">${text}</font>`);
		contentEl().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	it('is the size of what is typed next', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 16, 16);
		choose(18);
		type(' and more');

		expect(contentEl().innerHTML).toBe('<p>Report body text<font style="font-size: 18pt;"> and more</font></p>');
	});

	it('the list shows the size chosen while nothing is typed yet', () => {
		sizesFromStyles();
		mountEditor();
		selectText(contentEl().querySelector('p')!, 16, 16);
		expect(sizeList()!.value).toBe('12');
		choose(18);
		expect(sizeList()!.value).toBe('18');
	});

	it('is given up when the caret is moved before anything is typed', () => {
		sizesFromStyles();
		mountEditor();
		selectText(contentEl().querySelector('p')!, 16, 16);
		choose(18);
		contentEl().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		flushSync();
		expect(sizeList()!.value).toBe('12');

		// Text marked size 7 that arrives now is somebody's own, not ours to size.
		type('pasted');
		expect(contentEl().querySelector('font')!.getAttribute('size')).toBe('7');
	});

	it('applies once: what is typed after that is not sized again', () => {
		mountEditor();
		selectText(contentEl().querySelector('p')!, 16, 16);
		choose(18);
		type('a');
		type('b');

		const fonts = contentEl().querySelectorAll('font');
		expect(fonts[0].style.fontSize).toBe('18pt');
		expect(fonts[1].getAttribute('size')).toBe('7');
	});
});

describe('InkEditor: the size the list shows', () => {
	beforeEach(() => sizesFromStyles());

	it('is the size of the text at the caret', () => {
		mountEditor({ content: '<p>Report <font style="font-size: 16pt;">body</font> text</p>' });
		selectText(contentEl().querySelector('font')!, 2, 2);
		expect(sizeList()!.value).toBe('16');
		selectText(contentEl().querySelector('p')!, 2, 2);
		expect(sizeList()!.value).toBe('12');
	});

	it('a size that is not on the list is shown all the same, in its place', () => {
		mountEditor({ content: '<p><span style="font-size: 13.5pt;">From elsewhere</span></p>' });
		selectText(contentEl().querySelector('span')!, 2, 2);

		expect(sizeList()!.value).toBe('13.5');
		expect(offered()).toContain('13.5');
		expect(offered().indexOf('13.5')).toBe(offered().indexOf('12') + 1);
	});

	it('is empty where the selection starts in one size and ends in another', () => {
		mountEditor({ content: '<p>Report <font style="font-size: 16pt;">body</font></p>' });
		const range = document.createRange();
		range.setStart(contentEl().querySelector('p')!.firstChild!, 2);
		range.setEnd(contentEl().querySelector('font')!.firstChild!, 3);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		contentEl().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		flushSync();

		expect(sizeList()!.value).toBe('');
	});

	it('in a heading it is the heading\'s size', () => {
		mountEditor({ content: '<h1>Final diagnosis</h1>' });
		selectText(contentEl().querySelector('h1')!, 3, 3);
		expect(sizeList()!.value).toBe('24');
	});
});
