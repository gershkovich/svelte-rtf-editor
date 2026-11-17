import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * The three RTF paragraph indents, end to end: \li (left), \ri (right) and \fi (first line,
 * negative for a hanging indent). The toolbar's hanging and right indent buttons set them, the
 * writer sends them, and the reader brings them back. Invented text.
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
});

function open(content: string): { editor: HTMLElement; api: Editor } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false } }) as Record<string, unknown>;
	flushSync();
	return { editor: host.querySelector('.ink-content') as HTMLElement, api: component as unknown as Editor };
}

function click(title: string): void {
	const button = host!.querySelector(`button[title="${title}"]`) as HTMLButtonElement | null;
	if (!button) throw new Error(`no button ${title}`);
	button.click();
	flushSync();
}

function undo(editor: HTMLElement): void {
	editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
	flushSync();
}

function caretIn(editor: HTMLElement, text: string): void {
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if ((n as Text).data === text) {
			window.getSelection()!.setBaseAndExtent(n, 1, n, 1);
			return;
		}
	}
	throw new Error(`no text ${text}`);
}

function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

function body(html: string): string {
	return htmlToRtf(htmlEl(html)).replace(/^.*?\\viewkind4\\uc1\\pard\\f0\\fs24 /, '');
}

function styleOf(editor: HTMLElement, selector = 'p'): string | null {
	return editor.querySelector(selector)!.getAttribute('style');
}

describe('hanging indent buttons', () => {
	it('Increase moves the later lines in by half an inch and leaves the first line where it was', () => {
		const { editor, api } = open('<p>one</p><p>two</p>');
		caretIn(editor, 'one');
		click('Increase hanging indent');
		expect(styleOf(editor)).toBe('margin-left: 48px; text-indent: -48px;');
		expect(editor.querySelectorAll('p')[1].hasAttribute('style')).toBe(false);
		expect(api.getRTF()).toContain('\\pard\\li720\\fi-720 one\\par ');
	});

	it('a second press hangs by an inch, and Decrease takes one step back', () => {
		const { editor, api } = open('<p>one</p>');
		caretIn(editor, 'one');
		click('Increase hanging indent');
		click('Increase hanging indent');
		expect(api.getRTF()).toContain('\\pard\\li1440\\fi-1440 one\\par ');
		click('Decrease hanging indent');
		expect(api.getRTF()).toContain('\\pard\\li720\\fi-720 one\\par ');
		click('Decrease hanging indent');
		expect(editor.querySelector('p')!.hasAttribute('style')).toBe(false);
	});

	it('hangs under an existing left indent: the first line stays at that indent', () => {
		const { editor, api } = open('<p style="margin-left: 48px">one</p>');
		caretIn(editor, 'one');
		click('Increase hanging indent');
		expect(api.getRTF()).toContain('\\pard\\li1440\\fi-720 one\\par ');
		click('Decrease hanging indent');
		expect(api.getRTF()).toContain('\\pard\\li720 one\\par ');
	});

	it('Decrease does nothing to a paragraph that does not hang', () => {
		const { editor } = open('<p style="margin-left: 48px">one</p>');
		caretIn(editor, 'one');
		click('Decrease hanging indent');
		expect(styleOf(editor)).toBe('margin-left: 48px');
	});

	it('Decrease indent stops where the first line of a hanging paragraph reaches the left edge', () => {
		const { editor, api } = open('<p style="margin-left: 96px; text-indent: -48px">one</p>');
		caretIn(editor, 'one');
		click('Decrease indent (Ctrl+[)');
		expect(api.getRTF()).toContain('\\pard\\li720\\fi-720 one\\par ');
		click('Decrease indent (Ctrl+[)');
		expect(api.getRTF()).toContain('\\pard\\li720\\fi-720 one\\par ');
	});

	it('gives a line of loose text a paragraph of its own, and Undo takes it away again', () => {
		const { editor, api } = open('one<br>two');
		caretIn(editor, 'one');
		click('Increase hanging indent');
		expect(editor.innerHTML).toBe('<p style="margin-left: 48px; text-indent: -48px;">one</p>two');
		expect(api.getRTF()).toContain('\\pard\\li720\\fi-720 one\\par ');
		undo(editor);
		expect(editor.innerHTML).toBe('one<br>two');
	});

	it('leaves a list, a heading and a table cell alone', () => {
		const html = '<ul><li>item</li></ul><h2>head</h2><table><tbody><tr><td>cell</td></tr></tbody></table>';
		const { editor } = open(html);
		for (const text of ['item', 'head', 'cell']) {
			caretIn(editor, text);
			click('Increase hanging indent');
			click('Increase right indent');
		}
		expect(editor.innerHTML).toBe(html);
	});
});

