import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { urlToImageSrc, IMAGE_FETCH_TIMEOUT_MS, MAX_FETCHED_IMAGE_BYTES } from '../images.js';

/**
 * Drives the editor component itself (not just the converters) to check the
 * insert / select / delete paths against a real DOM.
 */

const PNG_8x4 =
	'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAARElEQVR4nA3JMQHAQAwDMSMJEiMJEo+H4pEYSRC1WiWJERYrIp6oOCGZMTZrYp6pOf8RJjhsSHih4fJHmeKyJeWVlisfuy4oYXNbCeAAAAAASUVORK5CYII=';
const PNG_SRC = `data:image/png;base64,${PNG_8x4}`;

interface EditorApi {
	getHTML: () => string;
	setHTML: (html: string) => void;
	getRTF: () => string;
	getRtfSize: () => number;
	getMarkdown: () => string;
}

let host: HTMLDivElement;
let editor: EditorApi;

/** Base64 → a File, so the paste/drop handlers get real image bytes. */
function pngFile(name: string): File {
	const binary = atob(PNG_8x4);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new File([bytes], name, { type: 'image/png' });
}

function contentEl(): HTMLElement {
	const el = host.querySelector('.ink-content');
	if (!el) throw new Error('editor content element not found');
	return el as HTMLElement;
}

/** Fire a paste carrying image files, the way a browser delivers a screenshot. */
function pasteFiles(files: File[]): void {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: {
			items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
			getData: () => ''
		}
	});
	contentEl().dispatchEvent(event);
}

/** Fire a drop carrying image files, the way a file drag from the desktop arrives. */
function dropFiles(files: File[]): boolean {
	const event = new Event('drop', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'dataTransfer', {
		value: { files, types: ['Files'], items: [] }
	});
	Object.defineProperty(event, 'clientX', { value: 100 });
	Object.defineProperty(event, 'clientY', { value: 100 });
	return contentEl().dispatchEvent(event);
}

/** Wait for the FileReader/data-URL work kicked off by an insert to settle. */
/**
 * Wait for file reads and the inserts that follow them. A fixed 20 ms was enough on an idle
 * machine and not on a busy one with the test files running side by side, so this waits until the
 * page has stopped changing: the dialog no longer says it is inserting, and nothing moved across
 * three looks in a row.
 */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
	let last = '';
	let still = 0;
	for (let i = 0; i < 100 && still < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
		flushSync();
		const now = document.body.innerHTML;
		still = now === last && !now.includes('Inserting') ? still + 1 : 0;
		last = now;
	}
}

/** happy-dom does not implement the (deprecated) execCommand API browsers still expose. */
function shimExecCommand(): void {
	const doc = document as Document & {
		queryCommandState?: (cmd: string) => boolean;
		queryCommandValue?: (cmd: string) => string;
		execCommand?: (cmd: string, ui?: boolean, value?: string) => boolean;
	};
	doc.queryCommandState ??= () => false;
	doc.queryCommandValue ??= () => '';
	doc.execCommand ??= () => false;
}

beforeEach(() => {
	shimExecCommand();
	host = document.createElement('div');
	document.body.appendChild(host);
	editor = mount(InkEditor, {
		target: host,
		props: { autosave: false, content: '<p>Report body</p>' }
	}) as unknown as EditorApi;
	flushSync();
});

afterEach(() => {
	unmount(editor as never);
	host.remove();
});

describe('InkEditor image insertion', () => {
	it('inserts a pasted image as a figure with an empty description', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();

		const html = editor.getHTML();
		expect(html).toContain('<figure>');
		expect(html).toContain(`<img src="${PNG_SRC}"`);
		expect(html).toContain('<figcaption>');
	});

	it('inserts several pasted images as separate figures, in order', async () => {
		pasteFiles([pngFile('one.png'), pngFile('two.png'), pngFile('three.png')]);
		await settle();

		const html = editor.getHTML();
		expect(html.match(/<figure/g)?.length).toBe(3);
		expect(html.match(/<img /g)?.length).toBe(3);
		// The original paragraph is kept and the images follow it.
		expect(html.indexOf('Report body')).toBeLessThan(html.indexOf('<figure'));
	});

	it('keeps a paragraph after the image so typing can continue', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();

		const figure = contentEl().querySelector('figure');
		expect(figure?.nextElementSibling?.tagName).toBe('P');
	});

	it('exports inserted images to RTF as picture groups', async () => {
		pasteFiles([pngFile('a.png'), pngFile('b.png')]);
		await settle();

		const rtf = editor.getRTF();
		expect(rtf.match(/\{\\pict\\pngblip/g)?.length).toBe(2);
		expect(rtf).toContain('89504E47'); // PNG signature in the hex data
	});

	it('inserts images dropped onto the editor', async () => {
		const defaultPrevented = !dropFiles([pngFile('dropped.png'), pngFile('dropped-2.png')]);
		await settle();

		expect(defaultPrevented).toBe(true); // the browser must not navigate to the file
		expect(editor.getHTML().match(/<figure/g)?.length).toBe(2);
	});

	it('ignores drops that carry no images', async () => {
		const event = new Event('drop', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'dataTransfer', { value: { files: [], types: ['text/plain'] } });
		contentEl().dispatchEvent(event);
		await settle();

		expect(editor.getHTML()).not.toContain('<figure');
	});

	it('carries a typed description into the RTF and the Markdown export', async () => {
		pasteFiles([pngFile('slide.png')]);
		await settle();

		const caption = contentEl().querySelector('figcaption') as HTMLElement;
		caption.textContent = 'Section 4 — cut surface';

		expect(editor.getRTF()).toContain('{\\*\\inkcap}');
		expect(editor.getRTF()).toContain('Section 4 ');
		expect(editor.getMarkdown()).toContain('*Section 4 — cut surface*');
	});
});

