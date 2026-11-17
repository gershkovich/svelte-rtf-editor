import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	toRtfSafeDataUrl,
	fileToImageSrc,
	urlToImageSrc,
	dataUrlByteLength,
	sniffImageType,
	ImageTooLargeError,
	DEFAULT_MAX_IMAGE_BYTES
} from '../images.js';

/**
 * maxImageBytes is a ceiling (issue #21, item 30). RTF carries a picture as two characters per
 * byte, and the whole report has to fit one HL7 field, so the number a deployment sets must be
 * the most a picture can weigh: a picture that will not fit is shrunk until it does, or refused,
 * and is never put in the document over the limit with nothing said.
 *
 * The test DOM has no canvas, so one is stood in here: it records what is drawn and gives each
 * encoding a size from the picture's area, which is how real encodings behave. The real thing was
 * measured in Chromium (the README has the numbers).
 */

const KB = 1024;

// ── A stand-in canvas ─────────────────────────────────────────────────────────

/** What a picture costs to encode, in bytes per pixel. */
interface Cost {
	png: number;
	/** At quality 1; lower qualities cost in proportion. */
	jpeg: number;
}

interface Source {
	width: number;
	height: number;
	transparent: boolean;
	cost: Cost;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

/** A data URL of exactly this many bytes that starts with a format's signature. */
function dataUrlOf(mime: string, magic: number[], bytes: number): string {
	const body = new Uint8Array(Math.max(bytes, magic.length));
	body.set(magic);
	return `data:${mime};base64,${Buffer.from(body).toString('base64')}`;
}

const sources = new Map<string, Source>();
/** Every encoding the code asked for, in order. */
let encodes: { type: string; quality?: number; width: number; height: number; onWhite: boolean }[] = [];
let canvasBreaks = false;

function picture(mime: string, magic: number[], bytes: number, source: Source): string {
	// Two pictures of the same size and format would be the same string; the size sets them apart.
	const url = dataUrlOf(mime, magic, bytes + sources.size);
	sources.set(url, source);
	return url;
}

function installCanvas(): void {
	class FakeImage {
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		naturalWidth = 0;
		naturalHeight = 0;
		width = 0;
		height = 0;
		source: Source | null = null;
		set src(value: string) {
			const source = sources.get(value) ?? null;
			this.source = source;
			queueMicrotask(() => {
				if (!source) return this.onerror?.();
				this.naturalWidth = this.width = source.width;
				this.naturalHeight = this.height = source.height;
				this.onload?.();
			});
		}
	}
	vi.stubGlobal('Image', FakeImage);

	const realCreate = document.createElement.bind(document);
	vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
		if (tag !== 'canvas') return realCreate(tag);
		let drawn: Source | null = null;
		let onWhite = false;
		const canvas = {
			width: 0,
			height: 0,
			getContext: () => ({
				fillStyle: '',
				clearRect: () => {
					onWhite = false;
				},
				fillRect() {
					onWhite = /^#fff(fff)?$|^white$/i.test(this.fillStyle);
				},
				drawImage: (img: FakeImage) => {
					drawn = img.source;
				},
				getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, drawn?.transparent && !onWhite ? 0 : 255]) })
			}),
			toDataURL: (type = 'image/png', quality = 1) => {
				if (canvasBreaks) throw new Error('The canvas has been tainted');
				const area = canvas.width * canvas.height;
				encodes.push({ type, quality: type === 'image/jpeg' ? quality : undefined, width: canvas.width, height: canvas.height, onWhite });
				const cost = drawn!.cost;
				return type === 'image/jpeg'
					? dataUrlOf('image/jpeg', JPEG_MAGIC, Math.round(area * cost.jpeg * quality))
					: dataUrlOf('image/png', PNG_MAGIC, Math.round(area * cost.png));
			}
		};
		return canvas as unknown as HTMLElement;
	}) as typeof document.createElement);
}

