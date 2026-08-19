import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ImageOverlay from '../components/ImageOverlay.svelte';

/**
 * Exercises the selection frame: drag-to-resize, width presets and placement.
 * Layout does not run in happy-dom, so the geometry both the frame and the
 * resize maths depend on is stubbed per element.
 */

const EDITOR_WIDTH = 600;

let host: HTMLDivElement;
let figure: HTMLElement;
let img: HTMLImageElement;
let overlay: { reposition: () => void };
let onchange: Mock<() => void>;
let onremove: Mock<() => void>;

/** Pin an element's box so getBoundingClientRect returns something meaningful. */
function stubRect(el: Element, left: number, top: number, width: number, height: number): void {
	el.getBoundingClientRect = () =>
		({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
}

function pointer(type: string, clientX: number): PointerEvent {
	return new PointerEvent(type, { clientX, clientY: 100, bubbles: true, pointerId: 1 });
}

function handle(corner: string): HTMLElement {
	const el = host.querySelector(`.ink-img-handle.${corner}`);
	if (!el) throw new Error(`no ${corner} handle rendered`);
	return el as HTMLElement;
}

function tool(title: string): HTMLElement {
	const el = host.querySelector(`.ink-img-tools button[title="${title}"]`);
	if (!el) throw new Error(`no "${title}" button rendered`);
	return el as HTMLElement;
}

/** Drag a corner handle horizontally by `dx` px. */
function dragHandle(corner: string, dx: number): void {
	const h = handle(corner);
	h.dispatchEvent(pointer('pointerdown', 400));
	flushSync();
	h.dispatchEvent(pointer('pointermove', 400 + dx));
	flushSync();
	h.dispatchEvent(pointer('pointerup', 400 + dx));
	flushSync();
}

beforeEach(() => {
	host = document.createElement('div');
	document.body.appendChild(host);
	stubRect(host, 0, 0, EDITOR_WIDTH, 800);

	figure = document.createElement('figure');
	img = document.createElement('img');
	img.style.width = '200px';
	figure.appendChild(img);
	document.body.appendChild(figure);
	// 200 × 100 image sitting 40px in and 60px down from the editor's top-left.
	stubRect(img, 40, 60, 200, 100);

	onchange = vi.fn(() => {});
	onremove = vi.fn(() => {});

	overlay = mount(ImageOverlay, {
		target: host,
		props: {
			target: img,
			bounds: host,
			maxWidth: () => EDITOR_WIDTH,
			onchange,
			onremove
		}
	}) as unknown as { reposition: () => void };
	flushSync();
});

afterEach(() => {
	unmount(overlay as never);
	host.remove();
	figure.remove();
});

describe('image selection frame', () => {
	it('frames the selected image', () => {
		const frame = host.querySelector('.ink-img-frame') as HTMLElement;
		expect(frame).toBeTruthy();
		const style = (frame.getAttribute('style') || '').replace(/\s+/g, '');
		expect(style).toContain('left:40px');
		expect(style).toContain('top:60px');
		expect(style).toContain('width:200px');
		expect(style).toContain('height:100px');
	});

	it('offers a handle on every corner', () => {
		for (const corner of ['nw', 'ne', 'sw', 'se']) {
			expect(host.querySelector(`.ink-img-handle.${corner}`)).toBeTruthy();
		}
	});
});

describe('drag to resize', () => {
	it('widens the image when a right-side handle is dragged out', () => {
		dragHandle('se', 120);
		expect(img.style.width).toBe('320px');
		expect(onchange).toHaveBeenCalled();
	});

	it('narrows the image when a right-side handle is dragged in', () => {
		dragHandle('se', -80);
		expect(img.style.width).toBe('120px');
	});

	it('grows the image when a left-side handle is dragged outward', () => {
		dragHandle('nw', -60);
		expect(img.style.width).toBe('260px');
	});

	it('never grows past the editor width', () => {
		dragHandle('se', 5000);
		expect(img.style.width).toBe(`${EDITOR_WIDTH}px`);
	});

	it('never shrinks below a usable size', () => {
		dragHandle('se', -5000);
		expect(parseInt(img.style.width, 10)).toBeGreaterThanOrEqual(40);
	});

	it('drops width/height attributes so the style wins', () => {
		img.setAttribute('width', '800');
		img.setAttribute('height', '400');
		dragHandle('se', 40);
		expect(img.hasAttribute('width')).toBe(false);
		expect(img.hasAttribute('height')).toBe(false);
		expect(img.style.height).toBe('auto');
	});

	it('reports the pixel size while dragging', () => {
		const h = handle('se');
		h.dispatchEvent(pointer('pointerdown', 400));
		flushSync();
		h.dispatchEvent(pointer('pointermove', 500));
		flushSync();
		// The badge reads the stubbed rect, which does not change under happy-dom.
		expect(host.querySelector('.ink-img-size')?.textContent).toContain('×');
		h.dispatchEvent(pointer('pointerup', 500));
		flushSync();
		expect(host.querySelector('.ink-img-size')).toBeNull();
	});
});

describe('width presets', () => {
	it('sets half of the editor width', () => {
		tool('Half width').click();
		flushSync();
		expect(img.style.width).toBe('300px');
		expect(onchange).toHaveBeenCalled();
	});

	it('sets a quarter and a full width', () => {
		tool('Quarter width').click();
		flushSync();
		expect(img.style.width).toBe('150px');

		tool('Full width').click();
		flushSync();
		expect(img.style.width).toBe('600px');
	});
});

describe('placement', () => {
	it('centres and right-aligns the figure', () => {
		tool('Align center').click();
		flushSync();
		expect(figure.style.textAlign).toBe('center');

		tool('Align right').click();
		flushSync();
		expect(figure.style.textAlign).toBe('right');
	});

	it('clears alignment styling when set back to left', () => {
		tool('Align center').click();
		flushSync();
		tool('Align left').click();
		flushSync();
		expect(figure.getAttribute('style')).toBeNull();
	});
});

describe('removal', () => {
	it('asks the editor to remove the image', () => {
		tool('Remove image').click();
		flushSync();
		expect(onremove).toHaveBeenCalled();
	});
});
