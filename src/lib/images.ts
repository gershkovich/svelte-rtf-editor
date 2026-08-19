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

/** Image types that can be written into RTF as-is. */
const RTF_NATIVE_TYPES = ['image/png', 'image/jpeg'];

/** Longest edge, in px, an inserted picture is scaled down to. */
export const DEFAULT_MAX_IMAGE_EDGE = 1600;

/** Quality used when re-encoding JPEG source images. */
const JPEG_QUALITY = 0.85;

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
export async function toRtfSafeDataUrl(
	dataUrl: string,
	mimeType: string,
	maxEdge = DEFAULT_MAX_IMAGE_EDGE
): Promise<string> {
	const isJpeg = mimeType.toLowerCase() === 'image/jpeg';
	const isNative = RTF_NATIVE_TYPES.includes(mimeType.toLowerCase());
	if (!canRasterize()) return dataUrl;

	try {
		const img = await loadImage(dataUrl);
		const width = img.naturalWidth || img.width;
		const height = img.naturalHeight || img.height;
		if (!width || !height) return dataUrl;

		const target = scaledSize(width, height, maxEdge);
		// Already embeddable and within the cap — leave the original bytes alone
		// rather than losing quality to a pointless re-encode.
		if (isNative && target.width === width && target.height === height) return dataUrl;

		const canvas = document.createElement('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return dataUrl;
		ctx.drawImage(img, 0, 0, target.width, target.height);

		return isJpeg
			? canvas.toDataURL('image/jpeg', JPEG_QUALITY)
			: canvas.toDataURL('image/png');
	} catch {
		return dataUrl;
	}
}

/** Read an image File into a data URL the RTF writer can embed. */
export async function fileToImageSrc(file: File, maxEdge = DEFAULT_MAX_IMAGE_EDGE): Promise<string> {
	const dataUrl = await readFileAsDataUrl(file);
	if (!dataUrl.startsWith('data:image/')) {
		throw new Error(`${file.name || 'File'} is not an image`);
	}
	return toRtfSafeDataUrl(dataUrl, file.type || '', maxEdge);
}

/**
 * Resolve a URL to an embeddable data URL. Remote images are fetched so they
 * survive export; when the fetch is blocked (CORS, offline) the original URL is
 * kept and the image still displays — it just exports as a text placeholder.
 */
export async function urlToImageSrc(url: string, maxEdge = DEFAULT_MAX_IMAGE_EDGE): Promise<string> {
	const value = url.trim();
	if (value.startsWith('data:image/')) {
		const mime = value.slice(5, value.indexOf(';'));
		return toRtfSafeDataUrl(value, mime, maxEdge);
	}

	try {
		const response = await fetch(value, { mode: 'cors' });
		if (!response.ok) return value;
		const blob = await response.blob();
		if (!blob.type.startsWith('image/')) return value;
		const dataUrl = await readFileAsDataUrl(blob);
		return toRtfSafeDataUrl(dataUrl, blob.type, maxEdge);
	} catch {
		return value;
	}
}

/** "sunset-over-lake.png" → "sunset-over-lake" — a usable default alt text. */
export function stripExtension(filename: string): string {
	return filename.replace(/\.[^.]+$/, '');
}