describe('InkEditor insert dialog', () => {
	function openDialog(): void {
		const button = host.querySelector('button[title="Insert image"]') as HTMLElement;
		button.click();
		flushSync();
	}

	function chooseFiles(files: File[]): void {
		const input = host.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: files, configurable: true });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
	}

	function typeInto(placeholderStart: string, value: string): void {
		const inputs = Array.from(host.querySelectorAll('.modal input')) as HTMLInputElement[];
		const field = inputs.find((i) => (i.placeholder || '').startsWith(placeholderStart));
		if (!field) throw new Error(`no field starting with "${placeholderStart}"`);
		field.value = value;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	function clickInsert(): void {
		const insert = Array.from(host.querySelectorAll('.modal-actions button')).find(
			(b) => b.textContent?.trim() === 'Insert'
		) as HTMLElement;
		insert.click();
		flushSync();
	}

	it('offers file upload from the toolbar', () => {
		openDialog();
		const picker = host.querySelector('.ink-file-pick');
		expect(picker?.textContent).toContain('Choose images');
		expect(host.querySelector('input[type="file"][accept="image/*"]')?.hasAttribute('multiple')).toBe(
			true
		);
	});

	it('inserts a chosen file with the description typed in the dialog', async () => {
		openDialog();
		chooseFiles([pngFile('specimen.png')]);
		typeInto('Description', 'Specimen A, cut surface');
		clickInsert();
		await settle();

		const html = editor.getHTML();
		expect(html).toContain(`<img src="${PNG_SRC}"`);
		expect(html).toContain('<figcaption>Specimen A, cut surface</figcaption>');
	});

	it('inserts every chosen file when several are selected', async () => {
		openDialog();
		chooseFiles([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')]);
		clickInsert();
		await settle();

		expect(editor.getHTML().match(/<figure/g)?.length).toBe(3);
	});

	it('uses the file name as alt text when none is given', async () => {
		openDialog();
		chooseFiles([pngFile('liver-section.png')]);
		clickInsert();
		await settle();

		expect(editor.getHTML()).toContain('alt="liver-section"');
	});

	it('refuses an unsupported image address', async () => {
		openDialog();
		typeInto('https://', 'javascript:alert(1)');
		clickInsert();
		await settle();

		expect(editor.getHTML()).not.toContain('<img');
		expect(host.querySelector('.ink-toast-error')?.textContent).toContain('not supported');
	});
});

describe('InkEditor: a picture pasted with its text', () => {
	// A page copied from a browser brings its pictures as addresses (<img src="https://…">). Only
	// picture data held in the document reaches the RTF (issue #3, item 13).

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** What a browser does with a paste of HTML: the paste event, the markup, then the input event. */
	function pasteHtml(html: string): void {
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', { value: { items: [], getData: () => '' } });
		contentEl().dispatchEvent(event);
		contentEl().insertAdjacentHTML('beforeend', html);
		contentEl().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	function serveImages(): string[] {
		const fetched: string[] = [];
		vi.stubGlobal('fetch', async (url: string) => {
			fetched.push(url);
			return { ok: true, blob: async () => pngFile('fetched.png') };
		});
		return fetched;
	}

	it('is fetched and held in the document, so it reaches the RTF as a picture', async () => {
		const fetched = serveImages();
		pasteHtml('<p>Figure 1 <img src="https://x.test/figure.png" alt="figure"></p>');
		await settle();

		expect(fetched).toEqual(['https://x.test/figure.png']);
		const img = contentEl().querySelector('img')!;
		expect(img.getAttribute('src')).toBe(PNG_SRC);
		expect(img.getAttribute('alt')).toBe('figure');
		expect(editor.getRTF()).toContain('{\\pict\\pngblip');
		expect(editor.getRTF()).not.toContain('[Image:');
		expect(host.querySelector('.ink-toast-error')).toBeNull();
	});

	it('says so when it cannot be fetched, instead of leaving a placeholder to be found downstream', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});
		pasteHtml('<p>Figure 1 <img src="https://x.test/blocked.png" alt="figure"></p>');
		await settle();

		expect(contentEl().querySelector('img')!.getAttribute('src')).toBe('https://x.test/blocked.png');
		expect(host.querySelector('.ink-toast-error')?.textContent).toContain('A pasted image could not be embedded');
		expect(editor.getRTF()).toContain('[Image: figure]');
	});

	it('counts the pictures it could not embed', async () => {
		vi.stubGlobal('fetch', async () => ({ ok: false }));
		pasteHtml('<p><img src="https://x.test/a.png"><img src="https://x.test/b.png"></p>');
		await settle();

		expect(host.querySelector('.ink-toast-error')?.textContent).toContain('2 pasted images could not be embedded');
	});

	it('leaves alone a picture that is already data, and one that was in the document before the paste', async () => {
		editor.setHTML('<p>Body <img src="https://x.test/old.png" alt="old"></p>');
		const fetched = serveImages();
		pasteHtml(`<p><img src="${PNG_SRC}" alt="inline"></p>`);
		await settle();

		expect(fetched).toEqual([]);
		expect(contentEl().querySelector('img[alt="old"]')!.getAttribute('src')).toBe('https://x.test/old.png');
		expect(host.querySelector('.ink-toast-error')).toBeNull();
	});

	it('does not put data into a picture that was deleted while it was fetched', async () => {
		let release: () => void = () => {};
		vi.stubGlobal(
			'fetch',
			() => new Promise((resolve) => (release = () => resolve({ ok: true, blob: async () => pngFile('late.png') })))
		);
		pasteHtml('<p>Figure <img src="https://x.test/slow.png"></p>');
		const img = contentEl().querySelector('img')!;
		img.remove();
		release();
		await settle();

		expect(img.getAttribute('src')).toBe('https://x.test/slow.png');
		expect(host.querySelector('.ink-toast-error')).toBeNull();
	});

	it('typing after a paste does not fetch anything again', async () => {
		const fetched = serveImages();
		pasteHtml('<p><img src="https://x.test/figure.png"></p>');
		await settle();
		contentEl().insertAdjacentHTML('beforeend', '<p><img src="https://x.test/typed.png"></p>');
		contentEl().dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		expect(fetched).toEqual(['https://x.test/figure.png']);
	});

	it('one slow site does not hold up the other pictures in the paste', async () => {
		const fetched: string[] = [];
		vi.stubGlobal('fetch', (url: string) => {
			fetched.push(url);
			// The first site accepts the request and never answers.
			if (url.includes('hang')) return new Promise(() => {});
			return Promise.resolve({ ok: true, blob: async () => pngFile('b.png') });
		});
		pasteHtml('<p><img src="https://x.test/hang.png" alt="a"><img src="https://x.test/b.png" alt="b"></p>');
		await settle();

		expect(fetched).toEqual(['https://x.test/hang.png', 'https://x.test/b.png']);
		expect(contentEl().querySelector('img[alt="b"]')!.getAttribute('src')).toBe(PNG_SRC);
	});

	it('a picture pasted as GIF data, which the RTF cannot carry, is converted or reported', async () => {
		// happy-dom cannot draw a picture, so here the conversion a browser makes is unavailable and
		// the editor has to say so rather than let it leave as "[Image: …]".
		const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
		const fetched = serveImages();
		pasteHtml(`<p><img src="${GIF}" alt="gif"></p>`);
		await settle();

		expect(fetched).toEqual([]);
		expect(host.querySelector('.ink-toast-error')?.textContent).toContain('A pasted image could not be embedded');
	});
});

