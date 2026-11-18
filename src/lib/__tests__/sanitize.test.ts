// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { pasteNotes, removeWordHidden, sanitizeHtml, sanitizedNodes } from '../sanitize.js';
import { htmlToRtf } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
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
		// in the text box were taken out with their elements. Then 'keptxGootin a form': the
		// button, the list and the text box stood side by side, and their words ran together.)
		expect(div.textContent).toBe('keptxGo o tin a form');
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

describe('keepAttributes: an application\'s own marks stay on its documents', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	const MARKED =
		'<p data-section="A" data-case="C-1" data-other="x" onclick="window.__evil = 1" class="heading"><b>A.</b> Invented heading</p><p>Invented text.</p>';

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

	it('with none named, a data- attribute is taken off as before', () => {
		const out = sanitizeHtml(MARKED);
		expect(out).not.toContain('data-section');
		expect(out).not.toContain('data-case');
		expect(open({ content: MARKED }).querySelector('[data-section]')).toBeNull();
	});

	it('the ones named stay, and only those', () => {
		const out = sanitizeHtml(MARKED, { keepAttributes: ['data-section', 'DATA-CASE'] });
		expect(out).toContain('data-section="A"');
		expect(out).toContain('data-case="C-1"');
		expect(out).not.toContain('data-other');
		expect(out).not.toContain('onclick');
		expect(out).not.toContain('class=');
	});

	it('a name that is not a data- attribute is not kept, whoever asks', () => {
		const html = '<p onclick="window.__evil = 1" class="heading" contenteditable="false" data-section="A">x</p><img src="https://x.test/a.png" srcset="https://x.test/b.png 2x" onerror="window.__evil = 1">';
		const out = sanitizeHtml(html, { keepAttributes: ['onclick', 'class', 'contenteditable', 'srcset', 'onerror', 'data-', 'data-section'] });
		expect(out).not.toContain('onclick');
		expect(out).not.toContain('onerror');
		expect(out).not.toContain('class=');
		expect(out).not.toContain('contenteditable');
		expect(out).not.toContain('srcset');
		expect(out).toContain('data-section="A"');
	});

	it('the content prop and setHTML keep them, and getHTML gives them back', () => {
		const editor = open({ content: MARKED, keepAttributes: ['data-section', 'data-case'] });
		expect(editor.querySelector('p')!.getAttribute('data-section')).toBe('A');
		expect(editor.querySelector('p')!.getAttribute('data-case')).toBe('C-1');
		expect(editor.querySelector('[data-other], [onclick], [class="heading"]')).toBeNull();
		(component!.setHTML as (html: string) => void)('<p data-section="B">Second</p>');
		flushSync();
		expect(editor.querySelector('p')!.getAttribute('data-section')).toBe('B');
		expect((component!.getHTML as () => string)()).toContain('data-section="B"');
	});

	it('a class named in keepClasses stays, alone', () => {
		const html = '<pre class="summary wide">Invented summary</pre><p class="MsoNormal summary-2">x</p>';
		expect(sanitizeHtml(html)).not.toContain('class=');
		const out = sanitizeHtml(html, { keepClasses: ['summary', 'not a name', ''] });
		expect(out).toContain('<pre class="summary">');
		expect(out).not.toContain('wide');
		expect(out).not.toContain('MsoNormal');
		expect(out).not.toContain('summary-2');
		const editor = open({ content: html, keepClasses: ['summary'] });
		expect(editor.querySelector('pre')!.className).toBe('summary');
		expect(editor.querySelector('p')!.hasAttribute('class')).toBe(false);
	});

	it('the RTF is the same with the marks as without', () => {
		const withMarks = document.createElement('div');
		withMarks.innerHTML = sanitizeHtml(MARKED, { keepAttributes: ['data-section', 'data-case'] });
		const without = document.createElement('div');
		without.innerHTML = sanitizeHtml(MARKED);
		expect(htmlToRtf(withMarks)).toBe(htmlToRtf(without));
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

describe('sanitizeHtml: what a second review found', () => {
	// A review of the fixes above found these. Each line of each test went through as it was.
	// Invented text.
	const rtfBody = (html: string) => {
		const div = document.createElement('div');
		div.innerHTML = html;
		const rtf = htmlToRtf(div);
		return rtf.slice(rtf.indexOf('\\pard'));
	};
	const styleOf = (html: string, selector: string) => parsed(html).querySelector(selector)!.getAttribute('style') ?? '';

	describe('words that were hidden are not kept as words', () => {
		it('a hidden part of a button, and what is in its <script> or <style>, is not its label', () => {
			expect(sanitizeHtml('<p>Press <button>Sign<span style="display:none">SECRET</span></button></p>')).toBe('<p>Press Sign</p>');
			expect(sanitizeHtml('<p>Press <button>Sign<span hidden>SECRET</span><b style="visibility: hidden">TOO</b></button></p>')).toBe('<p>Press Sign</p>');
			expect(sanitizeHtml('<p>Press <button>Sign<script>alert(1)</script><style>.a{color:red}</style></button></p>')).toBe('<p>Press Sign</p>');
			expect(sanitizeHtml('<p><button>Save<br>draft</button></p>')).toBe('<p>Save draft</p>');
		});

		it('a button, a text box, a list or a formula that was hidden leaves no words', () => {
			for (const hidden of [
				'<button hidden>HIDDEN</button>',
				'<button style="display: none">HIDDEN</button>',
				'<button style="color: red; VISIBILITY: hidden">HIDDEN</button>',
				'<button style="mso-hide: all">HIDDEN</button>',
				'<input style="display:none" value="HIDDEN">',
				'<input hidden value="HIDDEN">',
				'<textarea style="display:none">HIDDEN</textarea>',
				'<select hidden><option>HIDDEN</option></select>',
				'<math style="display:none"><mn>42</mn></math>',
				'<math hidden><mn>42</mn></math>'
			]) {
				expect(sanitizeHtml(`<p>a${hidden}b</p>`), hidden).toBe('<p>ab</p>');
			}
		});

		it('text written straight into <math>, which no browser draws, is not kept', () => {
			expect(sanitizeHtml('<p>a<math>30%</math>b</p>')).toBe('<p>ab</p>');
		});

		it('a hidden element of the page\'s own kind goes with what is in it', () => {
			expect(sanitizeHtml('<p>a<x-note hidden>SECRET</x-note>b<x-note>shown</x-note></p>')).toBe('<p>abshown</p>');
			expect(sanitizeHtml('<p>a<x-note style="display:none">SECRET</x-note>b</p>')).toBe('<p>ab</p>');
		});

		it('what is in a closed <details> is in the RTF, so it is shown open', () => {
			expect(sanitizeHtml('<details><summary>More</summary><p>the rest</p></details>')).toBe('<details open=""><summary>More</summary><p>the rest</p></details>');
		});
	});

	describe('a list read from RTF keeps its indent', () => {
		it('a list nested by less than half an inch is written back where it was: it came back half an inch further in', () => {
			const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 \pard\li720\fi-360\bullet\tab a\par \pard\li1080\fi-360\bullet\tab b\par }`;
			const html = rtfToHtml(rtf);
			expect(html).toBe('<ul><li>a<ul style="margin-left:-18pt"><li>b</li></ul></li></ul>');
			expect(sanitizeHtml(html)).toBe(html);
			expect(rtfBody(sanitizeHtml(html))).toContain('\\pard\\li1080\\fi-360\\bullet\\tab b\\par');
		});

		it('so is a list at the left edge', () => {
			const html = rtfToHtml(String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 \pard\li360\fi-360\bullet\tab a\par }`);
			expect(html).toBe('<ul style="margin-left:-18pt"><li>a</li></ul>');
			expect(rtfBody(sanitizeHtml(html))).toContain('\\pard\\li360\\fi-360\\bullet\\tab a\\par');
			const numbered = rtfToHtml(String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 \pard\li360\fi-360 1.\tab a\par }`);
			expect(sanitizeHtml(numbered)).toBe(numbered);
		});

		it('no other margin below zero is kept, and a list is pulled no further left than its own indent', () => {
			expect(sanitizeHtml('<ul style="margin-left:-36pt"><li>a</li></ul>')).toContain('margin-left:-36pt');
			expect(sanitizeHtml('<ul style="margin-left:-37pt"><li>a</li></ul>')).toBe('<ul><li>a</li></ul>');
			expect(sanitizeHtml('<ol style="margin-left:-5000px"><li>a</li></ol>')).toBe('<ol><li>a</li></ol>');
			expect(sanitizeHtml('<ul style="margin-top:-18pt"><li>a</li></ul>')).toBe('<ul><li>a</li></ul>');
			expect(sanitizeHtml('<p style="margin-left:-18pt">a</p>')).toBe('<p>a</p>');
			expect(sanitizeHtml('<ul style="margin-left:-50%"><li>a</li></ul>')).toBe('<ul><li>a</li></ul>');
		});
	});

	describe('an id, in a browser', () => {
		// A browser gives every element's id as a name on `window`. The test DOM does not, so
		// that is stood in here; e2e/editor.spec.ts has the same in a real browser.
		const named: string[] = [];
		const nameOnWindow = (id: string) => {
			Object.defineProperty(globalThis, id, { configurable: true, get: () => document.getElementById(id) });
			named.push(id);
		};
		afterEach(() => {
			for (const id of named.splice(0)) delete (globalThis as Record<string, unknown>)[id];
			document.getElementById('dx-1')?.remove();
		});

		it('a document shown a second time keeps its ids: the first showing was taken for something of the page\'s own', () => {
			document.body.insertAdjacentHTML('beforeend', '<p id="dx-1">first</p>');
			nameOnWindow('dx-1');
			expect('dx-1' in globalThis).toBe(true);
			expect(sanitizeHtml('<p id="dx-1">again</p><p id="dx-2">new</p>')).toBe('<p id="dx-1">again</p><p id="dx-2">new</p>');
		});

		it('a name the page\'s scripts look up is still not given to an element', () => {
			(globalThis as Record<string, unknown>).reportSettings = { saveTo: 'https://x.test/' };
			named.push('reportSettings');
			expect(sanitizeHtml('<p id="location">a</p><p id="reportSettings">b</p><p id="cookie">c</p>')).toBe('<p>a</p><p>b</p><p>c</p>');
		});

		it('a link keeps no id: a script that finds a link where it looked up a name reads its address', () => {
			expect(sanitizeHtml('<a id="appConfig" href="https://evil.test/api">c</a>')).toBe('<a href="https://evil.test/api">c</a>');
			expect(sanitizeHtml('<a id="note-3">c</a>')).toBe('<a id="note-3">c</a>');
		});
	});

	describe('words are not put out of sight', () => {
		it('a first line does not start left of its paragraph: the editing area cut it off, and the RTF had it', () => {
			expect(sanitizeHtml('<p style="text-indent:-100%">FIRST LINE</p>')).toBe('<p>FIRST LINE</p>');
			expect(sanitizeHtml('<p style="text-indent:-2200px; color: red">FIRST LINE</p>')).toBe('<p style="color: red;">FIRST LINE</p>');
			expect(sanitizeHtml('<p style="margin-left: 24px; text-indent: -48px">FIRST LINE</p>')).toBe('<p style="margin-left: 24px;">FIRST LINE</p>');
			expect(sanitizeHtml('<li style="text-indent:-18pt">a</li>')).toBe('<li>a</li>');
		});

		it('a hanging indent, the first line as far left as the paragraph is moved in, stays as written', () => {
			for (const style of [
				'margin-left:48px;text-indent:-24px',
				'margin-left:36pt;text-indent:-36pt',
				'margin-left: 1.75in; text-indent: -1.75in',
				'margin: 0in 0in 0in 0.5in; text-indent: -0.25in',
				'padding-left: 2em; text-indent: -2em',
				'margin-left: 12pt; padding-left: 12pt; text-indent: -24pt',
				'text-indent: 24px',
				'text-indent: 5%'
			]) {
				expect(sanitizeHtml(`<p style="${style}">hang</p>`), style).toBe(`<p style="${style}">hang</p>`);
			}
			// Written right to left, the room is on the right.
			expect(sanitizeHtml('<p dir="rtl" style="margin-right: 36pt; text-indent: -36pt">x</p>')).toContain('text-indent: -36pt');
			expect(sanitizeHtml('<p dir="rtl" style="margin-left: 36pt; text-indent: -36pt">x</p>')).not.toContain('text-indent');
		});

		it('text of no size is given its size back: it was in the RTF and not on the screen', () => {
			for (const size of ['0', '0px', '0pt', '0.4px', '0em', '0%', '1%']) {
				expect(sanitizeHtml(`<p><span style="font-size:${size}">INVISIBLE</span>seen</p>`), size).toBe('<p><span>INVISIBLE</span>seen</p>');
			}
			for (const size of ['0.5pt', '1pt', '6pt', '50%', '0.5em', 'small', 'xxx-large', 'larger', 'smaller']) {
				expect(sanitizeHtml(`<p><span style="font-size:${size}">small</span></p>`), size).toContain(`font-size:${size}`);
			}
		});
	});

	describe('the words of elements side by side are not run together', () => {
		it('two boxes or two buttons side by side leave their words apart', () => {
			expect(sanitizeHtml('<p>Size <input value="1"><input value="5"> cm</p>')).toBe('<p>Size 1 5 cm</p>');
			expect(sanitizeHtml('<div><button>Save</button><button>Cancel</button></div>')).toBe('<div>Save Cancel</div>');
			expect(sanitizeHtml('<p><input value="a"><input type="checkbox"><input value="b"></p>')).toBe('<p>a b</p>');
			// One alone is not set apart from the words around it.
			expect(sanitizeHtml('<p>Press <button>Sign</button>.</p>')).toBe('<p>Press Sign.</p>');
		});

		it('a space in a formula is a space', () => {
			expect(sanitizeHtml('<p><math><mn>1</mn><mspace width="1em"></mspace><mn>2</mn></math></p>')).toBe('<p>1 2</p>');
		});

		it('a button written as an <input>, and an <input> of a kind no browser knows, show their value', () => {
			expect(sanitizeHtml('<p><input type="submit" value="Send"> or <input type="Button" value="Stop"> <input type="bogus" value="shown"></p>')).toBe('<p>Send or Stop shown</p>');
			expect(sanitizeHtml('<p>a<input type="submit">b</p>')).toBe('<p>ab</p>');
		});

		it('a list shown open leaves every entry chosen, and none where none is', () => {
			expect(sanitizeHtml('<p><select multiple><option selected>one</option><option selected>two</option><option>three</option></select></p>')).toBe('<p>one, two</p>');
			expect(sanitizeHtml('<p>a<select size="3"><option>one</option><option>two</option></select>b</p>')).toBe('<p>ab</p>');
			expect(sanitizeHtml('<p><select size="3"><option>one</option><option selected>two</option></select></p>')).toBe('<p>two</p>');
		});

		it('a formula written twice, once as text and once to be read aloud, is kept once', () => {
			const katex =
				'<p>Ki-67 <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mn>30</mn><mi mathvariant="normal">%</mi></mrow>' +
				'<annotation encoding="application/x-tex">30\\%</annotation></semantics></math></span>' +
				'<span class="katex-html" aria-hidden="true"><span class="mord">30</span><span class="mord">%</span></span></span> positive</p>';
			expect(parsed(katex).textContent).toBe('Ki-67 30% positive');
			// Alone, it is the only writing of the formula there is.
			expect(parsed('<p>Ki-67 <span class="katex-mathml"><math><mn>30</mn><mo>%</mo></math></span></p>').textContent).toBe('Ki-67 30%');
		});
	});

	describe('a size is kept within a page whatever it is counted in', () => {
		it('a text size counted in the size above it does not grow past a page by being nested', () => {
			const out = parsed('<a style="font-size:2200px"><span style="font-size:10000%;padding:137em">BIG</span></a>');
			expect(out.querySelector('span')!.hasAttribute('style')).toBe(false);
			const nested = parsed('<p>' + '<span style="font-size: 300%">'.repeat(8) + 'x' + '</span>'.repeat(8) + '</p>');
			// 16 px, three times over at each level: 48, 144, 432, 1296, and no further.
			expect(Array.from(nested.querySelectorAll('span')).map((span) => span.hasAttribute('style'))).toEqual([true, true, true, true, false, false, false, false]);
			const larger = parsed('<p>' + '<span style="font-size: larger">'.repeat(40) + 'x' + '</span>'.repeat(40) + '</p>');
			expect(larger.querySelectorAll('span[style]').length).toBe(27);
		});

		it('a length counted in ems is as long as the text there is large', () => {
			expect(styleOf('<div style="font-size: 1000px"><p style="padding-left: 3em">x</p></div>', 'p')).toBe('');
			expect(styleOf('<div><p style="padding-left: 3em">x</p></div>', 'p')).toBe('padding-left: 3em');
			expect(styleOf('<p style="font-size: 800px; margin-left: 3em">x</p>', 'p')).toBe('font-size: 800px;');
		});

		it('a piece of text inside a line has a little padding at most: more moved nothing and covered the lines around it', () => {
			expect(sanitizeHtml('<p><a href="https://example.com/" style="padding:2200px">link</a></p>')).toBe('<p><a href="https://example.com/">link</a></p>');
			expect(sanitizeHtml('<p><span style="padding: 40px 0">x</span><b style="padding-top: 10%">y</b></p>')).toBe('<p><span style="padding-right: 0px; padding-left: 0px;">x</span><b>y</b></p>');
			expect(sanitizeHtml('<p><span style="padding: 2px 4px">chip</span></p>')).toBe('<p><span style="padding: 2px 4px">chip</span></p>');
			expect(sanitizeHtml('<td style="padding: 40px">cell</td>')).toBe('cell');
			expect(sanitizeHtml('<table><tbody><tr><td style="padding: 40px">cell</td></tr></tbody></table>')).toContain('padding: 40px');
		});

		it('a width or height attribute is within a page too: width="100000" was a table that wide', () => {
			expect(sanitizeHtml('<table width="100000"><tbody><tr><td width="50%" height="99999">x</td></tr></tbody></table>')).toBe('<table><tbody><tr><td width="50%">x</td></tr></tbody></table>');
			expect(sanitizeHtml('<img src="https://x.test/a.png" width="300" height="200">')).toBe('<img src="https://x.test/a.png" width="300" height="200">');
			expect(sanitizeHtml('<img src="https://x.test/a.png" width="99999" height="1000%">')).toBe('<img src="https://x.test/a.png">');
			expect(sanitizeHtml('<table width="100%"><tbody><tr><td>x</td></tr></tbody></table>')).toContain('width="100%"');
		});

		it('an underline is no thicker than a border may be', () => {
			expect(sanitizeHtml('<u style="text-decoration-thickness: 5000px">x</u>')).toBe('<u>x</u>');
			expect(sanitizeHtml('<u style="text-decoration-thickness: 2px">x</u>')).toBe('<u style="text-decoration-thickness: 2px">x</u>');
		});
	});

	describe('what a paste loses on the way in', () => {
		const pasted = (html: string) => {
			const div = document.createElement('div');
			div.innerHTML = html;
			return div;
		};
		const count = (text: string) => text.replace(/\s/g, '').length;

		it('reads nothing from a paste with neither hidden text nor a text box', () => {
			expect(pasteNotes('<p>plain <b>words</b></p>')).toBeNull();
			expect(pasteNotes('')).toBeNull();
		});

		it('reads which of a paste\'s words Word hid, and what its text boxes held', () => {
			const notes = pasteNotes('<p>a<span style="mso-hide:all">SECRET</span>b</p><p>note <textarea>margins clear</textarea></p>')!;
			expect(notes.pieces.filter((piece) => piece.hidden).map((piece) => piece.text)).toEqual(['SECRET']);
			expect(notes.pieces.map((piece) => piece.text).join('')).toBe('aSECRETbnote ');
			expect(notes.textareas).toEqual(['margins clear']);
		});

		it('reads only what lies between the marks a program put around the part it copied', () => {
			const notes = pasteNotes('<html><head><title>Doc</title><style>p{color:red}</style></head><body>before<!--StartFragment--><p>Shown <span style="mso-hide:all">hidden</span>text</p><!--EndFragment-->after</body></html>')!;
			expect(notes.pieces.map((piece) => piece.text).join('')).toBe('Shown hiddentext');
		});

		it('takes the hidden words out of what the browser pasted as plain text', () => {
			const notes = pasteNotes('<p>a<span style="mso-hide:all">SECRET</span>b</p>')!;
			const root = pasted('<p>before </p><p>aSECRETb</p><p>after</p>');
			expect(removeWordHidden(root, count('before'), count('beforeaSECRETb'), notes)).toBe(true);
			expect(root.innerHTML).toBe('<p>before </p><p>ab</p><p>after</p>');
		});

		it('leaves one space where the hidden words stood between two, and takes a paragraph hidden whole', () => {
			const notes = pasteNotes('<p>one <span style="mso-hide:all">HID ONE</span> two</p><p style="mso-hide:all">whole para</p><p>three</p>')!;
			const root = pasted('<p>one HID ONE two</p><p>whole para</p><p>three</p>');
			expect(removeWordHidden(root, 0, count('oneHIDONEtwowholeparathree'), notes, () => true)).toBe(true);
			expect(root.innerHTML).toBe('<p>one two</p><p>three</p>');
			// Without leave to take elements out, the emptied one stays.
			const kept = pasted('<p>one HID ONE two</p><p>whole para</p><p>three</p>');
			removeWordHidden(kept, 0, count('oneHIDONEtwowholeparathree'), notes);
			expect(kept.innerHTML).toBe('<p>one two</p><p></p><p>three</p>');
		});

		it('does nothing where what was pasted is not the paste\'s text, character for character', () => {
			const notes = pasteNotes('<p>a<span style="mso-hide:all">SECRET</span>b</p>')!;
			for (const html of ['<p>aSECRETb!</p>', '<p>aSECRET</p>', '<p>SECRET</p>', '<p>ab</p>']) {
				const root = pasted(html);
				expect(removeWordHidden(root, 0, count(root.textContent!), notes), html).toBe(false);
				expect(root.innerHTML, html).toBe(html);
			}
		});

		it('finds the paste whether the browser brought along what was not displayed or left it out', () => {
			const notes = pasteNotes('<p>a<span style="display:none">gone</span><span style="mso-hide:all">SECRET</span>b</p>')!;
			const without = pasted('<p>aSECRETb</p>');
			expect(removeWordHidden(without, 0, 8, notes)).toBe(true);
			expect(without.innerHTML).toBe('<p>ab</p>');
			const along = pasted('<p>a<span style="display:none">gone</span>SECRETb</p>');
			expect(removeWordHidden(along, 0, 12, notes)).toBe(true);
			expect(along.innerHTML).toBe('<p>a<span style="display:none">gone</span>b</p>');
		});

		it('leaves a caret that stood after the hidden words where it was', () => {
			const notes = pasteNotes('<span style="mso-hide:all">all hidden</span>')!;
			const root = pasted('<p>xall hidden</p>');
			document.body.appendChild(root);
			const text = root.querySelector('p')!.firstChild as Text;
			const range = document.createRange();
			range.setStart(text, text.data.length);
			range.collapse(true);
			expect(removeWordHidden(root, 1, 10, notes)).toBe(true);
			expect(text.data).toBe('x');
			expect(range.startContainer).toBe(text);
			expect(range.startOffset).toBe(1);
			root.remove();
		});
	});
});
