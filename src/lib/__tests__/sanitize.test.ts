// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { sanitizeHtml, sanitizedNodes } from '../sanitize.js';
import { htmlToRtf } from '../rtf-writer.js';
import { htmlToMarkdown } from '../utils.js';

// happy-dom has none of the editing commands the editor asks the browser about.
const doc = document as unknown as { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

/**
 * The browser's storage, stood in. Node from version 25 has a `localStorage` of its own, which
 * is undefined unless Node was started with a file to keep it in, and it stands in the test
 * DOM's place: on Node 26 every test here that touched storage failed before it tested anything.
 */
function memoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		get length() {
			return items.size;
		},
		clear: () => items.clear(),
		getItem: (key: string) => items.get(key) ?? null,
		key: (index: number) => Array.from(items.keys())[index] ?? null,
		removeItem: (key: string) => void items.delete(key),
		setItem: (key: string, value: string) => void items.set(key, String(value))
	} as Storage;
}

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function parsed(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = sanitizeHtml(html);
	return div;
}

describe('sanitizeHtml: HTML from outside, made safe to show', () => {
	it('leaves an ordinary document exactly as it was written', () => {
		const html =
			'<h1 style="text-align:center">Report</h1><p id="dx-1" style="margin-left: 96px; text-indent: -48px" data-rtf-tab-stops="1in">A. <strong>Benign</strong> <em>tissue</em> <span style="color: rgb(255, 0, 0); font-size: 14pt">red</span><span style="white-space:pre">\t</span>x</p>' +
			'<ul><li>one</li></ul><ol start="3"><li>three</li></ol><table><tbody><tr><td colspan="2" rowspan="1" style="width:50%">c</td></tr></tbody></table>' +
			'<figure style="text-align:center"><img src="data:image/png;base64,iVBORw0KGgo=" alt="slide" style="width: 300px; height: auto;"><figcaption>Fig 1</figcaption></figure>' +
			'<p><a href="https://example.com/a?b=1">link</a></p><hr style="break-after:page"><pre>code</pre><blockquote style="margin-left: 40px; border: none;">q</blockquote>';
		expect(sanitizeHtml(html)).toBe(html);
	});

	it('takes out every attribute that runs script', () => {
		const div = parsed('<p onclick="x()" onmouseover="y()">a</p><img src="https://x.test/a.png" onerror="z()" onload="w()"><a href="https://x.test/" onfocus="v()">b</a>');
		for (const el of Array.from(div.querySelectorAll('*'))) {
			for (const attr of Array.from(el.attributes)) expect(attr.name.startsWith('on'), attr.name).toBe(false);
		}
		expect(div.querySelector('img')!.getAttribute('src')).toBe('https://x.test/a.png');
	});

	it('takes out the elements that run code or load a page of their own, with what is in them, and the ones that take input, leaving their words', () => {
		const div = parsed(
			'<p>kept</p><script>a()</script><style>*{color:red}</style><iframe src="https://x.test/"></iframe><object></object><embed>' +
				'<svg onload="b()"><circle r="1"></circle></svg><math><mi>x</mi></math><form action="https://x.test/"><input name="q"><button>Go</button><select><option>o</option></select><textarea>t</textarea>in a form</form>' +
				'<video></video><audio></audio><link rel="stylesheet" href="data:text/css,"><meta http-equiv="refresh" content="0"><base href="https://x.test/">'
		);
		expect(Array.from(div.querySelectorAll('*')).map((el) => el.tagName.toLowerCase())).toEqual(['p', 'form']);
		expect(div.querySelector('form')!.attributes.length).toBe(0);
		// (Was 'keptin a form': the formula's x, the button's Go, the chosen o and the t typed
		// in the text box were taken out with their elements.)
		expect(div.textContent).toBe('keptxGootin a form');
	});

	it('keeps a link only to a web, mail or phone address', () => {
		const div = parsed(
			'<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a><a href="data:text/html,x">c</a><a href="file:///etc/passwd">d</a><a href="/relative">e</a>' +
				'<a href="https://ok.test/">f</a><a href="mailto:a@b.test">g</a><a href="tel:+15551234">h</a>'
		);
		expect(Array.from(div.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([null, null, null, null, null, 'https://ok.test/', 'mailto:a@b.test', 'tel:+15551234']);
		expect(div.textContent).toBe('abcdefgh');
	});

	it('a link that opens a new tab does not hand that tab the page', () => {
		expect(parsed('<a href="https://ok.test/" target="_blank">x</a>').querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('keeps a picture address only if it is a web address or picture data', () => {
		const div = parsed('<img src="javascript:alert(1)" alt="a"><img src="data:text/html;base64,AAAA" alt="b"><img src="https://x.test/p.png" alt="c">');
		expect(Array.from(div.querySelectorAll('img')).map((img) => img.getAttribute('src'))).toEqual([null, null, 'https://x.test/p.png']);
	});

	it('takes out the styles that move an element over the page, and keeps the ones that format text', () => {
		const p = parsed('<div style="position: fixed; top: 0px; left: 0px; z-index: 9999; width: 100vw; color: red; margin-left: 48px">x</div>').querySelector('div')!;
		expect(p.style.position).toBe('');
		expect(p.style.zIndex).toBe('');
		expect(p.style.top).toBe('');
		expect(p.style.color).toBe('red');
		expect(p.style.marginLeft).toBe('48px');
	});

	it('takes out a style that loads something', () => {
		const p = parsed('<p style="background-color: red; border-image-source: url(https://x.test/t.png); color: blue">x</p>').querySelector('p')!;
		expect(p.getAttribute('style') ?? '').not.toMatch(/url/);
		expect(p.style.color).toBe('blue');
	});

	it('takes out a class, which would take on the page\'s own styles, but not the one that marks a typed tab', () => {
		const div = parsed('<p class="modal-overlay fixed inset-0">a</p><span class="Apple-tab-span" style="white-space:pre">\t</span>');
		expect(div.querySelector('p')!.hasAttribute('class')).toBe(false);
		expect(div.querySelector('span')!.getAttribute('class')).toBe('Apple-tab-span');
	});

	it('takes out an id that is the name of something scripts look up on the page', () => {
		const div = parsed('<p id="cookie">a</p><p id="location">b</p><p id="section-2">c</p>');
		expect(Array.from(div.querySelectorAll('p')).map((p) => p.getAttribute('id'))).toEqual([null, null, 'section-2']);
	});

	it('keeps what a custom element holds, not the element', () => {
		const div = parsed('<p>a <x-widget onclick="x()">inside</x-widget> b</p>');
		expect(div.innerHTML).toBe('<p>a inside b</p>');
	});

	it('what Word hid stays hidden when the rest of its style is taken out', () => {
		const span = parsed('<p>shown<span style="mso-hide:all; position:absolute">hidden</span></p>').querySelector('span')!;
		expect(span.style.display).toBe('none');
		const div = span.closest('div')!;
		expect(htmlToRtf(div)).not.toContain('hidden');
	});
});

describe('sanitizeHtml: what a review of it found', () => {
	// Each of these went through as it was. Invented text.

	describe('a style that places or sizes an element', () => {
		const styleOf = (html: string, selector = 'div') => parsed(html).querySelector(selector)!.getAttribute('style') ?? '';

		it('a margin below zero is taken out: it pulled a block up over the toolbar', () => {
			const style = styleOf('<div style="margin-top: -600px; margin-left: -300px; background-color: red">COVER</div>');
			expect(style).not.toMatch(/margin/);
			expect(style).toMatch(/background-color: red/);
		});

		it('a width or a height is kept on a picture, a table and its cells, and nowhere else', () => {
			expect(styleOf('<div style="width: 3000px; height: 3000px; color: red">x</div>')).not.toMatch(/width|height/);
			expect(styleOf('<a href="https://x.test/" style="width: 50%">x</a>', 'a')).not.toMatch(/width/);
			expect(styleOf('<img src="https://x.test/a.png" style="width: 300px; height: auto">', 'img')).toMatch(/width: 300px/);
			expect(styleOf('<table style="width: 100%"><tbody><tr><td style="width: 50%; height: 20px">c</td></tr></tbody></table>', 'td')).toMatch(/width: 50%.*height: 20px/);
		});

		it('a padding, a margin or a width of thousands of pixels is taken out: a link was made the size of the page', () => {
			expect(styleOf('<a href="https://x.test/" style="display: block; margin: -2000px; padding: 4000px">all of it</a>', 'a')).not.toMatch(/margin|padding/);
			expect(styleOf('<p style="margin-left: 5000px; padding-left: 30in; color: blue">x</p>', 'p')).toBe('color: blue;');
			expect(styleOf('<img src="https://x.test/a.png" style="width: 99999px">', 'img')).toBe('');
		});

		it('a size that is a share of the window, or worked out by the browser, is taken out', () => {
			for (const value of ['100vw', '50vh', 'calc(100% + 500px)', 'max(10px, 5000px)', 'var(--x)']) {
				expect(styleOf(`<p style="margin-left: ${value}; color: blue">x</p>`, 'p'), value).not.toMatch(/margin/);
			}
		});

		it('only the ways of laying out a document are kept', () => {
			for (const value of ['flex', 'grid', 'contents', 'inline-flex']) {
				expect(styleOf(`<div style="display: ${value}; color: red">x</div>`), value).not.toMatch(/display/);
			}
			for (const value of ['none', 'inline', 'block', 'inline-block', 'list-item']) {
				expect(styleOf(`<div style="display: ${value}">x</div>`), value).toBe(`display: ${value}`);
			}
		});

		it('a line height, a text size and a border are kept within what a page holds', () => {
			expect(styleOf('<p style="line-height: 3000px; font-size: 99999pt; border-top-width: 500px; color: red">x</p>', 'p')).toBe('color: red;');
			expect(styleOf('<p style="line-height: 1.75; font-size: 14pt; border-top-width: 2px">x</p>', 'p')).toBe('line-height: 1.75; font-size: 14pt; border-top-width: 2px');
		});

		it('what the editor itself writes is left exactly as it was', () => {
			for (const style of [
				'margin-left: 96px; text-indent: -48px;',
				'margin: 0px 0px 0.2em 96px;',
				'margin-right: 48px',
				'font-size: 1em;',
				'font-size: 10.5pt;',
				'white-space:pre',
				'text-align: center',
				'width: 300px; height: auto;'
			]) {
				const tag = style.startsWith('width') ? 'img' : 'p';
				expect(sanitizeHtml(`<${tag} style="${style}">`), style).toContain(`style="${style}"`);
			}
		});
	});

	describe('style text that is not a property this browser read', () => {
		it('is not passed on for whatever shows the HTML next', () => {
			const out = sanitizeHtml('<div style="color: red; width: expression(alert(1))">a</div><div style="background: url(javascript:alert(1)); color: blue">b</div><p style="frobnicate: 9; color: green">c</p>');
			expect(out).not.toMatch(/expression|javascript|url\(|frobnicate/);
			expect(out).toMatch(/color: red/);
			expect(out).toMatch(/color: blue/);
			expect(out).toMatch(/color: green/);
		});

		it('what Word hid is hidden on screen too, with nothing else in its style to take out', () => {
			// It showed on screen and was left out of the RTF: hidden only if some other
			// property happened to be taken out with it.
			const span = parsed('<p>shown<span style="mso-hide:all">hidden</span></p>').querySelector('span')!;
			expect(span.style.display).toBe('none');
			expect(htmlToRtf(span.closest('div')!)).not.toContain('hidden');
		});
	});

	describe('an id', () => {
		it('a document keeps its own', () => {
			expect(sanitizeHtml('<p id="dx-1">Diagnosis</p><h2 id="sec-gross">Gross</h2>')).toBe('<p id="dx-1">Diagnosis</p><h2 id="sec-gross">Gross</h2>');
		});

		it('one the page already uses is not taken: the caller says which', () => {
			const nodes = sanitizedNodes('<p id="sidebar">a</p><p id="dx-1">b</p>', document, (id) => id === 'sidebar');
			expect(nodes.map((node) => (node as Element).getAttribute('id'))).toEqual([null, 'dx-1']);
		});
	});

	describe('the words an element showed stay when the element goes', () => {
		it('a formula of numbers and signs is those characters: "Ki-67 30%" became "Ki-67"', () => {
			expect(sanitizeHtml('<p>Ki-67 <math><mn>30</mn><mo>%</mo></math></p>')).toBe('<p>Ki-67 30%</p>');
			expect(sanitizeHtml('<p><math><mrow><mi>x</mi><mo>=</mo><mn>5</mn></mrow></math></p>')).toBe('<p>x=5</p>');
		});

		it('a formula with a fraction, a power or a root is marked, not read in a row: "1/2" would read "12"', () => {
			expect(sanitizeHtml('<p>ratio <math><mfrac><mn>1</mn><mn>2</mn></mfrac></math></p>')).toBe('<p>ratio [formula]</p>');
			expect(sanitizeHtml('<p><math><msup><mi>x</mi><mn>2</mn></msup></math></p>')).toBe('<p>[formula]</p>');
		});

		it('the source a formula carries for other programs is not its text', () => {
			expect(sanitizeHtml('<p><math><semantics><mrow><mn>30</mn><mo>%</mo></mrow><annotation encoding="application/x-tex">30\\%</annotation></semantics></math></p>')).toBe('<p>30%</p>');
		});

		it('a button leaves its label, a text box what it holds, a list its chosen entry', () => {
			expect(sanitizeHtml('<p>Press <button onclick="x()">Sign  out</button> now</p>')).toBe('<p>Press Sign out now</p>');
			expect(sanitizeHtml('<p>Note: <textarea>Margins clear</textarea></p>')).toBe('<p>Note: Margins clear</p>');
			expect(sanitizeHtml('<p>Grade <select><option>1</option><option selected>2</option></select></p>')).toBe('<p>Grade 2</p>');
			expect(sanitizeHtml('<p>Grade <select><option>1</option><option>2</option></select></p>')).toBe('<p>Grade 1</p>');
			expect(sanitizeHtml('<p>Stage <input type="text" value="pT2"> <input value="N0"></p>')).toBe('<p>Stage pT2 N0</p>');
		});

		it('an input that shows no words leaves none, and what it holds is never markup', () => {
			expect(sanitizeHtml('<p>a<input type="checkbox" value="on"><input type="hidden" value="secret"><input type="password" value="pw">b</p>')).toBe('<p>ab</p>');
			expect(sanitizeHtml('<p><textarea>&lt;img src=x onerror=alert(1)&gt;</textarea></p>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
		});
	});

	describe('sanitizedNodes', () => {
		it('gives the checked document as nodes, with nothing that runs', () => {
			const nodes = sanitizedNodes('<p onclick="x()">a</p><script>y()</script><img src="x" onerror="z()">', document);
			const holder = document.createElement('div');
			holder.append(...nodes);
			expect(holder.innerHTML).toBe('<p>a</p><img src="x">');
			expect(nodes.every((node) => node.ownerDocument === document)).toBe(true);
		});

		it('gives nothing for nothing', () => {
			expect(sanitizedNodes('', document)).toEqual([]);
		});
	});
});

describe('InkEditor: every way in goes through sanitizeHtml', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	const EVIL = '<p>Body</p><img src="data:image/png;base64,iVBORw0KGgo=" onerror="window.__evil = 1"><a href="javascript:void(0)">l</a><iframe src="https://x.test/"></iframe>';

	function open(props: Record<string, unknown>): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props }) as Record<string, unknown>;
		flushSync();
		return host.querySelector('.ink-content') as HTMLElement;
	}
	const safe = (editor: HTMLElement) => {
		expect(editor.querySelector('iframe')).toBeNull();
		expect(editor.querySelector('[onerror]')).toBeNull();
		expect(editor.querySelector('a')!.hasAttribute('href')).toBe(false);
		expect(editor.textContent).toContain('Body');
	};

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
		localStorage.clear();
	});

	it('the content prop', () => {
		safe(open({ content: EVIL }));
	});

	it('setHTML', () => {
		const editor = open({ content: '<p>x</p>' });
		(component as unknown as { setHTML(html: string): void }).setHTML(EVIL);
		safe(editor);
	});

	it('a draft restored from localStorage', () => {
		localStorage.setItem('report-1', EVIL);
		safe(open({ autosave: true, storageKey: 'report-1', content: '<p>from the host</p>' }));
	});

	it('a paste', () => {
		const editor = open({ content: '<p>Body</p>' });
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		editor.insertAdjacentHTML('beforeend', '<div style="position: fixed; z-index: 9999; color: red">over</div><form><input name="q"><button>b</button></form><a href="javascript:void(0)">l</a><iframe></iframe>');
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		safe(editor);
		expect(editor.querySelector('input, button')).toBeNull();
		const over = Array.from(editor.querySelectorAll('div')).find((d) => d.textContent === 'over')!;
		expect(over.style.position).toBe('');
		expect(over.style.color).toBe('red');
	});
});

describe('InkEditor: drafts and the empty document', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	function open(props: Record<string, unknown>): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props }) as Record<string, unknown>;
		flushSync();
		return host.querySelector('.ink-content') as HTMLElement;
	}
	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
		localStorage.clear();
	});

	it('unless autosave is asked for, a draft left in the browser is not shown in place of the content given', () => {
		localStorage.setItem('ink-editor-content', '<p>Another patient</p>');
		const editor = open({ content: '<p>This patient</p>' });
		expect(editor.innerHTML).toBe('<p>This patient</p>');
	});

	it('unless autosave is asked for, nothing is written to localStorage', async () => {
		const editor = open({ content: '<p>This patient</p>' });
		(component as unknown as { setHTML(html: string): void }).setHTML('<p>Edited</p>');
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 1100));
		expect(localStorage.length).toBe(0);
	});

	it('an empty document is a paragraph with a line in it, so the first words typed go inside it', () => {
		const editor = open({});
		expect(editor.innerHTML).toBe('<p><br></p>');
		expect(htmlToRtf(editor)).toMatch(/\\fs24 \\par \}$/);
	});

	it('an empty paragraph in what is given shows as the blank line the RTF writes for it', () => {
		const editor = open({ content: '<p>one</p><p></p><p>two</p>' });
		expect(editor.innerHTML).toBe('<p>one</p><p><br></p><p>two</p>');
	});

	it('the editing area says what it is to a screen reader', () => {
		const editor = open({ ariaLabel: 'Final diagnosis' });
		expect(editor.getAttribute('role')).toBe('textbox');
		expect(editor.getAttribute('aria-multiline')).toBe('true');
		expect(editor.getAttribute('aria-label')).toBe('Final diagnosis');
		expect(host!.querySelector('.toolbar')!.getAttribute('role')).toBe('toolbar');
	});

	it('onchange reads the HTML, the text and the size only when asked, and once', () => {
		const payloads: { html: string; estimatedRtfBytes: number; wordCount: number }[] = [];
		const editor = open({ content: '<p>one two</p>', onchange: (p: (typeof payloads)[number]) => payloads.push(p) });
		let reads = 0;
		const real = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
		Object.defineProperty(editor, 'innerHTML', { configurable: true, get() { reads++; return real.get!.call(this); }, set(v) { real.set!.call(this, v); } });
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(payloads.length).toBe(1);
		expect(reads).toBe(0);
		expect(payloads[0].html).toBe('<p>one two</p>');
		expect(payloads[0].html).toBe('<p>one two</p>');
		expect(reads).toBe(1);
		expect(payloads[0].estimatedRtfBytes).toBeGreaterThan(0);
		expect({ ...payloads[0] }.html).toBe('<p>one two</p>');
	});
});