describe('InkEditor: maxImageBytes is a ceiling', () => {
	// The test DOM cannot redraw a picture, which makes every picture over the limit one that
	// cannot be brought under it: the case in which the editor must refuse it (issue #21, item 30).
	// That a picture a browser can redraw is shrunk to fit is in image-cap.test.ts.

	beforeEach(() => {
		unmount(editor as never);
		host.innerHTML = '';
		editor = mount(InkEditor, {
			target: host,
			props: { autosave: false, content: '<p>Report body</p>', maxImageBytes: 10 }
		}) as unknown as EditorApi;
		flushSync();
	});

	function pasteHtml(html: string): void {
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', { value: { items: [], getData: () => '' } });
		contentEl().dispatchEvent(event);
		contentEl().insertAdjacentHTML('beforeend', html);
		contentEl().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	const toast = () => host.querySelector('.ink-toast-error')?.textContent?.trim() ?? '';

	it('a dropped picture that cannot be brought under it is not inserted, and the editor says why', async () => {
		dropFiles([pngFile('slide.png')]);
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(toast()).toBe('This picture could not be made small enough for the 10 bytes size limit');
		expect(editor.getRTF()).not.toContain('\\pict');
	});

	it('a pasted picture file is refused the same way', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(toast()).toContain('could not be made small enough');
	});

	it('picture data pasted with text is taken out again, so it cannot leave in the RTF at full size', async () => {
		pasteHtml(`<p>Figure 1 <img src="${PNG_SRC}" alt="figure"> shows the margin.</p>`);
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(contentEl().textContent).toContain('Figure 1  shows the margin.');
		expect(toast()).toBe('A pasted picture was over the size limit and could not be made smaller, so it was left out');
		expect(editor.getRTF()).not.toContain('\\pict');
	});

	it('counts the pasted pictures it left out', async () => {
		pasteHtml(`<p><img src="${PNG_SRC}" alt="a"><img src="${PNG_SRC}" alt="b"></p>`);
		await settle();

		expect(contentEl().querySelectorAll('img').length).toBe(0);
		expect(toast()).toContain('2 pasted pictures were over the size limit');
	});

	it('picture data typed into the image dialog is not inserted', async () => {
		(host.querySelector('button[title="Insert image"]') as HTMLElement).click();
		flushSync();
		const field = (Array.from(host.querySelectorAll('.modal input')) as HTMLInputElement[]).find((i) =>
			(i.placeholder || '').startsWith('https://')
		)!;
		field.value = PNG_SRC;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		(Array.from(host.querySelectorAll('.modal-actions button')).find((b) => b.textContent?.trim() === 'Insert') as HTMLElement).click();
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(toast()).toBe('That picture is over the size limit and could not be made smaller, so it was not inserted');
	});

	it('a picture within the limit is inserted as before', async () => {
		unmount(editor as never);
		host.innerHTML = '';
		editor = mount(InkEditor, {
			target: host,
			props: { autosave: false, content: '<p>Report body</p>', maxImageBytes: 100000 }
		}) as unknown as EditorApi;
		flushSync();
		dropFiles([pngFile('slide.png')]);
		await settle();

		expect(contentEl().querySelector('img')!.getAttribute('src')).toBe(PNG_SRC);
		expect(toast()).toBe('');
	});
});

