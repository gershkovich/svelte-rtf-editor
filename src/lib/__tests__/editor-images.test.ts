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