describe('right indent buttons', () => {
	it('Increase moves the right edge in by half an inch a press; Decrease moves it back', () => {
		const { editor, api } = open('<p>one</p>');
		caretIn(editor, 'one');
		click('Increase right indent');
		expect(styleOf(editor)).toBe('margin-right: 48px;');
		expect(api.getRTF()).toContain('\\pard\\ri720 one\\par ');
		click('Increase right indent');
		expect(api.getRTF()).toContain('\\pard\\ri1440 one\\par ');
		click('Decrease right indent');
		click('Decrease right indent');
		expect(editor.querySelector('p')!.hasAttribute('style')).toBe(false);
		click('Decrease right indent');
		expect(editor.querySelector('p')!.hasAttribute('style')).toBe(false);
	});

	it('Undo puts the right edge back', () => {
		const { editor } = open('<p>one</p>');
		caretIn(editor, 'one');
		click('Increase right indent');
		undo(editor);
		expect(editor.querySelector('p')!.hasAttribute('style')).toBe(false);
	});

	it('combines with a left and a hanging indent on one paragraph', () => {
		const { editor, api } = open('<p>one</p>');
		caretIn(editor, 'one');
		click('Increase indent (Ctrl+])');
		click('Increase hanging indent');
		click('Increase right indent');
		expect(api.getRTF()).toContain('\\pard\\li1440\\ri720\\fi-720 one\\par ');
	});
});

describe('the writer', () => {
	it('margin-right is \\ri', () => {
		expect(body('<p style="margin-right: 0.5in">x</p>')).toBe('\\pard\\ri720 x\\par }');
	});

	it('writes left, right and first-line indent together', () => {
		expect(body('<p style="margin-left: 1in; margin-right: 0.5in; text-indent: -0.25in">x</p>')).toBe(
			'\\pard\\li1440\\ri720\\fi-360 x\\par }'
		);
	});

	it('ignores a negative or unreadable right margin', () => {
		expect(body('<p style="margin-right: -0.5in">x</p>')).toBe('\\pard x\\par }');
		expect(body('<p style="margin-right: 10%">x</p>')).toBe('\\pard x\\par }');
	});

	it('the next plain paragraph does not keep the indents', () => {
		expect(body('<p style="margin-right: 0.5in; text-indent: -0.5in; margin-left: 0.5in">x</p><p>y</p>')).toBe(
			'\\pard\\li720\\ri720\\fi-720 x\\par \\pard y\\par }'
		);
	});

	it('the size estimate does not fall short of the real size', () => {
		const el = htmlEl('<p style="margin-left: 1.75in; margin-right: 1.25in; text-indent: -1.75in">x</p>'.repeat(20));
		expect(estimateRtfBytes(el)).toBeGreaterThanOrEqual(htmlToRtf(el).length);
	});
});

