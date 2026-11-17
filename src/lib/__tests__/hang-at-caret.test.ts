import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

/**
 * Hang at caret: the hanging indent is set to where the caret is, so the lines after the first
 * begin under it. happy-dom lays nothing out, so the caret's and the paragraph's positions are
 * given here; the real geometry was checked in Chromium, WebKit and Firefox. Also: what a paste
 * brings in is tidied. Invented text.
 */

// happy-dom lacks the toolbar's state queries.
const doc = document as Document & {
	queryCommandState?: () => boolean;
	queryCommandValue?: () => string;
};
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

type Editor = { setHTML(html: string): void; getRTF(): string };

let host: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
	vi.restoreAllMocks();
});

function open(content: string): { editor: HTMLElement; api: Editor } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false } }) as Record<string, unknown>;
	flushSync();
	return { editor: host.querySelector('.ink-content') as HTMLElement, api: component as unknown as Editor };
}

const rect = (left: number) => ({ left, right: left, top: 0, bottom: 20, width: 0, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

/**
 * The page's left edge is at 100px. The caret is `caretX` px from the window's left, and each
 * paragraph's box starts at the edge plus its own left margin, as a browser lays it out.
 */
function layout(caretX: number): void {
	vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([rect(caretX)] as unknown as DOMRectList);
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		return rect(100 + (parseFloat(this.style.marginLeft) || 0));
	});
}

function caretIn(editor: HTMLElement, text: string, offset: number): void {
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if ((n as Text).data === text) {
			window.getSelection()!.setBaseAndExtent(n, offset, n, offset);
			return;
		}
	}
	throw new Error(`no text ${text}`);
}

function hang(): void {
	(host!.querySelector('button[title="Hang at caret"]') as HTMLButtonElement).click();
	flushSync();
}

function undo(editor: HTMLElement): void {
	editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
	flushSync();
}

describe('Hang at caret', () => {
	it('the later lines begin under the caret and the first line stays where it starts', () => {
		const { editor, api } = open('<p>A. Pancreas: text</p>');
		layout(220);
		caretIn(editor, 'A. Pancreas: text', 13);
		hang();
		expect(editor.innerHTML).toBe('<p style="margin-left: 120px; text-indent: -120px;">A. Pancreas: text</p>');
		expect(api.getRTF()).toContain('\\pard\\li1800\\fi-1800 A. Pancreas: text\\par ');
	});

	it('keeps an indent the paragraph already has: only the later lines move', () => {
		const { editor, api } = open('<p style="margin-left: 48px">A. Pancreas: text</p>');
		layout(268);
		caretIn(editor, 'A. Pancreas: text', 13);
		hang();
		expect(api.getRTF()).toContain('\\pard\\li2520\\fi-1800 A. Pancreas: text\\par ');
	});

	it('replaces an earlier hang, measured from where the first line starts', () => {
		const { editor, api } = open('<p style="margin-left: 96px; text-indent: -48px">A. Pancreas: text</p>');
		layout(268);
		caretIn(editor, 'A. Pancreas: text', 13);
		hang();
		expect(api.getRTF()).toContain('\\pard\\li2520\\fi-1800 A. Pancreas: text\\par ');
	});

	it('with the caret at the start of the line, takes the hang away and keeps the indent', () => {
		const { editor } = open('<p style="margin-left: 96px; text-indent: -48px">A. Pancreas: text</p>');
		layout(148);
		caretIn(editor, 'A. Pancreas: text', 0);
		hang();
		expect(editor.innerHTML).toBe('<p style="margin-left: 48px;">A. Pancreas: text</p>');
	});

	it('after a tab, puts a tab stop at the new indent, on screen and in the RTF', () => {
		const { editor, api } = open('<p>A.<span style="white-space:pre">\t</span>text</p>');
		layout(148);
		caretIn(editor, 'text', 0);
		hang();
		const p = editor.querySelector('p')!;
		expect(p.getAttribute('data-rtf-tab-stops')).toBe('48px');
		expect(p.style.tabSize).toBe('48px');
		expect(api.getRTF()).toContain('\\pard\\tx720\\li720\\fi-720 A.\\tab text\\par ');
	});

	it('Undo puts the paragraph back, tab stop included', () => {
		const { editor } = open('<p>A.<span style="white-space:pre">\t</span>text</p>');
		const before = editor.innerHTML;
		layout(148);
		caretIn(editor, 'text', 0);
		hang();
		undo(editor);
		expect(editor.innerHTML).toBe(before);
	});

	it('gives a line of loose text a paragraph, and Undo takes it away', () => {
		const { editor } = open('A. Pancreas: text<br>next');
		layout(220);
		caretIn(editor, 'A. Pancreas: text', 13);
		hang();
		expect(editor.innerHTML).toBe('<p style="margin-left: 120px; text-indent: -120px;">A. Pancreas: text</p>next');
		undo(editor);
		expect(editor.innerHTML).toBe('A. Pancreas: text<br>next');
	});

	it.each([
		['a centered paragraph', '<p style="text-align: center">A. Pancreas: text</p>'],
		['a heading', '<h2>A. Pancreas: text</h2>'],
		['a list item', '<ul><li>A. Pancreas: text</li></ul>'],
		['a table cell', '<table><tbody><tr><td><p>A. Pancreas: text</p></td></tr></tbody></table>']
	])('leaves %s alone', (_name, html) => {
		const { editor } = open(html);
		layout(220);
		caretIn(editor, 'A. Pancreas: text', 13);
		hang();
		expect(editor.innerHTML).toBe(html);
	});
});

describe('what a paste brings in', () => {
	function paste(editor: HTMLElement, html: string, into: Element = editor): void {
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		into.insertAdjacentHTML('beforeend', html);
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	it('a pasted copy does not repeat the id of the paragraph it was copied from', () => {
		const { editor } = open('<p id="a">one</p>');
		paste(editor, '<p id="a">one</p>');
		expect(editor.querySelectorAll('#a').length).toBe(1);
		expect(editor.firstElementChild!.id).toBe('a');
	});

	it('keeps the indents that show, and drops a first-line indent on text inside a line', () => {
		const { editor } = open('<p>one</p>');
		paste(editor, '<p style="margin-left: 96px; text-indent: -48px;">two</p>');
		expect(editor.lastElementChild!.getAttribute('style')).toBe('margin-left: 96px; text-indent: -48px;');
		paste(editor, '<span style="text-indent: -48px;">three</span>', editor.firstElementChild!);
		expect(editor.querySelector('span')!.hasAttribute('style')).toBe(false);
	});

	it('leaves what was already there alone', () => {
		const { editor } = open('<p id="a" style="margin-top: 0px">one</p>');
		paste(editor, '<p>two</p>');
		expect(editor.firstElementChild!.outerHTML).toBe('<p id="a" style="margin-top: 0px">one</p>');
	});
});
