/**
 * Image helpers for the editor.
 *
 * Images are stored inline as base64 data URLs so a document is self-contained:
 * it can be auto-saved, exported to RTF (as a \pict group) and re-imported
 * without depending on a server. RTF only carries PNG and JPEG bitmaps, so
 * other formats (GIF, WebP, SVG, …) are re-encoded to PNG on insert.
 *
 * Pictures are also scaled down to a maximum edge length on insert. RTF stores
 * picture data as hexadecimal — two characters per byte — so an embedded image
 * costs twice its file size in the document, which matters when that document
 * has to fit through a transport with a size limit (an HL7 OBX-5 field, say).
 * Resizing an image in the editor only changes its display size; this cap is
 * what actually bounds the payload.
 */

/** Longest edge, in px, an inserted picture is scaled down to. */
export const DEFAULT_MAX_IMAGE_EDGE = 1600;

/**
 * Encoded bytes an inserted picture is kept under. Each byte becomes two hex
 * characters in the RTF, so this default costs about 1 MB of document per image.
 */
export const DEFAULT_MAX_IMAGE_BYTES = 512 * 1024;

/**
 * Width, in px, a newly inserted picture is displayed at unless the editor
 * column is narrower. 624px × 15 twips = 9360 twips = 6.5in, the text width of
 * a Letter page with 1in margins — so pictures arrive sized to the page they
 * will be printed or filed on rather than to the width of the browser window.
 */
export const DEFAULT_MAX_IMAGE_DISPLAY_WIDTH = 624;

/**
 * Width a picture is first shown at: the smallest of its own size, the editor's
 * column, and the page cap. Limits that are absent or zero are ignored, and an
 * image is never enlarged beyond its natural size.
 */
export function initialDisplayWidth(
	naturalWidth: number,
	columnWidth: number,
	maxDisplayWidth: number
): number {
	const limits = [naturalWidth, columnWidth, maxDisplayWidth].filter((value) => value > 0);
	return limits.length > 0 ? Math.round(Math.min(...limits)) : 0;
}

/** Successive reductions tried when a picture will not fit the byte budget. */
const SIZE_LADDER = [1, 0.8, 0.64, 0.5];

/** JPEG qualities tried at each size, best first. */
const QUALITY_LADDER = [0.85, 0.7];

export interface ImageLimits {
	/** Longest edge in px; 0 or undefined leaves the dimensions alone. */
	maxEdge?: number;
	/** Encoded byte ceiling; 0 or undefined leaves the payload unbounded. */
	maxBytes?: number;
}

/**
 * Size an image is reduced to so neither edge exceeds `maxEdge`, keeping the
 * aspect ratio. Images already within the cap are left alone — never upscaled.
 */
export function scaledSize(width: number, height: number, maxEdge: number): PixelSize {
	if (!width || !height || !maxEdge || maxEdge <= 0) return { width, height };
	const longest = Math.max(width, height);
	if (longest <= maxEdge) return { width, height };
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

interface PixelSize {
	width: number;
	height: number;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode the first few bytes of a base64 payload — enough to identify a format. */
function decodePrefix(base64: string, byteCount: number): Uint8Array {
	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (let i = 0; i < base64.length && bytes.length < byteCount; i++) {
		const value = B64_ALPHABET.indexOf(base64[i]);
		if (value < 0) continue;
		buffer = (buffer << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}
	return new Uint8Array(bytes);
}

/**
 * The image format a data URL actually holds, read from its leading bytes.
 * The declared MIME type is not trustworthy: an operating system assigns
 * `File.type` from the file extension, so a WebP saved as `.png` claims to be
 * PNG, and a server can send the wrong `Content-Type`. Writing such bytes into
 * RTF as `\pngblip` produces a picture nothing can decode, so the format is
 * decided here and mislabelled images are pushed through the canvas re-encode.
 */
export function sniffImageType(dataUrl: string): 'image/png' | 'image/jpeg' | null {
	const comma = dataUrl.indexOf(',');
	if (comma < 0) return null;
	const b = decodePrefix(dataUrl.slice(comma + 1, comma + 33), 8);

	if (
		b.length >= 8 &&
		b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
		b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
	) {
		return 'image/png';
	}
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	return null;
}

/** Decoded byte length of a base64 data URL, without decoding it. */
export function dataUrlByteLength(dataUrl: string): number {
	const comma = dataUrl.indexOf(',');
	if (comma < 0) return 0;
	const body = dataUrl.slice(comma + 1);
	const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/**
 * Whether any pixel is not fully opaque. Only consulted when a PNG has to be
 * considered for JPEG re-encoding, since that would flatten transparency.
 */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
	try {
		const { data } = ctx.getImageData(0, 0, width, height);
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] < 255) return true;
		}
		return false;
	} catch {
		// Assume transparency rather than risk flattening it away.
		return true;
	}
}

/** Whether this runtime can rasterise to a canvas (it cannot under happy-dom/SSR). */
function canRasterize(): boolean {
	if (typeof document === 'undefined') return false;
	try {
		const canvas = document.createElement('canvas');
		return typeof canvas.getContext === 'function' && !!canvas.getContext('2d');
	} catch {
		return false;
	}
}