describe('InkEditor: a pasted picture that is left out takes what was only there for it', () => {
	// Review of the image limit, findings 2, 4 and 5. With a limit of 10 bytes and no canvas in
	// the test DOM, every picture pasted as data is one that cannot be brought under the limit,
	// and is taken out of the paste. Invented text.

	beforeEach(() => {
		unmount(editor as never);
		host.innerHTML = '';
		editor = mount(InkEditor, {
			target: host,
			props: { autosave: false, content: '<p>Report body</p>', maxImageBytes: 10 }
		}) as unknown as EditorApi;
		flushSync();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	/** The paste event, then what the browser does with it, then the input event. */
	function paste(insert: () => void): void {
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', { value: { items: [], getData: () => '' } });
		contentEl().dispatchEvent(event);
		insert();
		contentEl().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}
	const pasteHtml = (html: string) => paste(() => contentEl().insertAdjacentHTML('beforeend', html));
	const toast = () => host.querySelector('.ink-toast-error')?.textContent?.trim() ?? '';
	const IMG = `<img src="${PNG_SRC}" alt="scan">`;
	const LEFT_OUT = 'A pasted picture was over the size limit and could not be made smaller, so it was left out';

	function caretIn(el: Element, offset: number): void {
		const range = document.createRange();
		range.setStart(el, offset);
		range.collapse(true);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
	}

	it('its figure and caption go with it, and the paragraph it emptied does not stay', async () => {
		// Left: <figure><figcaption>Figure 1. The scan</figcaption></figure><p></p>, and the RTF
		// carried the caption of a picture that was not there, then a blank paragraph.
		pasteHtml(`<figure>${IMG}<figcaption>Figure 1. The scan</figcaption></figure><p>${IMG}</p>`);
		await settle();

		expect(contentEl().innerHTML).toBe('<p>Report body</p>');
		expect(editor.getRTF()).not.toContain('Figure 1');
		expect(editor.getRTF()).toBe(
			(() => {
				unmount(editor as never);
				host.innerHTML = '';
				editor = mount(InkEditor, { target: host, props: { autosave: false, content: '<p>Report body</p>' } }) as unknown as EditorApi;
				flushSync();
				return editor.getRTF();
			})()
		);
	});

	describe('as Chromium pastes a figure at the end of a line of text', () => {
		// Seen in Chromium 156: the picture is moved into the line the caret was in, and the
		// figure is left after it holding the caption alone.
		const CAPTION_ALONE = '<figure><figcaption>Figure 1. The scan</figcaption></figure>';
		const intoBody = (rest: string) =>
			paste(() => {
				contentEl().querySelector('p')!.insertAdjacentHTML('beforeend', IMG);
				contentEl().insertAdjacentHTML('beforeend', rest);
			});

		it('the caption left in a figure of its own goes with the picture', async () => {
			intoBody(`${CAPTION_ALONE}<p>${IMG}</p>`);
			await settle();

			expect(contentEl().innerHTML).toBe('<p>Report body</p>');
			expect(editor.getRTF()).not.toContain('Figure 1');
		});

		it('and so does a whole figure pasted after it', async () => {
			intoBody(`${CAPTION_ALONE}<figure>${IMG}<figcaption>Figure 2. The margin</figcaption></figure>`);
			await settle();

			expect(contentEl().innerHTML).toBe('<p>Report body</p>');
		});

		it('a caption in a figure of its own that was there before the paste stays', async () => {
			editor.setHTML('<p>Report body</p><figure><figcaption>An older caption</figcaption></figure>');
			flushSync();
			intoBody('');
			await settle();

			expect(contentEl().innerHTML).toBe('<p>Report body</p><figure><figcaption>An older caption</figcaption></figure>');
		});

		it('a pasted one that does not come straight after the picture stays: words stand between', async () => {
			pasteHtml(`<p>Scan ${IMG} is clear.</p><figure><figcaption>Kept words</figcaption></figure>`);
			await settle();

			expect(contentEl().innerHTML).toBe(
				'<p>Report body</p><p>Scan  is clear.</p><figure><figcaption>Kept words</figcaption></figure>'
			);
		});

		it('a pasted figure after the picture that has a picture of its own stays', async () => {
			vi.stubGlobal('fetch', async () => {
				throw new TypeError('Failed to fetch');
			});
			intoBody('<figure><img src="https://x.test/chart.png" alt="chart"><figcaption>The chart</figcaption></figure>');
			await settle();

			expect(contentEl().querySelector('figure img')!.getAttribute('alt')).toBe('chart');
			expect(contentEl().querySelector('figcaption')!.textContent).toBe('The chart');
		});
	});

	describe('what a second review found, in the shapes Chromium 156 makes', () => {
		const CAPTION_ALONE = '<figure><figcaption>Figure 1. The scan</figcaption></figure>';
		const KEPT = '<img src="https://x.test/chart.png" alt="chart">';
		const offline = () =>
			vi.stubGlobal('fetch', async () => {
				throw new TypeError('Failed to fetch');
			});
		/** The pictures of a figure moved into the line the caret was in, and what was left of the figure after it. */
		const intoBody = (pictures: string, rest: string) =>
			paste(() => {
				contentEl().querySelector('p')!.insertAdjacentHTML('beforeend', pictures);
				contentEl().insertAdjacentHTML('beforeend', rest);
			});

		it('a caption left alone inside the wrapper its figure came in goes with the picture, and the wrapper too', async () => {
			// The wrapper stood between the picture and its caption, and the caption stayed.
			for (const [open, close] of [['<div>', '</div>'], ['<section>', '</section>'], ['<a href="https://x.test/">', '</a>'], ['<section><div>', '</div></section>']]) {
				editor.setHTML('<p>Report body</p>');
				flushSync();
				intoBody(IMG, `${open}${CAPTION_ALONE}${close}`);
				await settle();
				expect(contentEl().innerHTML, open).toBe('<p>Report body</p>');
			}
		});

		it('a comment between the picture and its caption does not hide the caption', async () => {
			intoBody(IMG, `<!--StartFragment-->${CAPTION_ALONE}`);
			await settle();

			expect(contentEl().querySelector('figure')).toBeNull();
			expect(contentEl().textContent).toBe('Report body');
		});

		it('a wrapper that holds words beside the caption stays whole', async () => {
			intoBody(IMG, `<div>${CAPTION_ALONE}<p>Other words</p></div>`);
			await settle();

			expect(contentEl().innerHTML).toBe(`<p>Report body</p><div>${CAPTION_ALONE}<p>Other words</p></div>`);
		});

		it('a pasted wrapper around a picture and its caption alone goes whole', async () => {
			pasteHtml(`<div><p>${IMG}</p>${CAPTION_ALONE}</div>`);
			await settle();

			expect(contentEl().innerHTML).toBe('<p>Report body</p>');
		});

		it('the caption stays while a picture pasted with it is still there before it', async () => {
			// Both pictures of one figure are moved into the line. The caption went with the
			// second although the first stayed.
			offline();
			intoBody(`${KEPT}${IMG}`, CAPTION_ALONE);
			await settle();

			expect(contentEl().innerHTML).toBe(`<p>Report body${KEPT}</p>${CAPTION_ALONE}`);
		});

		it('and while one is still there after it', async () => {
			offline();
			intoBody(`${IMG}${KEPT}`, CAPTION_ALONE);
			await settle();

			expect(contentEl().innerHTML).toBe(`<p>Report body${KEPT}</p>${CAPTION_ALONE}`);
		});

		it('with both pictures gone, the caption goes', async () => {
			intoBody(`${IMG}${IMG}`, CAPTION_ALONE);
			await settle();

			expect(contentEl().innerHTML).toBe('<p>Report body</p>');
		});

		describe('an empty line the paste took the place of', () => {
			// Chromium puts a pasted block in the place of the empty line the caret was in: the
			// line itself is gone. With the picture taken out, a blank line of the report was lost.
			const replaceLine = (html: string): Element => {
				const line = contentEl().querySelectorAll('p')[1];
				paste(() => {
					const holder = document.createElement('div');
					holder.innerHTML = html;
					line.replaceWith(...Array.from(holder.childNodes));
				});
				return line;
			};

			beforeEach(() => {
				editor.setHTML('<p>A</p><p><br></p><p>B</p>');
				flushSync();
			});

			it('is put back when nothing of the paste is left: the same line, where it was', async () => {
				for (const pasted of [`<figure>${IMG}<figcaption>Figure 1</figcaption></figure>`, `<p>${IMG}</p>`]) {
					editor.setHTML('<p>A</p><p><br></p><p>B</p>');
					flushSync();
					const line = replaceLine(pasted);
					await settle();

					expect(contentEl().innerHTML, pasted).toBe('<p>A</p><p><br></p><p>B</p>');
					expect(contentEl().querySelectorAll('p')[1], pasted).toBe(line);
					expect(editor.getRTF(), pasted).toContain('A\\par \\par ');
				}
			});

			it('is put back where the paste stood when the paste goes in more than one step', async () => {
				// The first picture goes with its paragraph, then the block around both with the second.
				const line = replaceLine(`<div><p>${IMG}</p><p>${IMG}</p></div>`);
				await settle();

				expect(contentEl().innerHTML).toBe('<p>A</p><p><br></p><p>B</p>');
				expect(contentEl().querySelectorAll('p')[1]).toBe(line);
			});

			it('takes the caret, when the caret was in what went', async () => {
				const line = replaceLine(`<p>${IMG}</p>`);
				caretIn(contentEl().querySelectorAll('p')[1], 1);
				await settle();

				expect(line.contains(window.getSelection()!.anchorNode)).toBe(true);
			});

			it('takes the caret from the line after it, where Chromium leaves it when it pastes a block', async () => {
				const line = replaceLine(`<figure>${IMG}<figcaption>Figure 1</figcaption></figure>`);
				caretIn(contentEl().querySelectorAll('p')[1], 0);
				await settle();

				expect(line.contains(window.getSelection()!.anchorNode)).toBe(true);
			});

			it('gets its line break again: Chromium takes that out of the line before it takes the line out', async () => {
				const line = contentEl().querySelectorAll('p')[1];
				line.innerHTML = '';
				paste(() => {
					const pasted = document.createElement('p');
					pasted.innerHTML = IMG;
					line.replaceWith(pasted);
				});
				await settle();

				expect(contentEl().innerHTML).toBe('<p>A</p><p><br></p><p>B</p>');
			});

			it('is not put back when the paste left words: they stand where it was', async () => {
				replaceLine(`<p>${IMG}</p><p>Tail</p>`);
				await settle();

				expect(contentEl().innerHTML).toBe('<p>A</p><p>Tail</p><p>B</p>');
			});

			it('is not put back when a picture of the paste stayed', async () => {
				offline();
				replaceLine(`<p>${IMG}</p><p>${KEPT}</p>`);
				await settle();

				expect(contentEl().innerHTML).toBe(`<p>A</p><p>${KEPT}</p><p>B</p>`);
			});

			it('in a quotation it is put back inside the quotation', async () => {
				editor.setHTML('<blockquote><p>Quoted</p><p><br></p></blockquote><p>B</p>');
				flushSync();
				replaceLine(`<p>${IMG}</p>`);
				await settle();

				expect(contentEl().innerHTML).toBe('<blockquote><p>Quoted</p><p><br></p></blockquote><p>B</p>');
			});
		});

		describe('the caret', () => {
			it('inside a line that stays, is left where the picture was, not moved to the end of the line', async () => {
				pasteHtml(`<p>before <a href="https://x.test/">${IMG}</a> after</p>`);
				const line = contentEl().querySelectorAll('p')[1];
				caretIn(line.querySelector('a')!, 1);
				await settle();

				expect(line.innerHTML).toBe('before  after');
				const selection = window.getSelection()!;
				expect(selection.anchorNode).toBe(line);
				expect(selection.anchorOffset).toBe(1);
			});

			it('is not put inside a picture that stands before it: an empty line is left for it', async () => {
				offline();
				editor.setHTML('');
				flushSync();
				pasteHtml(`${KEPT}<p>${IMG}</p>`);
				caretIn(contentEl().querySelector('p')!, 1);
				await settle();

				expect(contentEl().innerHTML).toBe(`${KEPT}<p><br></p>`);
				expect(contentEl().querySelector('p')!.contains(window.getSelection()!.anchorNode)).toBe(true);
			});
		});

		it('no line break is put into bold text or a link that was there before and is empty again', async () => {
			editor.setHTML('<p>Report <b></b>body</p>');
			flushSync();
			const bold = contentEl().querySelector('b')!;
			paste(() => (bold.innerHTML = IMG));
			await settle();

			expect(contentEl().innerHTML).toBe('<p>Report <b></b>body</p>');
			expect(editor.getRTF()).not.toContain('\\line');
		});
	});

	it('text that shared its paragraph stays, and so does the paragraph', async () => {
		pasteHtml(`<p>Margin ${IMG} is clear.</p><p>${IMG}Second line</p>`);
		await settle();

		expect(contentEl().innerHTML).toBe('<p>Report body</p><p>Margin  is clear.</p><p>Second line</p>');
	});

	it('a link that held only the picture goes, and one with words keeps them', async () => {
		pasteHtml(`<p><a href="https://x.test/a">${IMG}</a></p><p><a href="https://x.test/b">${IMG} the atlas</a></p>`);
		await settle();

		expect(contentEl().innerHTML).toBe('<p>Report body</p><p><a href="https://x.test/b"> the atlas</a></p>');
	});

	it('a list item that held only the picture goes; the list stays while it has another item', async () => {
		pasteHtml(`<ul><li>${IMG}</li><li>Second</li></ul><ol><li>${IMG}</li></ol>`);
		await settle();

		expect(contentEl().innerHTML).toBe('<p>Report body</p><ul><li>Second</li></ul>');
	});

	it('a paragraph that still shows something without words (a rule, a drawing) stays', async () => {
		pasteHtml(`<div>${IMG}<hr></div><p>${IMG}<svg width="10" height="10"></svg></p>`);
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(contentEl().querySelector('div > hr')).not.toBeNull();
		expect(contentEl().querySelector('p > svg')).not.toBeNull();
	});

	it('a table cell stays, since the table needs it', async () => {
		pasteHtml(`<table><tbody><tr><td><p>${IMG}</p></td><td>B</td></tr></tbody></table>`);
		await settle();

		expect(contentEl().querySelectorAll('td').length).toBe(2);
		expect(contentEl().querySelector('td')!.innerHTML).toBe('');
		expect(contentEl().querySelector('img')).toBeNull();
	});

	it('a figure with another picture in it keeps that picture and the caption', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});
		pasteHtml(`<figure>${IMG}<img src="https://x.test/chart.png" alt="chart"><figcaption>Both views</figcaption></figure>`);
		await settle();

		const figure = contentEl().querySelector('figure')!;
		expect(figure.querySelectorAll('img').length).toBe(1);
		expect(figure.querySelector('img')!.getAttribute('alt')).toBe('chart');
		expect(figure.querySelector('figcaption')!.textContent).toBe('Both views');
	});

	it('a figure with words of its own, outside the caption, keeps them', async () => {
		pasteHtml(`<figure>${IMG}<p>Stained section</p><figcaption>Figure 2</figcaption></figure>`);
		await settle();

		expect(contentEl().querySelector('figure')!.innerHTML).toBe('<p>Stained section</p><figcaption>Figure 2</figcaption>');
	});

	it('a line that was in the document before the paste stays a line', async () => {
		editor.setHTML('<p>Report body</p><p><br></p>');
		flushSync();
		const line = contentEl().querySelectorAll('p')[1];
		// A browser pasting into an empty line puts the picture in place of its line break.
		paste(() => (line.innerHTML = IMG));
		await settle();

		expect(contentEl().innerHTML).toBe('<p>Report body</p><p><br></p>');
	});

	it('the caret, when it was in what went, moves to the end of the text before it', async () => {
		pasteHtml(`<p>${IMG}</p>`);
		const pasted = contentEl().querySelectorAll('p')[1];
		caretIn(pasted, 1);
		await settle();

		expect(contentEl().innerHTML).toBe('<p>Report body</p>');
		const selection = window.getSelection()!;
		expect(contentEl().querySelector('p')!.contains(selection.anchorNode)).toBe(true);
		expect(selection.getRangeAt(0).collapsed).toBe(true);
	});

	it('with nothing else to type in, one empty line is left for the caret', async () => {
		editor.setHTML('');
		flushSync();
		pasteHtml(`<p>${IMG}</p>`);
		caretIn(contentEl().querySelector('p')!, 1);
		await settle();

		expect(contentEl().innerHTML).toBe('<p><br></p>');
		expect(contentEl().querySelector('p')!.contains(window.getSelection()!.anchorNode)).toBe(true);
	});

	it('the caret keeps its place when what held it goes in more than one step', async () => {
		// The first paragraph goes with its picture, then the block around both with the second.
		editor.setHTML('');
		flushSync();
		pasteHtml(`<div><p>${IMG}</p><p>${IMG}</p></div>`);
		caretIn(contentEl().querySelector('div > p')!, 1);
		await settle();

		expect(contentEl().innerHTML).toBe('<p><br></p>');
		expect(contentEl().querySelector('p')!.contains(window.getSelection()!.anchorNode)).toBe(true);
	});

	it('a caret somewhere else is left where it was', async () => {
		pasteHtml(`<p>${IMG}</p>`);
		const body = contentEl().querySelector('p')!.firstChild!;
		caretIn(body as unknown as Element, 6);
		await settle();

		const selection = window.getSelection()!;
		expect(selection.anchorNode).toBe(body);
		expect(selection.anchorOffset).toBe(6);
	});

	it('it is no longer the selected picture: Backspace is left to the text', async () => {
		// Clicked while it was still there, it stayed the selected picture after it was gone, and
		// the next Backspace was taken to remove it instead of a letter.
		pasteHtml(`<p>Margin ${IMG}</p>`);
		const img = contentEl().querySelector('img') as HTMLElement;
		img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		const key = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
		contentEl().dispatchEvent(key);
		expect(key.defaultPrevented).toBe(false);
	});

	it('one picture left out and one that cannot be fetched: the editor says both', async () => {
		// Only the first was said, and the second left as "[Image: chart]" with no word of it.
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});
		pasteHtml(`<p>Scan ${IMG} and chart <img src="https://x.test/chart.png" alt="chart"></p>`);
		await settle();

		expect(toast()).toBe(`${LEFT_OUT}. A pasted image could not be embedded — it will export as a placeholder`);
		expect(editor.getRTF()).toContain('[Image: chart]');
	});

	it('a slow site does not hold up taking the picture out, or saying so', async () => {
		vi.stubGlobal('fetch', () => new Promise(() => {}));
		pasteHtml(`<p>Scan ${IMG} and chart <img src="https://x.test/hang.png" alt="chart"></p>`);
		await settle();

		expect(contentEl().querySelectorAll('img').length).toBe(1);
		expect(toast()).toBe(LEFT_OUT);
	});

	it('counts each kind on its own', async () => {
		vi.stubGlobal('fetch', async () => ({ ok: false }));
		pasteHtml(`<p>${IMG}${IMG}<img src="https://x.test/a.png"><img src="https://x.test/b.png"><img src="https://x.test/c.png"></p>`);
		await settle();

		expect(toast()).toBe(
			'2 pasted pictures were over the size limit and could not be made smaller, so they were left out. ' +
				'3 pasted images could not be embedded — they will export as placeholders'
		);
	});

	it('a message that says two things stays up long enough to read both', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});
		pasteHtml(`<p>${IMG}<img src="https://x.test/chart.png"></p>`);
		await vi.advanceTimersByTimeAsync(100);
		flushSync();
		expect(toast()).toContain('left out. A pasted image');

		// A message of one thing is up for four seconds; this one is twice as long.
		await vi.advanceTimersByTimeAsync(6000);
		flushSync();
		expect(toast()).toContain('left out. A pasted image');
		await vi.advanceTimersByTimeAsync(6000);
		flushSync();
		expect(toast()).toBe('');
	});

	it('a message of one thing is up for four seconds, as before', async () => {
		vi.useFakeTimers();
		pasteHtml(`<p>${IMG}</p>`);
		await vi.advanceTimersByTimeAsync(3900);
		flushSync();
		expect(toast()).toBe(LEFT_OUT);
		await vi.advanceTimersByTimeAsync(4800 - 3900);
		flushSync();
		expect(toast()).toBe('');
	});

	it("an earlier message's clock does not take a later message down early", async () => {
		vi.useFakeTimers();
		pasteHtml(`<p>${IMG}</p>`);
		await vi.advanceTimersByTimeAsync(3000);
		pasteHtml(`<p>${IMG}</p>`);
		await vi.advanceTimersByTimeAsync(3000);
		flushSync();
		// Six seconds after the first message, three after the second.
		expect(toast()).toBe(LEFT_OUT);
	});
});

