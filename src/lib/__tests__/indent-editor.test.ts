import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

/**
 * Increase indent and Decrease indent in the editor (Ctrl+] and Ctrl+[): which blocks move, what
 * Undo puts back, and that the editor never reaches outside itself. Invented text.
 */

// happy-dom lacks the toolbar's state queries.
const doc = document as Document & {
	queryCommandState?: () => boolean;
	queryCommandValue?: () => string;
};
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

const CHROME_INDENT = 'margin: 0 0 0 40px; border: none; padding: 0px;';

type Editor = { setHTML(html: string): void; getRTF(): string };

let host: HTMLElement | null = null;
let outer: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	(outer ?? host)?.remove();
	component = null;
	host = null;
	outer = null;
});

function open(content: string, parent: HTMLElement = document.body): { editor: HTMLElement; api: Editor } {
	host = document.createElement('div');
	parent.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false } }) as Record<string, unknown>;
	flushSync();
	return { editor: host.querySelector('.ink-content') as HTMLElement, api: component as unknown as Editor };
}

function press(editor: HTMLElement, key: string): KeyboardEvent {
	const e = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
	editor.dispatchEvent(e);
	flushSync();
	return e;
}

function select(start: Node, startOffset: number, end: Node = start, endOffset: number = startOffset): void {
	window.getSelection()!.setBaseAndExtent(start, startOffset, end, endOffset);
}

function textOf(editor: HTMLElement, text: string): Text {
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data === text) return n as Text;
	throw new Error(`no text ${text}`);
}

describe('Increase and Decrease indent', () => {
	it('moves a Quote block as a whole, without wrapping it in a paragraph', () => {
		const { editor, api } = open('<blockquote>q</blockquote>');
		select(textOf(editor, 'q'), 0);
		press(editor, ']');
		const quote = editor.querySelector('blockquote')!;
		expect(quote.style.marginLeft).toBe('48px');
		expect(quote.parentElement).toBe(editor);
		expect(api.getRTF()).toContain('\\pard\\li1440\\i q\\i0\\par ');
	});

	it('decreases an indent pasted from Chromium, held on the blockquote around the line', () => {
		const { editor, api } = open(`<blockquote style="${CHROME_INDENT}"><p>one</p></blockquote>`);
		select(textOf(editor, 'one'), 1);
		press(editor, '[');
		expect(editor.querySelector('blockquote')!.style.marginLeft).toBe('');
		expect(api.getRTF()).toContain('\\pard one\\par ');
		expect(api.getRTF()).not.toContain('\\i ');
	});

	it('reads a margin in inches as inches', () => {
		const { editor } = open('<p style="margin-left: 1in;">x</p>');
		select(textOf(editor, 'x'), 0);
		press(editor, ']');
		expect(editor.querySelector('p')!.style.marginLeft).toBe('144px');
	});

	it('moves loose text on every press, and Undo takes it back to loose text', () => {
		const { editor } = open('abc<div>def</div>');
		const abc = textOf(editor, 'abc');
		select(abc, 0, abc, 3);
		press(editor, ']');
		press(editor, ']');
		const p = editor.firstElementChild as HTMLElement;
		expect(p.tagName).toBe('P');
		expect(p.style.marginLeft).toBe('96px');
		expect(p.textContent).toBe('abc');
		expect(press(editor, 'z').defaultPrevented).toBe(true);
		expect(press(editor, 'z').defaultPrevented).toBe(true);
		expect(editor.firstChild).toBe(abc);
		expect(editor.querySelector('p')).toBeNull();
	});

	it('a selection dragged to the start of the next line does not move that line', () => {
		const { editor } = open('<p>one</p><p>two</p>');
		select(textOf(editor, 'one'), 0, textOf(editor, 'two'), 0);
		press(editor, ']');
		const [one, two] = Array.from(editor.querySelectorAll('p'));
		expect(one.style.marginLeft).toBe('48px');
		expect(two.style.marginLeft).toBe('');
	});

	it('Undo after new content is loaded is the browser’s own again', () => {
		const { editor, api } = open('<p>one</p>');
		select(textOf(editor, 'one'), 0);
		press(editor, ']');
		api.setHTML('<p>case two</p>');
		flushSync();
		expect(press(editor, 'z').defaultPrevented).toBe(false);
		expect(editor.innerHTML).toBe('<p>case two</p>');
	});

	it('a caret outside any line changes nothing, even when the page puts the editor in a table', () => {
		outer = document.createElement('table');
		const cell = outer.appendChild(document.createElement('tr')).appendChild(document.createElement('td'));
		document.body.appendChild(outer);
		const { editor } = open('<p>one</p>', cell);
		const before = cell.innerHTML;
		select(editor, 0);
		press(editor, ']');
		expect(cell.firstElementChild).toBe(host);
		expect(cell.innerHTML).toBe(before);
	});
});
