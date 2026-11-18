/**
 * HTML that is safe to put in the editor.
 *
 * The editor shows HTML it is given: the `content` prop, setHTML(), a draft restored from
 * localStorage, and whatever a paste brings. Written to the page as it is, an
 * <img onerror="…"> in any of those runs as script, and a pasted block with position: fixed
 * covers the page the editor sits in. So all of it goes through here first.
 *
 * What stays is what a document is made of: text, the elements that format it, links to web,
 * mail and phone addresses, pictures, tables. What goes:
 *
 * - elements that run code or load something of their own (<script>, <iframe>, <object>,
 *   <svg>, …), with everything in them;
 * - elements that take input (<button>, <textarea>, <select>, <input>) and formulas (<math>):
 *   the element goes and the words it showed stay, as text;
 * - every attribute not listed below, which is how event handlers (onclick, onerror) go;
 * - `class`, which would take on what the page's own stylesheet gives that name, and an `id`
 *   that the page already uses for something of its own;
 * - a link address that is not a web, mail or phone address (javascript:, data:, file:), and a
 *   picture address that is not a web address or picture data;
 * - every style property not listed below (position, z-index, …), any value with a url(), and
 *   any size that would put the element outside the page it is on (a margin below zero, a
 *   padding of thousands of pixels).
 */

import { linkTarget } from './rtf-writer.js';
import { isSafeImageUrl } from './images.js';

/** Elements taken out with everything in them. */
const REMOVED_TAGS = new Set([
	'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
	'svg', 'link', 'meta', 'base', 'title', 'head', 'audio', 'video', 'source', 'track', 'canvas',
	'option', 'optgroup', 'datalist', 'dialog', 'map', 'area', 'portal', 'slot'
]);

/**
 * Elements taken out that leave the words they showed: a button's label, what a text box or a
 * list held, a formula. Taken out whole, "Ki-67 30%" with its figure in a formula became
 * "Ki-67", and nothing said so.
 */
const TEXT_KEPT_TAGS = new Set(['button', 'textarea', 'select', 'input', 'math']);

/** The kinds of <input> that show what they hold as text. */
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'email', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

/** The parts of a formula that are read left to right, as they are written. */
const LINEAR_MATH = new Set(['mrow', 'mn', 'mo', 'mi', 'mtext', 'ms', 'mspace', 'mstyle', 'mpadded', 'semantics', 'annotation', 'annotation-xml']);

/** What stands in for a formula that cannot be written as a line of text (a fraction, a root). */
const FORMULA_MARK = '[formula]';

/**
 * The words one of the TEXT_KEPT_TAGS elements showed. A formula of numbers and signs in a row
 * is those characters. One with a fraction, a power or a root is not: its parts read in a row
 * say something else ("1/2" would read "12"), so it is marked as a formula left out.
 */
function shownText(el: Element, tag: string): string {
	const tidy = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
	if (tag === 'button') return tidy(el.textContent);
	if (tag === 'textarea') return ((el as HTMLTextAreaElement).value ?? el.textContent ?? '').trim();
	if (tag === 'input') {
		const type = (el.getAttribute('type') ?? '').toLowerCase();
		return TEXT_INPUT_TYPES.has(type) ? tidy((el as HTMLInputElement).value ?? el.getAttribute('value')) : '';
	}
	if (tag === 'select') {
		const options = Array.from(el.querySelectorAll('option'));
		const chosen = options.find((option) => option.hasAttribute('selected')) ?? (el.hasAttribute('multiple') ? undefined : options[0]);
		return tidy(chosen?.textContent);
	}
	// A formula.
	let text = '';
	for (const part of Array.from(el.querySelectorAll('*'))) {
		const name = part.tagName.toLowerCase();
		if (!LINEAR_MATH.has(name)) return FORMULA_MARK;
		if (part.children.length === 0 && !name.startsWith('annotation') && !part.closest('annotation, annotation-xml')) text += part.textContent ?? '';
	}
	return tidy(text || (el.children.length === 0 ? el.textContent : ''));
}

/** Attributes any element may keep. */
const GLOBAL_ATTRIBUTES = new Set(['style', 'dir', 'lang', 'title', 'hidden', 'align', 'data-rtf-tab-stops']);

/** Attributes only some elements may keep. */
const TAG_ATTRIBUTES: Record<string, string[]> = {
	a: ['href', 'target', 'rel'],
	img: ['src', 'alt', 'width', 'height'],
	td: ['colspan', 'rowspan', 'width'],
	th: ['colspan', 'rowspan', 'width'],
	table: ['width'],
	col: ['span', 'width'],
	colgroup: ['span', 'width'],
	ol: ['start', 'type'],
	li: ['value'],
	font: ['color', 'size', 'face']
};

/**
 * The one class that means something here: Safari's wrapper around a typed tab. Any other class
 * would take on whatever the page's own stylesheet gives that name.
 */
const KEPT_CLASS = 'Apple-tab-span';