describe('InkEditor: a picture the browser cannot open', () => {
	// Review of the image limit, finding 3. A TIFF, or a damaged file, was refused as too large
	// when it was over the limit and inserted as a broken picture when under it. The limit here
	// is the default, and the picture is far under it: size has nothing to do with it.
	// The test DOM has no canvas and loads no pictures, so a browser that has a canvas and fails
	// to open the picture is stood in.

	const TIFF_SRC = 'data:image/tiff;base64,SUkqAAgAAAAAAAAAAAAAAA==';
	const toast = () => host.querySelector('.ink-toast-error')?.textContent?.trim() ?? '';

	beforeEach(() => {
		const realCreate = document.createElement.bind(document);
		vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
			tag === 'canvas' ? ({ getContext: () => ({}) } as unknown as HTMLElement) : realCreate(tag)) as typeof document.createElement);
		vi.stubGlobal(
			'Image',
			class {
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				set src(_value: string) {
					queueMicrotask(() => this.onerror?.());
				}
			}
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function tiffFile(): File {
		return new File([new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])], 'slide.tiff', { type: 'image/tiff' });
	}

	it('dropped as a file: not inserted, and the editor says it could not be opened', async () => {
		dropFiles([tiffFile()]);
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(toast()).toBe('This picture could not be opened: the browser cannot show its format, or the file is damaged');
		expect(toast()).not.toContain('size limit');
	});

	it('pasted as a file: the same', async () => {
		pasteFiles([tiffFile()]);
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(toast()).toContain('could not be opened');
	});

	it('given to the image dialog as data: not inserted, with the same reason', async () => {
		(host.querySelector('button[title="Insert image"]') as HTMLElement).click();
		flushSync();
		const field = (Array.from(host.querySelectorAll('.modal input')) as HTMLInputElement[]).find((i) =>
			(i.placeholder || '').startsWith('https://')
		)!;
		field.value = TIFF_SRC;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		(Array.from(host.querySelectorAll('.modal-actions button')).find((b) => b.textContent?.trim() === 'Insert') as HTMLElement).click();
		await settle();

		expect(contentEl().querySelector('img')).toBeNull();
		expect(toast()).toBe(
			'That picture could not be opened (the browser cannot show its format, or it is damaged), so it was not inserted'
		);
	});

	it('pasted with text: taken out, the text kept, and the editor says why', async () => {
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', { value: { items: [], getData: () => '' } });
		contentEl().dispatchEvent(event);
		contentEl().insertAdjacentHTML(
			'beforeend',
			`<p>Slide <img src="${TIFF_SRC}" alt="slide"> at low power.</p><figure><img src="${TIFF_SRC}"><figcaption>Figure 3</figcaption></figure>`
		);
		contentEl().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await settle();

		expect(contentEl().innerHTML).toBe('<p>Report body</p><p>Slide  at low power.</p>');
		expect(toast()).toBe(
			'2 pasted pictures could not be opened (the browser cannot show their format, or they are damaged), so they were left out'
		);
		expect(editor.getRTF()).not.toContain('[Image:');
	});
});

