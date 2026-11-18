// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { sanitizeHtml } from '../sanitize.js';
import { htmlToRtf } from '../rtf-writer.js';
import { htmlToMarkdown } from '../utils.js';

// happy-dom has none of the editing commands the editor asks the browser about.
const doc = document as unknown as { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

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

	it('takes out the elements that run code, load a page of their own or take input, with what is in them', () => {
		const div = parsed(
			'<p>kept</p><script>a()</script><style>*{color:red}</style><iframe src="https://x.test/"></iframe><object></object><embed>' +
				'<svg onload="b()"><circle r="1"></circle></svg><math><mi>x</mi></math><form action="https://x.test/"><input name="q"><button>Go</button><select><option>o</option></select><textarea>t</textarea>in a form</form>' +
				'<video></video><audio></audio><link rel="stylesheet" href="data:text/css,"><meta http-equiv="refresh" content="0"><base href="https://x.test/">'
		);
		expect(Array.from(div.querySelectorAll('*')).map((el) => el.tagName.toLowerCase())).toEqual(['p', 'form']);
		expect(div.querySelector('form')!.attributes.length).toBe(0);
		expect(div.textContent).toBe('keptin a form');
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