describe('the reader', () => {
	const wrap = (rtfBody: string) => `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\viewkind4\\uc1\\pard\\f0\\fs24 ${rtfBody}}`;

	it('reads \\li, \\ri and \\fi as margin-left, margin-right and text-indent', () => {
		expect(rtfToHtml(wrap('\\pard\\li720 a\\par '))).toBe('<p style="margin-left:36pt">a</p>');
		expect(rtfToHtml(wrap('\\pard\\ri720 a\\par '))).toBe('<p style="margin-right:36pt">a</p>');
		expect(rtfToHtml(wrap('\\pard\\fi360 a\\par '))).toBe('<p style="text-indent:18pt">a</p>');
	});

	it('reads a hanging indent, the example from the RTF specification', () => {
		expect(rtfToHtml(wrap('\\pard\\fi-250\\li250 a\\par '))).toBe('<p style="margin-left:12.5pt;text-indent:-12.5pt">a</p>');
	});

	it('puts the indents after the alignment', () => {
		expect(rtfToHtml(wrap('\\pard\\qc\\li720\\ri720 a\\par '))).toBe(
			'<p style="text-align:center;margin-left:36pt;margin-right:36pt">a</p>'
		);
	});

	it('keeps the indents on the following paragraphs until \\pard', () => {
		expect(rtfToHtml(wrap('\\pard\\li720\\fi-720 a\\par b\\par \\pard c\\par '))).toBe(
			'<p style="margin-left:36pt;text-indent:-36pt">a</p>\n<p style="margin-left:36pt;text-indent:-36pt">b</p>\n<p>c</p>'
		);
	});

	it('does not let a first line start left of the page margin', () => {
		expect(rtfToHtml(wrap('\\pard\\li360\\fi-720 a\\par '))).toBe('<p style="margin-left:18pt;text-indent:-18pt">a</p>');
		expect(rtfToHtml(wrap('\\pard\\li-720 a\\par '))).toBe('<p>a</p>');
	});

	it('does not carry a table cell\'s indent into the paragraph after the table', () => {
		const html = rtfToHtml(wrap('\\trowd\\cellx4320{\\pard\\intbl\\li720 cell\\par}\\cell\\row after\\par '));
		expect(html).toContain('<p>after</p>');
		expect(html).not.toContain('margin-left');
	});

	it('a \\pard inside a list marker group does not reach the list item around it (Word)', () => {
		const item = "{\\listtext\\pard\\plain \\'b7\\tab}";
		const html = rtfToHtml(wrap(`${item}\\pard\\plain\\fi-360\\li720 Item 1\\par ${item}Item 2\\par ${item}Item 3\\par `));
		const styles = Array.from(html.matchAll(/<p([^>]*)>/g)).map((m) => m[1]);
		expect(styles).toEqual(Array(3).fill(' style="margin-left:36pt;text-indent:-18pt"'));
	});

	it('indents set inside a group end with the group', () => {
		expect(rtfToHtml(wrap('{\\pard\\li720 A\\par }B\\par '))).toBe('<p style="margin-left:36pt">A</p>\n<p>B</p>');
	});

	it('a heading with a hanging number goes back to RTF with its first line where it started', () => {
		const html = rtfToHtml(wrap('\\pard\\li720\\fi-720\\ri720{\\b\\fs48 1.\\tab Heading}\\par '));
		expect(html).toMatch(/^<h1 style="margin-left:36pt;margin-right:36pt;text-indent:-36pt">/);
		expect(htmlToRtf(htmlEl(html))).toContain('\\pard\\li720\\ri720\\fi-720\\f0\\fs48\\b ');
	});

	it('a heading in a table cell still writes its left indent only', () => {
		expect(body('<table><tbody><tr><td><h2 style="margin-left: 48px; text-indent: -48px">x</h2></td></tr></tbody></table>')).not.toContain('\\fi-720');
	});

	it('a picture gets a left margin where its line starts, and no first-line indent for its caption to inherit', () => {
		const pict = '{\\pict\\pngblip\\picw1\\pich1 89504e470d0a1a0a}';
		const hanging = rtfToHtml(wrap(`\\pard\\li720\\fi-720 ${pict}\\par `));
		expect(hanging).toMatch(/^<figure>/);
		const indented = rtfToHtml(wrap(`\\pard\\li1440\\fi-720\\ri720 ${pict}\\par `));
		expect(indented).toMatch(/^<figure style="margin-left:36pt">/);
	});

	it('a table cell\'s indent ends with the table when \\row sits in a group of its own', () => {
		const html = rtfToHtml(wrap('\\pard\\li720 A\\par \\trowd\\cellx3000 \\pard\\intbl\\li200 c1\\cell {\\row} After\\par '));
		expect(html).toContain('<p style="margin-left:36pt">A</p>');
		expect(html).toContain('<p>After</p>');
	});

	it('what the writer sends, the reader brings back, and the writer sends the same again', () => {
		const first = htmlToRtf(htmlEl('<p style="margin-left: 96px; margin-right: 48px; text-indent: -48px">one</p><p>two</p>'));
		expect(first).toContain('\\pard\\li1440\\ri720\\fi-720 one\\par \\pard two\\par ');
		const html = rtfToHtml(first);
		expect(html).toBe('<p style="margin-left:72pt;margin-right:36pt;text-indent:-36pt">one</p>\n<p>two</p>');
		expect(htmlToRtf(htmlEl(html))).toBe(first);
	});
});