/** Refuse anything that is not plainly an image reference (e.g. javascript:). */
export function isSafeImageUrl(url: string): boolean {
	const value = url.trim();
	if (!value) return false;
	if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return true;

	try {
		const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
		const parsed = new URL(value, base);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:';
	} catch {
		return false;
	}
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(new Error('Could not read the image file'));
		reader.readAsDataURL(file);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not decode the image'));
		img.src = src;
	});
}

/**
 * Prepare a data URL for embedding: scale it down to `maxEdge` and re-encode it
 * to PNG when its format cannot be carried by RTF. JPEG sources stay JPEG so
 * photographs do not balloon; everything else becomes PNG. Animated images keep
 * their first frame. Falls back to the original data URL when the runtime
 * cannot rasterise, so nothing is lost if the conversion is unavailable.
 */
export async function toRtfSafeDataUrl(dataUrl: string, limits: ImageLimits = {}): Promise<string> {
	const { maxEdge = DEFAULT_MAX_IMAGE_EDGE, maxBytes = DEFAULT_MAX_IMAGE_BYTES } = limits;
	// The bytes decide the format, not the declared type — a mislabelled image
	// must not take the early return that hands the original bytes back.
	const actual = sniffImageType(dataUrl);
	const isJpeg = actual === 'image/jpeg';
	const isNative = actual !== null;
	if (!canRasterize()) return dataUrl;

	try {
		const img = await loadImage(dataUrl);
		const width = img.naturalWidth || img.width;
		const height = img.naturalHeight || img.height;
		if (!width || !height) return dataUrl;

		const target = scaledSize(width, height, maxEdge);
		const fits = (bytes: number) => !maxBytes || maxBytes <= 0 || bytes <= maxBytes;

		// Already embeddable, within the pixel cap and within budget — leave the
		// original bytes alone rather than losing quality to a pointless re-encode.
		if (
			isNative &&
			target.width === width &&
			target.height === height &&
			fits(dataUrlByteLength(dataUrl))
		) {
			return dataUrl;
		}

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) return dataUrl;

		let opaque: boolean | null = null;
		let smallest = '';

		// Shrink in steps until the encoded picture fits the budget. At each size a
		// PNG source is tried as PNG first — screenshots and diagrams stay sharp and
		// usually compress well — and only falls back to JPEG when PNG is too heavy
		// and the image has no transparency to lose.
		for (const scale of SIZE_LADDER) {
			const w = Math.max(1, Math.round(target.width * scale));
			const h = Math.max(1, Math.round(target.height * scale));
			canvas.width = w;
			canvas.height = h;
			ctx.clearRect(0, 0, w, h);
			ctx.drawImage(img, 0, 0, w, h);

			const candidates: string[] = [];
			if (!isJpeg) candidates.push(canvas.toDataURL('image/png'));
			if (isJpeg || !fits(dataUrlByteLength(candidates[0] ?? ''))) {
				if (opaque === null) opaque = !hasTransparency(ctx, w, h);
				if (isJpeg || opaque) {
					for (const quality of QUALITY_LADDER) {
						candidates.push(canvas.toDataURL('image/jpeg', quality));
					}
				}
			}

			for (const candidate of candidates) {
				const bytes = dataUrlByteLength(candidate);
				if (fits(bytes)) return candidate;
				if (!smallest || bytes < dataUrlByteLength(smallest)) smallest = candidate;
			}
		}

		// Nothing fit — hand back the smallest we managed rather than the original.
		return smallest || dataUrl;
	} catch {
		return dataUrl;
	}
}

/** Read an image File into a data URL the RTF writer can embed. */
export async function fileToImageSrc(file: File, limits: ImageLimits = {}): Promise<string> {
	const dataUrl = await readFileAsDataUrl(file);
	if (!dataUrl.startsWith('data:image/')) {
		throw new Error(`${file.name || 'File'} is not an image`);
	}
	return toRtfSafeDataUrl(dataUrl, limits);
}

/**
 * Resolve a URL to an embeddable data URL. Remote images are fetched so they
 * survive export; when the fetch is blocked (CORS, offline) the original URL is
 * kept and the image still displays — it just exports as a text placeholder.
 */
export async function urlToImageSrc(
	url: string,
	limits: ImageLimits = {}
): Promise<{ src: string; embedded: boolean }> {
	const value = url.trim();
	if (value.startsWith('data:image/')) {
		return { src: await toRtfSafeDataUrl(value, limits), embedded: true };
	}

	// A picture that could not be inlined still displays, but it leaves the
	// document as a text placeholder instead of picture data. The caller is told
	// so it can say as much, rather than letting the image vanish at export.
	try {
		const response = await fetch(value, { mode: 'cors' });
		if (!response.ok) return { src: value, embedded: false };
		const blob = await response.blob();
		if (!blob.type.startsWith('image/')) return { src: value, embedded: false };
		const dataUrl = await readFileAsDataUrl(blob);
		const src = await toRtfSafeDataUrl(dataUrl, limits);
		return { src, embedded: src.startsWith('data:') };
	} catch {
		return { src: value, embedded: false };
	}
}

/** "sunset-over-lake.png" → "sunset-over-lake" — a usable default alt text. */
export function stripExtension(filename: string): string {
	return filename.replace(/\.[^.]+$/, '');
}