describe('InkEditor: what a review of these changes found', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	function open(props: Record<string, unknown>): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props }) as Record<string, unknown>;
		flushSync();
		return host.querySelector('.ink-content') as HTMLElement;
	}
	const api = () => component as unknown as { setHTML(html: string): void; clear(): void };
	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
		document.getElementById('sidebar')?.remove();
	});

	it('the HTML given is read once: the nodes that were checked are put in the page, not written out and read again', () => {
		const editor = open({ content: '<p>one</p>' });
		const real = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
		let written = 0;
		Object.defineProperty(editor, 'innerHTML', { configurable: true, get() { return real.get!.call(this); }, set(v) { written++; real.set!.call(this, v); } });
		api().setHTML('<p onclick="x()">two</p><script>y()</script>');

		expect(written).toBe(0);
		expect(real.get!.call(editor)).toBe('<p>two</p>');
	});

	it('an id the page already uses outside the editor is not taken by the document; its own are kept', () => {
		const sidebar = document.createElement('nav');
		sidebar.id = 'sidebar';
		document.body.appendChild(sidebar);
		const editor = open({ content: '<p id="sidebar">a</p><p id="dx-1">b</p>' });

		expect(editor.innerHTML).toBe('<p>a</p><p id="dx-1">b</p>');
		expect(document.getElementById('sidebar')).toBe(sidebar);
	});

	it('a document given again keeps the ids it has, and so does a second editor on the page', () => {
		const editor = open({ content: '<p id="dx-1">b</p>' });
		api().setHTML('<p id="dx-1">b again</p>');
		expect(editor.innerHTML).toBe('<p id="dx-1">b again</p>');

		const second = document.createElement('div');
		document.body.appendChild(second);
		const other = mount(InkEditor, { target: second, props: { content: '<p id="dx-1">in the other</p>' } });
		flushSync();
		expect(second.querySelector('.ink-content')!.innerHTML).toBe('<p id="dx-1">in the other</p>');
		unmount(other);
		second.remove();
	});

	it('a button that does something once is not announced as pressed or not; one that is on or off is', () => {
		open({ content: '<p>x</p>' });
		const button = (title: string) => host!.querySelector(`.toolbar button[title="${title}"]`)!;
		for (const title of ['Undo (Ctrl+Z)', 'Redo', 'Insert image', 'Horizontal rule', 'Bullet list', 'Clear formatting']) {
			expect(button(title).hasAttribute('aria-pressed'), title).toBe(false);
		}
		for (const title of ['Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Underline (Ctrl+U)', 'Strikethrough', 'Copy format']) {
			expect(button(title).getAttribute('aria-pressed'), title).toBe('false');
		}
	});

	it('a document with nothing in it counts no characters: the line break of its empty paragraph counted as one', () => {
		const counts: { wordCount: number; charCount: number }[] = [];
		const editor = open({ onchange: (p: { wordCount: number; charCount: number }) => counts.push({ wordCount: p.wordCount, charCount: p.charCount }) });
		// (The test DOM gives no text for a line break; a browser gives "\n".)
		Object.defineProperty(editor, 'innerText', { configurable: true, get: () => (editor.textContent === '' ? '\n' : editor.textContent) });
		api().clear();
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(counts[counts.length - 1]).toEqual({ wordCount: 0, charCount: 0 });
		expect(host!.textContent).toContain('0 words');
		expect(host!.textContent).not.toMatch(/\b1 character/);

		api().setHTML('<p>ab</p>');
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(counts[counts.length - 1]).toEqual({ wordCount: 1, charCount: 2 });
	});

	it('a picture alone is not nothing', () => {
		const counts: number[] = [];
		const editor = open({ content: '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt=""></p>', onchange: (p: { charCount: number }) => counts.push(p.charCount) });
		Object.defineProperty(editor, 'innerText', { configurable: true, get: () => '\n' });
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(counts[counts.length - 1]).toBe(1);
	});
});