/** Style properties that format text, a paragraph, a picture or a table. */
const STYLE_PROPERTY =
	/^(color|background-color|font-(size|weight|style|family)|text-(align|indent)|text-decoration(-.*)?|vertical-align|white-space(-.*)?|text-wrap(-.*)?|(margin|padding)(-(top|right|bottom|left))?|border(-.*)?|width|height|display|visibility|break-after|page-break-after|(-moz-)?tab-size|line-height|list-style-type)$/;

/** A style value that loads something or runs something. */
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i;

/** Word's hidden text, as a paste from Word carries it: a property no browser keeps. */
const WORD_HIDDEN = /mso-hide\s*:\s*all/i;

// ── Sizes ──
// `position` is not the only way to draw over the page an editor sits in. A margin below zero
// pulls a block up over the toolbar, a padding of thousands of pixels makes a link the size of
// the page, a width of thousands a block that runs out over what is beside the editor. So the
// properties that give an element its place and size are kept only within what a document
// uses: nothing below zero where it would move the element, nothing larger than a page.

/** Lengths in px, for the limits below (an em taken as 16 px). */
const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, em: 16, rem: 16, ex: 8, ch: 8 };

/** A little over the widest page there is, 22 inches (2112 px). */
const MOST_PX = 2200;

/** The elements that have a width or a height of their own in a document. */
const SIZED_TAGS = new Set(['img', 'table', 'td', 'th', 'col', 'colgroup', 'hr']);

/** The ways of laying an element out that a document uses. */
const DISPLAY_VALUES = new Set([
	'none', 'inline', 'block', 'inline-block', 'list-item', 'table', 'table-row', 'table-cell', 'table-row-group',
	'table-header-group', 'table-footer-group', 'table-column', 'table-column-group', 'table-caption'
]);

/**
 * Whether every number in a value is a length within `most` px (a percentage within
 * `mostPercent`, a bare number within `mostNumber`), and none below zero unless `negative`.
 * A value worked out by the browser (calc(), var(), min()) cannot be checked, and is not within.
 */
function within(value: string, limits: { most: number; negative?: boolean; mostPercent?: number; mostNumber?: number }): boolean {
	if (/[()]/.test(value)) return false;
	for (const [, digits, unit] of value.toLowerCase().matchAll(/(-?\d*\.?\d+(?:e[+-]?\d+)?)([a-z%]*)/g)) {
		const number = Number(digits);
		if (!Number.isFinite(number)) return false;
		if (number < 0 && !limits.negative) return false;
		const size = Math.abs(number);
		if (unit === '%') {
			if (size > (limits.mostPercent ?? 100)) return false;
		} else if (unit === '') {
			if (size > (limits.mostNumber ?? 0)) return false;
		} else if (!(unit in PX_PER_UNIT) || size * PX_PER_UNIT[unit] > limits.most) {
			// (Also a unit that is a share of the window, vw or vh: not a size a document has.)
			return false;
		}
	}
	return true;
}

/** Whether a property that places or sizes an element has a value a document would give it. */
function sizeAllowed(name: string, value: string, tag: string): boolean {
	if (name.startsWith('margin') || name.startsWith('padding')) return within(value, { most: MOST_PX });
	if (name === 'text-indent') return within(value, { most: MOST_PX, negative: true });
	if (name === 'width' || name === 'height') return SIZED_TAGS.has(tag) && within(value, { most: MOST_PX });
	if (name === 'display') return DISPLAY_VALUES.has(value.trim().toLowerCase());
	if (name === 'line-height') return within(value, { most: 400, mostPercent: 1000, mostNumber: 10 });
	if (name === 'font-size') return within(value, { most: MOST_PX, mostPercent: 10000 });
	if (/^border.*width$/.test(name) || name === 'border-spacing') return within(value, { most: 100 });
	if (name.endsWith('tab-size')) return within(value, { most: MOST_PX, mostNumber: 100 });
	return true;
}

function sanitizeStyle(el: HTMLElement, tag: string): void {
	const raw = el.getAttribute('style');
	if (raw === null) return;
	const style = el.style;
	if (!style) {
		el.removeAttribute('style');
		return;
	}
	const wordHidden = WORD_HIDDEN.test(raw);
	const drop: string[] = [];
	for (let i = 0; i < style.length; i++) {
		const name = style.item(i);
		const value = style.getPropertyValue(name);
		if (!STYLE_PROPERTY.test(name) || UNSAFE_STYLE_VALUE.test(value) || !sizeAllowed(name, value, tag)) drop.push(name);
	}
	// The attribute stays as it was written only if all of it is something read and kept. What
	// this browser did not read as a property does nothing on this page, but it is still in the
	// attribute for whatever shows the HTML next: "width: expression(…)" went through that way.
	// So where the attribute names a property that is not kept, or a value that loads or runs
	// something, it is written again from the properties that were read and kept.
	const names = raw
		.split(';')
		.map((part) => (part.includes(':') ? part.slice(0, part.indexOf(':')) : part).trim().toLowerCase())
		.filter((name) => name !== '');
	const read = Array.from({ length: style.length }, (_, i) => style.item(i));
	// (A property named twice is read once, and which one cannot be told from here.)
	const unread =
		UNSAFE_STYLE_VALUE.test(raw) ||
		new Set(names).size !== names.length ||
		names.some((name) => !STYLE_PROPERTY.test(name) || !read.some((property) => property === name || property.startsWith(`${name}-`)));
	if (drop.length === 0 && !unread) return;
	for (const name of drop) style.removeProperty(name);
	// What Word hid stays hidden, in a way the browser keeps: mso-hide is not a property it
	// reads, so the text showed on screen while the RTF left it out.
	if (wordHidden) style.setProperty('display', 'none');
	const kept = style.cssText;
	if (kept) el.setAttribute('style', kept);
	else el.removeAttribute('style');
}

