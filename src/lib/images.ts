/**
 * Image helpers for the editor.
 *
 * Images are stored inline as base64 data URLs so a document is self-contained:
 * it can be auto-saved, exported to RTF (as a \pict group) and re-imported
 * without depending on a server. RTF only carries PNG and JPEG bitmaps, so
 * other formats (GIF, WebP, SVG, …) are re-encoded to PNG on insert.
 */

/** Image types that can be written into RTF as-is. */
const RTF_NATIVE_TYPES = ['image/png', 'image/jpeg'];

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
 * Re-encode a data URL to PNG when its format cannot be embedded in RTF.
 * Animated images keep their first frame. Falls back to the original data URL
 * if the browser refuses to rasterise it.
 */
export async function toRtfSafeDataUrl(dataUrl: string, mimeType: string): Promise<string> {
	if (RTF_NATIVE_TYPES.includes(mimeType.toLowerCase())) return dataUrl;

	try {
		const img = await loadImage(dataUrl);
		const width = img.naturalWidth || img.width;
		const height = img.naturalHeight || img.height;
		if (!width || !height) return dataUrl;

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return dataUrl;
		ctx.drawImage(img, 0, 0, width, height);
		return canvas.toDataURL('image/png');
	} catch {
		return dataUrl;
	}
}

/** Read an image File into a data URL the RTF writer can embed. */
export async function fileToImageSrc(file: File): Promise<string> {
	const dataUrl = await readFileAsDataUrl(file);
	if (!dataUrl.startsWith('data:image/')) {
		throw new Error(`${file.name || 'File'} is not an image`);
	}
	return toRtfSafeDataUrl(dataUrl, file.type || '');
}

/**
 * Resolve a URL to an embeddable data URL. Remote images are fetched so they
 * survive export; when the fetch is blocked (CORS, offline) the original URL is
 * kept and the image still displays — it just exports as a text placeholder.
 */
export async function urlToImageSrc(url: string): Promise<string> {
	const value = url.trim();
	if (value.startsWith('data:image/')) {
		const mime = value.slice(5, value.indexOf(';'));
		return toRtfSafeDataUrl(value, mime);
	}

	try {
		const response = await fetch(value, { mode: 'cors' });
		if (!response.ok) return value;
		const blob = await response.blob();
		if (!blob.type.startsWith('image/')) return value;
		const dataUrl = await readFileAsDataUrl(blob);
		return toRtfSafeDataUrl(dataUrl, blob.type);
	} catch {
		return value;
	}
}

/** "sunset-over-lake.png" → "sunset-over-lake" — a usable default alt text. */
export function stripExtension(filename: string): string {
	return filename.replace(/\.[^.]+$/, '');
}