describe('the writer keeps its numbers in range', () => {
	const rtf = (html: string) => {
		const div = document.createElement('div');
		div.innerHTML = html;
		return htmlToRtf(div);
	};

	it('a color of four or eight hex digits is read as one with an alpha, and no other length is a color', () => {
		expect(rtf('<font color="#abcd">a</font>')).toContain('\\red170\\green187\\blue204;');
		expect(rtf('<font color="#11223344">a</font>')).toContain('\\red17\\green34\\blue51;');
		for (const bad of ['#abcde', '#1234567', '#12']) expect(rtf(`<font color="${bad}">a</font>`)).not.toMatch(/NaN|\\cf[2-9]/);
	});

	it('a color component is at most 255', () => {
		expect(rtf('<font color="rgb(999, 300, 0)">a</font>')).toContain('\\red255\\green255\\blue0;');
	});

	it('a font size is at most Word\'s largest, and a size of nothing is no size', () => {
		expect(rtf('<p><span style="font-size: 99999pt">a</span></p>')).toContain('\\fs3276 ');
		expect(rtf('<p><span style="font-size: 0pt">a</span></p>')).not.toMatch(/\\fs0\b/);
	});

	it('an indent, a tab stop and a picture are no larger than the largest page', () => {
		const out = rtf(
			'<p style="margin-left: 99999999px; margin-right: 9999in; text-indent: -99999999pt" data-rtf-tab-stops="9999in">a</p>' +
				'<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="99999999999">'
		);
		for (const m of out.matchAll(/\\(?:li|ri|fi|tx|picwgoal|pichgoal)(-?\d+)/g)) expect(Math.abs(Number(m[1])), m[0]).toBeLessThanOrEqual(31680);
		expect(out).toContain('\\picwgoal31680\\pichgoal31680 ');
	});

	it('lists straight inside lists, deeper than the writer walks, are written as their text too', () => {
		// These are written by the list writer calling itself, which did not count its depth:
		// six thousand deep it ran out of stack in a browser. Past the depth it walks to, the
		// text is written with no bullet.
		const nest = (depth: number) => {
			const root = document.createElement('div');
			let at: HTMLElement = root;
			for (let i = 0; i < depth; i++) {
				const next = document.createElement(i % 2 ? 'ol' : 'ul');
				at.appendChild(next);
				at = next;
			}
			at.innerHTML = '<li>deep {text}</li>';
			return root;
		};
		expect(htmlToRtf(nest(900))).toContain('deep \\{text\\}');
		expect(htmlToRtf(nest(900))).not.toMatch(/\\tab deep/);
		// (Twenty deep it is an item of a list, after its number and a tab.)
		expect(htmlToRtf(nest(20))).toMatch(/1\.\\tab deep/);
		expect(htmlToMarkdown(nest(900))).toContain('deep {text}');
	});

	// (900 deep: past the 600 the writers walk element by element, and as deep as the test DOM's
	// own querySelector goes. e2e/editor.spec.ts does the same 6000 deep in a browser.)
	it('elements nested deeper than a parser allows are written, as their text past that depth', () => {
		const root = document.createElement('div');
		let at: HTMLElement = root;
		for (let i = 0; i < 900; i++) {
			const next = document.createElement(i % 2 ? 'span' : 'b');
			at.appendChild(next);
			at = next;
		}
		at.textContent = 'deep {text}';
		expect(htmlToRtf(root)).toContain('deep \\{text\\}');
		expect(htmlToMarkdown(root)).toContain('deep {text}');
	});
});