beforeEach(() => {
	sources.clear();
	encodes = [];
	canvasBreaks = false;
	installCanvas();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// ── Pictures ──────────────────────────────────────────────────────────────────

/** A photograph: heavy as PNG, about a third of a byte per pixel as JPEG. */
const PHOTO: Cost = { png: 2.6, jpeg: 0.35 };
/** A screenshot: light as PNG. */
const SCREENSHOT: Cost = { png: 0.12, jpeg: 0.25 };

const photoJpeg = (width = 4000, height = 3000) =>
	picture('image/jpeg', JPEG_MAGIC, 6800 * KB, { width, height, transparent: false, cost: PHOTO });
const photoPng = (transparent: boolean, width = 2400, height = 1600) =>
	picture('image/png', PNG_MAGIC, 9300 * KB, { width, height, transparent, cost: PHOTO });
const screenshot = (width = 2400, height = 1600, transparent = false) =>
	picture('image/png', PNG_MAGIC, 900 * KB, { width, height, transparent, cost: SCREENSHOT });

const sizeOf = (url: string) => dataUrlByteLength(url);
const last = () => encodes[encodes.length - 1];

describe('a picture over the byte limit is shrunk until it fits', () => {
	it('a large photograph under a small limit: smaller than half size, which is where it used to stop', async () => {
		// At 20 KB the steps ran out at 800 px and the picture went in at 36 KB.
		const out = await toRtfSafeDataUrl(photoJpeg(), { maxBytes: 20 * KB });
		expect(sizeOf(out)).toBeLessThanOrEqual(20 * KB);
		expect(sniffImageType(out)).toBe('image/jpeg');
		expect(last().width).toBeLessThan(800);
		expect(last().width / last().height).toBeCloseTo(4 / 3, 1);
	});

	it('whatever the limit and the picture, the result is never over the limit', async () => {
		const limits = [1 * KB, 2 * KB, 5 * KB, 20 * KB, 50 * KB, 100 * KB, 300 * KB, DEFAULT_MAX_IMAGE_BYTES, 2000 * KB];
		const pictures = [
			() => photoJpeg(),
			() => photoJpeg(600, 9000),
			() => photoPng(true),
			() => photoPng(false),
			() => screenshot(),
			() => screenshot(5000, 300, true)
		];
		for (const maxBytes of limits) {
			for (const make of pictures) {
				const out = await toRtfSafeDataUrl(make(), { maxBytes });
				expect(sizeOf(out), `limit ${maxBytes}`).toBeLessThanOrEqual(maxBytes);
				expect(sniffImageType(out)).not.toBeNull();
			}
		}
	});

	it('it is not shrunk further than the limit asks: most of the budget is used', async () => {
		for (const maxBytes of [20 * KB, 60 * KB, 150 * KB]) {
			const out = await toRtfSafeDataUrl(photoJpeg(), { maxBytes });
			expect(sizeOf(out)).toBeGreaterThan(maxBytes * 0.5);
		}
	});

	it('a picture far over the limit gets there in a few steps, not one small step at a time', async () => {
		await toRtfSafeDataUrl(photoJpeg(), { maxBytes: 5 * KB });
		const sizes = new Set(encodes.map((e) => `${e.width}x${e.height}`));
		expect(sizes.size).toBeLessThanOrEqual(7);
	});

	it('the first steps are the ones it always took: full size, 80%, 64%, 50%', async () => {
		await toRtfSafeDataUrl(photoJpeg(), { maxBytes: 20 * KB });
		const widths = Array.from(new Set(encodes.map((e) => e.width))).slice(0, 4);
		expect(widths).toEqual([1600, 1280, 1024, 800]);
	});
});

describe('a picture with transparency', () => {
	it('keeps it as a PNG when a PNG fits at half size or more, as before', async () => {
		const out = await toRtfSafeDataUrl(screenshot(2400, 1600, true), { maxBytes: 150 * KB });
		expect(sniffImageType(out)).toBe('image/png');
		expect(encodes.every((e) => e.type === 'image/png' && !e.onWhite)).toBe(true);
		expect(sizeOf(out)).toBeLessThanOrEqual(150 * KB);
	});

	it('is laid on white and written as a JPEG at full size when no PNG that large fits', async () => {
		// It went in as a 1022 KB PNG, twice the default limit, because JPEG was never tried.
		const out = await toRtfSafeDataUrl(photoPng(true), { maxBytes: DEFAULT_MAX_IMAGE_BYTES });
		expect(sizeOf(out)).toBeLessThanOrEqual(DEFAULT_MAX_IMAGE_BYTES);
		expect(sniffImageType(out)).toBe('image/jpeg');
		expect(last()).toMatchObject({ type: 'image/jpeg', width: 1600, height: 1067, onWhite: true });
	});

	it('is never written as a JPEG without the white under it, which a canvas would make black', async () => {
		await toRtfSafeDataUrl(photoPng(true), { maxBytes: 30 * KB });
		expect(encodes.filter((e) => e.type === 'image/jpeg').every((e) => e.onWhite)).toBe(true);
	});
});

describe('pictures that already fit are left as they were', () => {
	it('a PNG or JPEG within both limits is returned byte for byte, with nothing redrawn', async () => {
		const small = picture('image/jpeg', JPEG_MAGIC, 80 * KB, { width: 1200, height: 800, transparent: false, cost: PHOTO });
		expect(await toRtfSafeDataUrl(small, { maxBytes: 100 * KB })).toBe(small);
		expect(encodes).toEqual([]);
	});

	it('a screenshot stays a PNG when the PNG fits', async () => {
		const out = await toRtfSafeDataUrl(screenshot(), { maxBytes: DEFAULT_MAX_IMAGE_BYTES });
		expect(sniffImageType(out)).toBe('image/png');
		expect(last()).toMatchObject({ width: 1600, height: 1067 });
	});

	it('an opaque PNG too heavy as PNG becomes a JPEG of the same size before it is made smaller', async () => {
		const out = await toRtfSafeDataUrl(photoPng(false), { maxBytes: DEFAULT_MAX_IMAGE_BYTES });
		expect(last()).toMatchObject({ type: 'image/jpeg', width: 1600, height: 1067 });
		expect(sizeOf(out)).toBeLessThanOrEqual(DEFAULT_MAX_IMAGE_BYTES);
	});

	it('a limit of 0 is no limit: the picture is only brought within the edge limit', async () => {
		const out = await toRtfSafeDataUrl(photoJpeg(), { maxBytes: 0 });
		expect(last()).toMatchObject({ width: 1600, height: 1200 });
		expect(sizeOf(out)).toBeGreaterThan(DEFAULT_MAX_IMAGE_BYTES);
	});
});

describe('a picture that cannot be brought under the limit is refused', () => {
	it('when nothing legible would be left of it', async () => {
		const attempt = toRtfSafeDataUrl(photoJpeg(), { maxBytes: 40 });
		await expect(attempt).rejects.toBeInstanceOf(ImageTooLargeError);
		await expect(toRtfSafeDataUrl(photoJpeg(), { maxBytes: 40 })).rejects.toThrow(
			'This picture could not be made small enough for the 40 bytes size limit'
		);
		// It was tried down to a few pixels, and no further.
		expect(Math.max(last().width, last().height)).toBeGreaterThanOrEqual(16);
	});

	it('the message names the limit the way a person reads it', async () => {
		canvasBreaks = true;
		await expect(toRtfSafeDataUrl(photoJpeg(), { maxBytes: 300 })).rejects.toThrow('the 300 bytes size limit');
		await expect(toRtfSafeDataUrl(photoJpeg(), { maxBytes: 20 * KB })).rejects.toThrow('the 20 KB size limit');
		await expect(toRtfSafeDataUrl(photoJpeg(), { maxBytes: 1.5 * KB * KB })).rejects.toThrow('the 1.5 MB size limit');
	});

	it('when the canvas cannot encode it: over the limit it is refused, within it it is passed through', async () => {
		canvasBreaks = true;
		await expect(toRtfSafeDataUrl(photoJpeg(), { maxBytes: 20 * KB })).rejects.toBeInstanceOf(ImageTooLargeError);
		const big = photoJpeg();
		expect(await toRtfSafeDataUrl(big, { maxBytes: 8000 * KB })).toBe(big);
	});

	it('when it cannot be decoded at all', async () => {
		const unknown = dataUrlOf('image/jpeg', JPEG_MAGIC, 900 * KB);
		await expect(toRtfSafeDataUrl(unknown, { maxBytes: 100 * KB })).rejects.toBeInstanceOf(ImageTooLargeError);
		expect(await toRtfSafeDataUrl(unknown, { maxBytes: 1000 * KB })).toBe(unknown);
	});

	it('where there is no canvas at all (a server, a test DOM)', async () => {
		vi.restoreAllMocks();
		const big = dataUrlOf('image/png', PNG_MAGIC, 900 * KB);
		await expect(toRtfSafeDataUrl(big, { maxBytes: 100 * KB })).rejects.toBeInstanceOf(ImageTooLargeError);
		expect(await toRtfSafeDataUrl(big, { maxBytes: 1000 * KB })).toBe(big);
		expect(await toRtfSafeDataUrl(big, { maxBytes: 0 })).toBe(big);
	});

	it('a file that cannot fit is not read into a picture', async () => {
		const url = photoJpeg();
		const file = new File([Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')], 'slide.jpg', { type: 'image/jpeg' });
		// FileReader gives the same bytes back as a data URL, which the stand-in knows by its text.
		sources.set(`data:image/jpeg;base64,${url.slice(url.indexOf(',') + 1)}`, sources.get(url)!);
		await expect(fileToImageSrc(file, { maxBytes: 40 })).rejects.toBeInstanceOf(ImageTooLargeError);
		expect(sizeOf(await fileToImageSrc(file, { maxBytes: 50 * KB }))).toBeLessThanOrEqual(50 * KB);
	});
});

describe('a picture given by address', () => {
	it('picture data that cannot fit comes back marked, so it is not put in the document', async () => {
		const url = photoJpeg();
		expect(await urlToImageSrc(url, { maxBytes: 40 })).toEqual({ src: url, embedded: false, tooLarge: true });
	});

	it('picture data that can be made to fit is embedded, under the limit', async () => {
		const result = await urlToImageSrc(photoJpeg(), { maxBytes: 20 * KB });
		expect(result.embedded).toBe(true);
		expect(result.tooLarge).toBeUndefined();
		expect(sizeOf(result.src)).toBeLessThanOrEqual(20 * KB);
	});

	it('a fetched picture that cannot fit keeps its address, and so exports as the placeholder', async () => {
		const url = photoJpeg();
		const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
		vi.stubGlobal('fetch', async () => ({ ok: true, headers: { get: () => null }, blob: async () => new Blob([bytes], { type: 'image/jpeg' }) }));
		expect(await urlToImageSrc('https://x.test/slide.jpg', { maxBytes: 40 })).toEqual({ src: 'https://x.test/slide.jpg', embedded: false });
	});

	it('a GIF given as data, under the limit, that cannot be converted is still reported as not embedded', async () => {
		canvasBreaks = true;
		const gif = picture('image/gif', GIF_MAGIC, 2 * KB, { width: 10, height: 10, transparent: false, cost: SCREENSHOT });
		expect(await urlToImageSrc(gif, { maxBytes: 100 * KB })).toEqual({ src: gif, embedded: false });
	});
});