function sanitizeAttributes(el: HTMLElement, tag: string, idTaken?: (id: string) => boolean): void {
	const own = TAG_ATTRIBUTES[tag];
	for (const attr of Array.from(el.attributes)) {
		const name = attr.name.toLowerCase();
		if (name === 'class') {
			if (el.classList.contains(KEPT_CLASS)) el.setAttribute('class', KEPT_CLASS);
			else el.removeAttribute(attr.name);
			continue;
		}
		if (name === 'id') {
			// A document's own ids are kept: an application marks its paragraphs with them. Not
			// one that names something the page's scripts look up on `document` or `window`
			// (id="cookie", id="location"), and not one the page already has an element for
			// (`idTaken`): the newcomer would answer to getElementById in its place, and take on
			// what the page's stylesheet gives "#sidebar".
			if (attr.value in document || attr.value in globalThis || idTaken?.(attr.value)) el.removeAttribute(attr.name);
			continue;
		}
		if (!GLOBAL_ATTRIBUTES.has(name) && !own?.includes(name)) el.removeAttribute(attr.name);
	}
	if (tag === 'a' && el.hasAttribute('href')) {
		const target = linkTarget(el.getAttribute('href') || '');
		if (target === null) {
			el.removeAttribute('href');
			el.removeAttribute('target');
		} else if (el.getAttribute('target')) {
			// A link that opens a new tab does not hand that tab this page.
			el.setAttribute('rel', 'noopener noreferrer');
		}
	}
	if (tag === 'img' && el.hasAttribute('src') && !isSafeImageUrl(el.getAttribute('src') || '')) {
		el.removeAttribute('src');
	}
	sanitizeStyle(el, tag);
}

/**
 * Make the elements under `root` safe, in place. With `only`, just the elements it accepts (the
 * ones a paste brought in) are looked at; the rest of the document is left as it is. With
 * `idTaken`, an id it says the page already uses is taken off.
 * Returns whether anything was taken out or changed.
 */
export function sanitizeTree(root: Element, only?: (el: Element) => boolean, idTaken?: (id: string) => boolean): boolean {
	let changed = false;
	for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
		// Gone already, with something it was in.
		if (!root.contains(el)) continue;
		if (only && !only(el)) continue;
		const tag = el.tagName.toLowerCase();
		if (REMOVED_TAGS.has(tag)) {
			el.remove();
			changed = true;
			continue;
		}
		if (TEXT_KEPT_TAGS.has(tag)) {
			const text = shownText(el, tag);
			if (text) el.replaceWith(el.ownerDocument.createTextNode(text));
			else el.remove();
			changed = true;
			continue;
		}
		// A custom element would be given its behaviour by the page: only what it holds is kept.
		if (tag.includes('-')) {
			el.replaceWith(...Array.from(el.childNodes));
			changed = true;
			continue;
		}
		const before = el.attributes.length + (el.getAttribute('style') ?? '') + (el.getAttribute('href') ?? '');
		sanitizeAttributes(el, tag, idTaken);
		if (before !== el.attributes.length + (el.getAttribute('style') ?? '') + (el.getAttribute('href') ?? '')) changed = true;
	}
	return changed;
}

/**
 * HTML made safe to show and edit: see the top of this file for what is kept. It is parsed in a
 * document of its own, where nothing in it runs or loads, before any of it reaches the page.
 * Where there is no DOM to parse it with (on a server), nothing is returned: HTML that could
 * not be checked is not passed on.
 */
export function sanitizeHtml(html: string): string {
	return safeBody(html)?.innerHTML ?? '';
}

/** The HTML, read in a document of its own and made safe there; null where it cannot be. */
function safeBody(html: string, idTaken?: (id: string) => boolean): HTMLElement | null {
	if (!html || typeof DOMParser === 'undefined') return null;
	const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
	sanitizeTree(doc.body, undefined, idTaken);
	return doc.body;
}

/**
 * The same, as nodes for `into` to hold. The editor puts these in the page as they are: what was
 * checked is what is shown. Written out as text and read in again, a second reading has to
 * agree with the first for the check to mean anything, and that is where a sanitizer is got
 * round; it is also a third pass over a document that may hold megabytes of pictures.
 */
export function sanitizedNodes(html: string, into: Document, idTaken?: (id: string) => boolean): Node[] {
	const body = safeBody(html, idTaken);
	if (!body) return [];
	return Array.from(body.childNodes).map((node) => into.importNode(node, true));
}