describe('urlToImageSrc: a picture fetched by address', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('gives up after IMAGE_FETCH_TIMEOUT_MS, and the picture keeps its address', async () => {
		vi.useFakeTimers();
		let aborted = false;
		vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => {
					aborted = true;
					reject(new DOMException('aborted', 'AbortError'));
				});
			})
		);
		const pending = urlToImageSrc('https://x.test/slow.png');
		await vi.advanceTimersByTimeAsync(IMAGE_FETCH_TIMEOUT_MS + 1);
		expect(await pending).toEqual({ src: 'https://x.test/slow.png', embedded: false });
		expect(aborted).toBe(true);
	});

	it('refuses a picture that says it is larger than MAX_FETCHED_IMAGE_BYTES, without reading it', async () => {
		let read = false;
		vi.stubGlobal('fetch', async () => ({
			ok: true,
			headers: { get: (name: string) => (name === 'content-length' ? String(MAX_FETCHED_IMAGE_BYTES + 1) : null) },
			blob: async () => {
				read = true;
				return pngFile('huge.png');
			}
		}));
		expect(await urlToImageSrc('https://x.test/huge.png')).toEqual({ src: 'https://x.test/huge.png', embedded: false });
		expect(read).toBe(false);
	});
});

describe('InkEditor image selection', () => {
	it('removes the selected image on Backspace', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();
		expect(editor.getHTML()).toContain('<figure>');

		const img = contentEl().querySelector('img') as HTMLElement;
		img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		contentEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
		flushSync();

		expect(editor.getHTML()).not.toContain('<figure>');
		expect(editor.getHTML()).not.toContain('<img');
	});

	it('stops targeting the image once the user types elsewhere', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();

		// Typing in the paragraph below the picture drops the image selection, so
		// Backspace edits that text instead of deleting the picture.
		const paragraph = contentEl().querySelector('figure + p') as HTMLElement;
		paragraph.textContent = 'Gross description';
		contentEl().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		contentEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
		flushSync();

		expect(editor.getHTML()).toContain('<figure>');
		expect(editor.getHTML()).toContain('Gross description');
	});

	it('stops targeting the image when the caret is moved away', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();

		contentEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		flushSync();
		contentEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
		flushSync();

		expect(editor.getHTML()).toContain('<figure>');
	});

	it('keeps the selection frame out of the exported HTML', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();

		const img = contentEl().querySelector('img') as HTMLElement;
		img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();

		expect(editor.getHTML()).not.toContain('ink-img-frame');
		expect(editor.getHTML()).not.toContain('contenteditable');
	});
});

