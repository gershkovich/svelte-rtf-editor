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
 * - elements that run code, load something of their own or take input (<script>, <iframe>,
 *   <object>, <svg>, <input>, <button>, …), with everything in them;
 * - every attribute not listed below, which is how event handlers (onclick, onerror) go;
 * - a link address that is not a web, mail or phone address (javascript:, data:, file:), and a
 *   picture address that is not a web address or picture data;
 * - every style property not listed below (position, z-index, …), and any value with a url().
 */

import { linkTarget } from './rtf-writer.js';
import { isSafeImageUrl } from './images.js';

/** Elements taken out with everything in them. */
const REMOVED_TAGS = new Set([
	'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
	'svg', 'math', 'link', 'meta', 'base', 'title', 'head', 'audio', 'video', 'source', 'track', 'canvas',
	'input', 'button', 'select', 'option', 'optgroup', 'datalist', 'textarea', 'dialog', 'map', 'area', 'portal', 'slot'
]);

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

function sanitizeStyle(el: HTMLElement): void {
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
		if (!STYLE_PROPERTY.test(name) || UNSAFE_STYLE_VALUE.test(style.getPropertyValue(name))) drop.push(name);
	}
	// Nothing to take out: the attribute stays as it was written. (What the browser did not
	// read as a property, such as Word's mso-hide, does nothing on the page.)
	if (drop.length === 0) return;
	for (const name of drop) style.removeProperty(name);
	// What Word hid stays hidden, in a way the browser keeps: the attribute is written again
	// from the properties the browser read, and mso-hide is not one of them.
	if (wordHidden) style.setProperty('display', 'none');
	const kept = style.cssText;
	if (kept) el.setAttribute('style', kept);
	else el.removeAttribute('style');
}

function sanitizeAttributes(el: HTMLElement, tag: string): void {
	const own = TAG_ATTRIBUTES[tag];
	for (const attr of Array.from(el.attributes)) {
		const name = attr.name.toLowerCase();
		if (name === 'class') {
			if (el.classList.contains(KEPT_CLASS)) el.setAttribute('class', KEPT_CLASS);
			else el.removeAttribute(attr.name);
			continue;
		}
		if (name === 'id') {
			// An id is kept unless it is the name of something the page's scripts look up on
			// `document` or `window`: an element with id="cookie" or id="location" would answer
			// to that name in its place.
			if (attr.value in document || attr.value in globalThis) el.removeAttribute(attr.name);
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
	sanitizeStyle(el);
}

/**
 * Make the elements under `root` safe, in place. With `only`, just the elements it accepts (the
 * ones a paste brought in) are looked at; the rest of the document is left as it is.
 * Returns whether anything was taken out or changed.
 */
export function sanitizeTree(root: Element, only?: (el: Element) => boolean): boolean {
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
		// A custom element would be given its behaviour by the page: only what it holds is kept.
		if (tag.includes('-')) {
			el.replaceWith(...Array.from(el.childNodes));
			changed = true;
			continue;
		}
		const before = el.attributes.length + (el.getAttribute('style') ?? '') + (el.getAttribute('href') ?? '');
		sanitizeAttributes(el, tag);
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
	if (!html) return '';
	if (typeof DOMParser === 'undefined') return '';
	const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
	sanitizeTree(doc.body);
	return doc.body.innerHTML;
}
