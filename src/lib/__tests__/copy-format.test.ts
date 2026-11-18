import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

/**
 * Copy format: the toolbar button, a click on the paragraph to copy from, then a click on each
 * paragraph that should get the same alignment and indents, until Escape, Done or the button
 * again. Invented text.
 */

// happy-dom lacks the toolbar's state queries.
const doc = document as Document & {
	queryCommandState?: () => boolean;
	queryCommandValue?: () => string;
};
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

type Editor = { setHTML(html: string): void; getRTF(): string; getHTML(): string };

const SOURCE = '<p style="margin-left: 96px; margin-right: 48px; text-indent: -48px; text-align: justify">source</p>';
const SOURCE_STYLE = 'margin-left: 96px; margin-right: 48px; text-indent: -48px; text-align: justify;';

let host: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
});

function open(content: string): { editor: HTMLElement; api: Editor } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false } }) as Record<string, unknown>;
	flushSync();
	return { editor: host.querySelector('.ink-content') as HTMLElement, api: component as unknown as Editor };
}

const button = () => host!.querySelector('button[title="Copy format"]') as HTMLButtonElement;
const bar = () => host!.querySelector('.ink-copy-format') as HTMLElement | null;

function click(el: Element): void {
	(el as HTMLElement).click();
	flushSync();
}

function key(target: EventTarget, k: string, ctrlKey = false): void {
	target.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey, bubbles: true, cancelable: true }));
	flushSync();
}

function para(editor: HTMLElement, text: string): HTMLElement {
	const found = Array.from(editor.querySelectorAll<HTMLElement>('p, h1, h2, h3, td, li')).find((el) => el.textContent === text);
	if (!found) throw new Error(`no paragraph ${text}`);
	return found;
}

/** Normalizes the order a style attribute lists its properties in. */
function style(el: HTMLElement): string {
	return (el.getAttribute('style') ?? '')
		.split(';')
		.map((d) => d.trim())
		.filter(Boolean)
		.sort()
		.join('; ');
}
const sorted = (css: string) => css.split(';').map((d) => d.trim()).filter(Boolean).sort().join('; ');