describe('InkEditor size reporting', () => {
	it('reports the exact byte size of the RTF', async () => {
		pasteFiles([pngFile('scan.png')]);
		await settle();

		expect(editor.getRtfSize()).toBe(editor.getRTF().length);
	});

	it('grows by twice the picture bytes when an image is added', async () => {
		const before = editor.getRtfSize();
		pasteFiles([pngFile('scan.png')]);
		await settle();

		const growth = editor.getRtfSize() - before;
		const pictureBytes = 125; // the 8x4 PNG fixture
		expect(growth).toBeGreaterThanOrEqual(pictureBytes * 2);
	});

	it('reports an estimate on every change', async () => {
		const seen: number[] = [];
		const host2 = document.createElement('div');
		document.body.appendChild(host2);
		const ed = mount(InkEditor, {
			target: host2,
			props: {
				autosave: false,
				content: '<p>Report body</p>',
				onchange: (payload: { estimatedRtfBytes: number }) => seen.push(payload.estimatedRtfBytes)
			}
		}) as unknown as EditorApi;
		flushSync();

		const content = host2.querySelector('.ink-content') as HTMLElement;
		content.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		expect(seen.length).toBeGreaterThan(0);
		expect(seen[seen.length - 1]).toBeGreaterThan(0);
		// Close to the real thing for a text-only document.
		expect(Math.abs(seen[seen.length - 1] - ed.getRtfSize())).toBeLessThan(150);

		unmount(ed as never);
		host2.remove();
	});
});

describe('InkEditor image round-trip', () => {
	it('reloads exported RTF back into the same figures', async () => {
		pasteFiles([pngFile('one.png'), pngFile('two.png')]);
		await settle();

		const captions = contentEl().querySelectorAll('figcaption');
		captions[0].textContent = 'Anterior view';
		captions[1].textContent = 'Posterior view';

		const rtf = editor.getRTF();
		const { rtfToHtml } = await import('../rtf-parser.js');
		editor.setHTML(rtfToHtml(rtf));
		flushSync();

		const html = editor.getHTML();
		expect(html.match(/<figure/g)?.length).toBe(2);
		expect(html).toContain('Anterior view');
		expect(html).toContain('Posterior view');
		expect(html.match(/data:image\/png;base64,/g)?.length).toBe(2);
	});
});