describe('Copy format', () => {
	it('the button picks up the brush: it shows as pressed and the editor says what to click', () => {
		const { editor } = open(`${SOURCE}<p>one</p>`);
		expect(bar()).toBeNull();
		click(button());
		expect(button().classList.contains('active')).toBe(true);
		expect(bar()!.textContent).toContain('click the paragraph to copy from');
		expect(editor.classList.contains('copy-format-pick')).toBe(true);
	});

	it('the first click copies and changes nothing; each click after it applies the format', () => {
		const { editor, api } = open(`${SOURCE}<p>one</p><p>two</p><p>three</p>`);
		click(button());
		click(para(editor, 'source'));
		expect(editor.classList.contains('copy-format-apply')).toBe(true);
		expect(bar()!.textContent).toContain('Format copied');
		expect(style(para(editor, 'source'))).toBe(sorted(SOURCE_STYLE));

		click(para(editor, 'one'));
		click(para(editor, 'three'));
		expect(style(para(editor, 'one'))).toBe(sorted(SOURCE_STYLE));
		expect(style(para(editor, 'three'))).toBe(sorted(SOURCE_STYLE));
		expect(para(editor, 'two').hasAttribute('style')).toBe(false);
		expect(api.getRTF()).toContain('\\pard\\qj\\li1440\\ri720\\fi-720 one\\par ');
		expect(api.getRTF()).toContain('\\pard two\\par ');
	});

	it('copies no format too: a plain paragraph as the source clears the ones clicked', () => {
		const { editor } = open(`<p>plain</p>${SOURCE}`);
		click(button());
		click(para(editor, 'plain'));
		click(para(editor, 'source'));
		expect(para(editor, 'source').hasAttribute('style')).toBe(false);
	});

	it.each([
		['Escape in the text', (editor: HTMLElement) => key(editor, 'Escape')],
		['Escape anywhere on the page', () => key(window, 'Escape')],
		['the Done button', () => click(host!.querySelector('.ink-copy-format-done')!)],
		['the toolbar button again', () => click(button())]
	])('%s puts the brush down: later clicks change nothing', (_name, stop) => {
		const { editor } = open(`${SOURCE}<p>one</p>`);
		click(button());
		click(para(editor, 'source'));
		stop(editor);
		expect(bar()).toBeNull();
		expect(button().classList.contains('active')).toBe(false);
		expect(editor.className).not.toContain('copy-format');
		click(para(editor, 'one'));
		expect(para(editor, 'one').hasAttribute('style')).toBe(false);
	});

	it('Cancel before anything is copied puts the brush down', () => {
		const { editor } = open(`${SOURCE}<p>one</p>`);
		click(button());
		expect(host!.querySelector('.ink-copy-format-done')!.textContent!.trim()).toBe('Cancel');
		click(host!.querySelector('.ink-copy-format-done')!);
		click(para(editor, 'one'));
		expect(bar()).toBeNull();
		expect(para(editor, 'one').hasAttribute('style')).toBe(false);
	});

	it('Undo takes back one click at a time', () => {
		const { editor } = open(`${SOURCE}<p>one</p><p>two</p>`);
		click(button());
		click(para(editor, 'source'));
		click(para(editor, 'one'));
		click(para(editor, 'two'));
		key(editor, 'z', true);
		expect(para(editor, 'two').hasAttribute('style')).toBe(false);
		expect(style(para(editor, 'one'))).toBe(sorted(SOURCE_STYLE));
		key(editor, 'z', true);
		expect(para(editor, 'one').hasAttribute('style')).toBe(false);
	});

	it('a heading takes all the indents; in a table cell a paragraph or heading takes alignment and left indent only', () => {
		const { editor } = open(
			`${SOURCE}<h2>head</h2><table><tbody><tr><td><p>cell</p><h3>cell head</h3></td></tr></tbody></table>`
		);
		click(button());
		click(para(editor, 'source'));
		click(para(editor, 'head'));
		click(editor.querySelector('td p')!);
		click(editor.querySelector('td h3')!);
		expect(style(para(editor, 'head'))).toBe(sorted(SOURCE_STYLE));
		expect(style(editor.querySelector('td p') as HTMLElement)).toBe('margin-left: 96px; text-align: justify');
		expect(style(editor.querySelector('td h3') as HTMLElement)).toBe('margin-left: 96px; text-align: justify');
	});

	it('a plain format takes a heading\'s hang away whole, not just its left indent', () => {
		// Left with a first-line indent and no left indent, the heading's first line would be
		// written 0.5 in left of the page margin.
		const { editor, api } = open(
			'<h1 style="margin-left:36pt;margin-right:36pt;text-indent:-36pt">1. Heading</h1><p>Body</p>'
		);
		click(button());
		click(para(editor, 'Body'));
		click(para(editor, '1. Heading'));
		expect(para(editor, '1. Heading').hasAttribute('style')).toBe(false);
		expect(api.getRTF()).not.toMatch(/\\fi-|\\ri/);
	});

	it('leaves a list alone, and a list cannot be the source', () => {
		const html = `<ul><li>item</li></ul><p>one</p>`;
		const { editor } = open(html);
		click(button());
		click(para(editor, 'item'));
		expect(editor.classList.contains('copy-format-pick')).toBe(true);
		click(button());
		editor.innerHTML = `${SOURCE}<ul><li>item</li></ul>`;
		click(button());
		click(para(editor, 'source'));
		click(para(editor, 'item'));
		expect(editor.querySelector('ul')!.outerHTML).toBe('<ul><li>item</li></ul>');
	});

	it('gives a line of loose text a paragraph to carry the format, and Undo takes it away', () => {
		const { editor } = open(`${SOURCE}loose<br>next`);
		click(button());
		click(para(editor, 'source'));
		const text = Array.from(editor.childNodes).find((n) => n.textContent === 'loose') as Text;
		window.getSelection()!.setBaseAndExtent(text, 2, text, 2);
		click(editor);
		const made = para(editor, 'loose');
		expect(made.tagName).toBe('P');
		expect(style(made)).toBe(sorted(SOURCE_STYLE));
		expect(editor.lastChild!.textContent).toBe('next');
		key(editor, 'z', true);
		expect(editor.innerHTML).toBe(`${SOURCE}loose<br>next`);
	});

	it('nothing of the tool reaches the document', () => {
		const { editor, api } = open(`${SOURCE}<p>one</p>`);
		click(button());
		click(para(editor, 'source'));
		click(para(editor, 'one'));
		expect(api.getHTML()).not.toMatch(/copy-format|class=/);
	});

	it('a click in the margin beside an indented paragraph copies nothing and changes nothing', () => {
		// The margin is outside the <p>, so the click lands on the editor, and the browser puts the
		// caret in the paragraph's text.
		const { editor } = open(`${SOURCE}<p style="margin-left: 48px">one</p><blockquote>quote</blockquote>`);
		click(button());
		for (const text of ['source', 'quote']) {
			const node = para(editor, text === 'quote' ? 'source' : text).firstChild as Text;
			const inQuote = editor.querySelector('blockquote')!.firstChild as Text;
			const at = text === 'quote' ? inQuote : node;
			window.getSelection()!.setBaseAndExtent(at, 1, at, 1);
			click(editor);
			expect(editor.classList.contains('copy-format-pick')).toBe(true);
		}
		click(para(editor, 'source'));
		const one = para(editor, 'one').firstChild as Text;
		window.getSelection()!.setBaseAndExtent(one, 1, one, 1);
		click(editor);
		expect(para(editor, 'one').getAttribute('style')).toBe('margin-left: 48px');
	});

	it('carries the tab stop that goes with a hanging indent, and takes it away with a plain format', () => {
		const hung = '<p data-rtf-tab-stops="150px" style="margin-left: 150px; text-indent: -150px; tab-size: 150px;">A.<span style="white-space:pre">\t</span>source</p>';
		const { editor, api } = open(`${hung}<p>B.<span style="white-space:pre">\t</span>one</p><p>plain</p>`);
		const source = editor.querySelector('p')!;
		const target = editor.querySelectorAll('p')[1];
		click(button());
		click(source);
		click(target);
		expect(target.getAttribute('data-rtf-tab-stops')).toBe('150px');
		expect(api.getRTF()).toContain('\\pard\\tx2250\\li2250\\fi-2250 B.\\tab one\\par ');
		key(editor, 'z', true);
		expect(target.outerHTML).toBe('<p>B.<span style="white-space:pre">\t</span>one</p>');

		click(button());
		click(button());
		click(para(editor, 'plain'));
		click(source);
		expect(source.outerHTML).toBe('<p>A.<span style="white-space:pre">\t</span>source</p>');
		expect(api.getRTF()).not.toContain('\\tx');
	});

	it('clear() puts the brush down and takes the frame away', () => {
		const { editor } = open(`${SOURCE}<p>one</p>`);
		click(button());
		click(para(editor, 'source'));
		(component as unknown as { clear(): void }).clear();
		flushSync();
		expect(bar()).toBeNull();
		expect(host!.querySelector('.ink-copy-format-source')).toBeNull();
		click(editor.querySelector('p')!);
		expect(editor.innerHTML).toBe('<p><br></p>');
	});

	it('a new document puts the brush down', () => {
		const { editor, api } = open(`${SOURCE}<p>one</p>`);
		click(button());
		click(para(editor, 'source'));
		api.setHTML('<p>new</p>');
		flushSync();
		expect(bar()).toBeNull();
		click(para(editor, 'new'));
		expect(para(editor, 'new').hasAttribute('style')).toBe(false);
	});
});
