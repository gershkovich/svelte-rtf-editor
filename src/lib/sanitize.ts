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
 *   the element goes and the words it showed stay, as text. Words it did not show (the element
 *   or a part of it was hidden) go with it;
 * - every attribute not listed below, which is how event handlers (onclick, onerror) go;
 * - `class`, which would take on what the page's own stylesheet gives that name, an `id` that
 *   the page already uses for something of its own, and the `id` of a link;
 * - a link address that is not a web, mail or phone address (javascript:, data:, file:), and a
 *   picture address that is not a web address or picture data;
 * - every style property not listed below (position, z-index, …), any value with a url(), and
 *   any size that would put the element, or its words, outside the page it is on or out of
 *   sight (a margin below zero, a padding of thousands of pixels, a first line that starts left
 *   of its paragraph, text of no size).
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

/**
 * The kinds of <input> that do not show what they hold as words: a box to tick, a file, a color,
 * a slider, a password (dots), and the kind that is not shown at all. Every other kind does,
 * a kind no browser knows among them, which is shown as a text box.
 */
const WORDLESS_INPUT_TYPES = new Set(['checkbox', 'radio', 'file', 'image', 'color', 'range', 'hidden', 'password']);

/** The parts of a formula that are read left to right, as they are written. */
const LINEAR_MATH = new Set(['mrow', 'mn', 'mo', 'mi', 'mtext', 'ms', 'mspace', 'mstyle', 'mpadded', 'semantics', 'annotation', 'annotation-xml']);

/** What stands in for a formula that cannot be written as a line of text (a fraction, a root). */
const FORMULA_MARK = '[formula]';

/** Word's hidden text, as a paste from Word carries it: a property no browser keeps. */
const WORD_HIDDEN = /mso-hide\s*:\s*all/i;

/** A style that says of its own element that it is not shown. */
const STYLED_HIDDEN = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*(hidden|collapse))\b/i;

/**
 * Whether an element says of itself that it is not shown. (One hidden by something it is in
 * stays inside that, and stays hidden with it.)
 */
function hiddenByItself(el: Element): boolean {
	if (el.hasAttribute('hidden')) return true;
	const style = el.getAttribute('style');
	return style !== null && (STYLED_HIDDEN.test(style) || WORD_HIDDEN.test(style));
}

/**
 * The text of an element as a browser shows it: without the parts that are hidden, and without
 * what is in a <script> or <style>, which is text to the DOM and never words on the screen.
 */
function visibleText(el: Element): string {
	let text = '';
	const todo: Node[] = [el];
	while (todo.length > 0) {
		const node = todo.pop()!;
		if (node.nodeType === 3) {
			text += (node as Text).data;
			continue;
		}
		if (node.nodeType !== 1) continue;
		if (node !== el) {
			const tag = (node as Element).tagName.toLowerCase();
			if (REMOVED_TAGS.has(tag) || hiddenByItself(node as Element)) continue;
			if (tag === 'br') text += ' ';
		}
		const children = Array.from(node.childNodes);
		for (let i = children.length - 1; i >= 0; i--) todo.push(children[i]);
	}
	return text;
}

/**
 * The words one of the TEXT_KEPT_TAGS elements showed. A formula of numbers and signs in a row
 * is those characters. One with a fraction, a power or a root is not: its parts read in a row
 * say something else ("1/2" would read "12"), so it is marked as a formula left out.
 */
function shownText(el: Element, tag: string): string {
	const tidy = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
	// Hidden, it showed no words: kept, they would be on the screen and in the RTF for the
	// first time.
	if (hiddenByItself(el)) return '';
	if (tag === 'button') return tidy(visibleText(el));
	if (tag === 'textarea') return ((el as HTMLTextAreaElement).value ?? el.textContent ?? '').trim();
	if (tag === 'input') {
		const type = (el.getAttribute('type') ?? '').trim().toLowerCase();
		// (A button of this kind with no value shows a word of the browser's own, in the
		// reader's language: not a word of the document.)
		return WORDLESS_INPUT_TYPES.has(type) ? '' : tidy((el as HTMLInputElement).value ?? el.getAttribute('value'));
	}
	if (tag === 'select') {
		const options = Array.from(el.querySelectorAll('option'));
		const chosen = options.filter((option) => option.hasAttribute('selected'));
		// A list shown open (several lines, or several choices) has what was chosen in it, which
		// may be nothing or more than one. A list shown closed shows one: the first, if none is.
		const open = el.hasAttribute('multiple') || Number(el.getAttribute('size')) > 1;
		const shown = open ? chosen : [chosen[chosen.length - 1] ?? options[0]];
		return shown.map((option) => tidy(option?.textContent)).filter((words) => words !== '').join(', ');
	}
	// A formula. Text written straight into <math>, outside any of its parts, is not drawn.
	let text = '';
	for (const part of Array.from(el.querySelectorAll('*'))) {
		const name = part.tagName.toLowerCase();
		if (!LINEAR_MATH.has(name)) return FORMULA_MARK;
		if (name === 'mspace') text += ' ';
		else if (part.children.length === 0 && !name.startsWith('annotation') && !part.closest('annotation, annotation-xml')) text += part.textContent ?? '';
	}
	return tidy(text);
}

/** Attributes any element may keep. */
const GLOBAL_ATTRIBUTES = new Set(['style', 'dir', 'lang', 'title', 'hidden', 'align', 'data-rtf-tab-stops']);

/** What an application asked to have kept on its own documents. */
export interface KeepOptions {
	/** `data-` attributes that stay on any element. */
	keepAttributes?: readonly string[];
	/** Class names that stay in an element's class list. */
	keepClasses?: readonly string[];
}

/** The same, as the sets the sanitizer reads. */
export interface Kept {
	attributes: ReadonlySet<string>;
	classes: ReadonlySet<string>;
}

/**
 * What an application asked to have kept (the editor's `keepAttributes` and `keepClasses`), as
 * the sets the sanitizer reads. Only `data-` attributes can be asked for: they mark an element
 * and do nothing else, where `onclick`, `src` or `style` asked for here would undo what this
 * file is for. A class is kept by its name alone; what it looks like is the page's stylesheet,
 * which is why none is kept unless the application names it. A name that is neither is left out.
 */
export function keptMarks(options: KeepOptions | undefined): Kept {
	const attributes = new Set<string>();
	for (const name of options?.keepAttributes ?? []) {
		const lower = String(name).trim().toLowerCase();
		if (/^data-[a-z0-9_.-]+$/.test(lower)) attributes.add(lower);
	}
	const classes = new Set<string>();
	for (const name of options?.keepClasses ?? []) {
		const token = String(name).trim();
		if (/^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(token)) classes.add(token);
	}
	return { attributes, classes };
}

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
	font: ['color', 'size', 'face'],
	details: ['open']
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

// ── Sizes ──
// `position` is not the only way to draw over the page an editor sits in. A margin below zero
// pulls a block up over the toolbar, a padding of thousands of pixels makes a link the size of
// the page, a width of thousands a block that runs out over what is beside the editor. So the
// properties that give an element its place and size are kept only within what a document
// uses: nothing below zero where it would move the element, nothing larger than a page.
//
// The other half is words put out of sight: a first line pulled left of its paragraph, where
// the editing area cuts it off, or text of no size. They would be in the RTF and not on the
// screen, so those values go too.

/** Lengths in px, for the limits below. The units that follow the font are in FONT_UNITS. */
const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, rem: 16 };

/** Lengths counted in the element's font size: how many of them make one. */
const FONT_UNITS: Record<string, number> = { em: 1, ex: 2, ch: 2 };

/** The font size where nothing above sets one. */
const BASE_FONT_PX = 16;

/**
 * Text below this is not there to be read: a size of 0 shows nothing at all. (The smallest size
 * RTF can give, half a point, is above it, so a size read from RTF is never taken off.)
 */
const LEAST_FONT_PX = 0.5;

/** The font sizes that have names, in px. */
const NAMED_FONT_PX: Record<string, number> = {
	'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48,
	'-webkit-xxx-large': 48
};

/** A step up or down in size (`larger`, `smaller`): the factor a browser uses. */
const FONT_STEP = 1.2;

/**
 * How far a list may be pulled left: the half inch a list level is indented by itself. The
 * reader writes a list indented by less than that with the difference as a margin below zero
 * ("margin-left:-18pt"), and the writer reads it back; taken off, the list was written half an
 * inch further in. It is the one margin below zero that is kept.
 */
const LIST_OUTDENT_PX = 48;

/** The most padding for a piece of text inside a line, where padding moves nothing and only covers. */
const INLINE_PADDING_PX = 32;

/** Elements that are a piece of text inside a line. */
const INLINE_TAGS = new Set([
	'a', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'font', 'code', 'mark',
	'small', 'big', 'abbr', 'cite', 'q', 'label', 'kbd', 'samp', 'var', 'tt', 'bdi', 'bdo', 'time', 'dfn'
]);

/** What each part of a border picture is when there is none: what `border: …` sets them to. */
const NO_BORDER_IMAGE: Record<string, string[]> = {
	'border-image-source': ['none', 'initial'],
	'border-image-slice': ['100%', 'initial'],
	'border-image-width': ['1', 'initial'],
	'border-image-outset': ['0', '0px', 'initial'],
	'border-image-repeat': ['stretch', 'initial']
};

/** A little over the widest page there is, 22 inches (2112 px). */
const MOST_PX = 2200;

/** The elements that have a width or a height of their own in a document. */
const SIZED_TAGS = new Set(['img', 'table', 'td', 'th', 'col', 'colgroup', 'hr']);

/** The ways of laying an element out that a document uses. */
const DISPLAY_VALUES = new Set([
	'none', 'inline', 'block', 'inline-block', 'list-item', 'table', 'table-row', 'table-cell', 'table-row-group',
	'table-header-group', 'table-footer-group', 'table-column', 'table-column-group', 'table-caption'
]);

/** One number of a style value with its unit, as px; null for a percentage, a bare number or a unit not known. */
function lengthPx(digits: string, unit: string, fontPx: number): number | null {
	if (unit in PX_PER_UNIT) return Number(digits) * PX_PER_UNIT[unit];
	if (unit in FONT_UNITS) return (Number(digits) * fontPx) / FONT_UNITS[unit];
	return null;
}

const NUMBER_AND_UNIT = /(-?\d*\.?\d+(?:e[+-]?\d+)?)([a-z%]*)/g;

/**
 * Whether every number in a value is a length within `most` px (a percentage within
 * `mostPercent`, a bare number within `mostNumber`), and none below zero, or none further
 * below it than `mostBelow` px. An em is `fontPx`, the size of the element's own text.
 * A value worked out by the browser (calc(), var(), min()) cannot be checked, and is not within.
 */
function within(
	value: string,
	limits: { most: number; mostBelow?: number; mostPercent?: number; mostNumber?: number },
	fontPx: number
): boolean {
	if (/[()]/.test(value)) return false;
	for (const [, digits, unit] of value.toLowerCase().matchAll(NUMBER_AND_UNIT)) {
		const number = Number(digits);
		if (!Number.isFinite(number)) return false;
		const size = Math.abs(number);
		if (unit === '%') {
			if (number < 0 || size > (limits.mostPercent ?? 100)) return false;
		} else if (unit === '') {
			if (number < 0 || size > (limits.mostNumber ?? 0)) return false;
		} else {
			// (A unit not known is also a share of the window, vw or vh: not a size a document has.)
			const px = lengthPx(digits, unit, fontPx);
			if (px === null || px > limits.most || px < -(limits.mostBelow ?? 0)) return false;
		}
	}
	return true;
}

/** A style value that is one length, in px; null for anything else (auto, a percentage, two values). */
function oneLengthPx(value: string, fontPx: number): number | null {
	const match = /^\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)([a-z]*)\s*$/i.exec(value);
	if (!match) return null;
	if (Number(match[1]) === 0) return 0;
	return lengthPx(match[1], match[2].toLowerCase(), fontPx);
}

/**
 * The size in px that a font-size gives, under text of `parentPx`; null where it cannot be told
 * (a value worked out by the browser, a unit that is a share of the window).
 */
function fontSizePx(value: string, parentPx: number): number | null {
	const text = value.trim().toLowerCase();
	if (text in NAMED_FONT_PX) return NAMED_FONT_PX[text];
	if (text === 'larger') return parentPx * FONT_STEP;
	if (text === 'smaller') return parentPx / FONT_STEP;
	if (text === 'inherit' || text === 'initial' || text === 'unset' || text === 'revert') return text === 'initial' ? BASE_FONT_PX : parentPx;
	const match = /^(\d*\.?\d+(?:e[+-]?\d+)?)([a-z%]*)$/.exec(text);
	if (!match) return null;
	if (match[2] === '%') return (Number(match[1]) * parentPx) / 100;
	if (match[2] === '') return Number(match[1]) === 0 ? 0 : null;
	return lengthPx(match[1], match[2], parentPx);
}

/** Whether a font size is one text can have: large enough to be there, no larger than a page. */
function fontSizeAllowed(px: number | null): px is number {
	return px !== null && px >= LEAST_FONT_PX && px <= MOST_PX;
}

/**
 * The size of each element's text, as far as the styles in the document say, for one pass over
 * it. A size counted in the size above it (2em, 300%, larger) grows with every element it is
 * nested in, so a limit on the value alone is no limit: a hundred times a hundred times 16 px.
 * (Text with no size set anywhere above it is taken as 16 px, whatever the page gives it.)
 */
type FontSizes = Map<Element, number>;

/** The size of the text around an element: what its ancestors' styles make it. */
function fontPxAround(el: Element, known: FontSizes): number {
	const above: Element[] = [];
	let px = BASE_FONT_PX;
	for (let up = el.parentElement; up; up = up.parentElement) {
		const found = known.get(up);
		if (found !== undefined) {
			px = found;
			break;
		}
		above.push(up);
	}
	for (let i = above.length - 1; i >= 0; i--) {
		const own = (above[i] as HTMLElement).style?.getPropertyValue('font-size');
		const size = own ? fontSizePx(own, px) : null;
		if (fontSizeAllowed(size)) px = size;
		known.set(above[i], px);
	}
	return px;
}

/** Whether a property that places or sizes an element has a value a document would give it. */
function sizeAllowed(name: string, value: string, tag: string, fontPx: number): boolean {
	if (name === 'margin-left' && (tag === 'ul' || tag === 'ol')) return within(value, { most: MOST_PX, mostBelow: LIST_OUTDENT_PX }, fontPx);
	if (name.startsWith('padding') && INLINE_TAGS.has(tag)) return within(value, { most: INLINE_PADDING_PX, mostPercent: 0 }, fontPx);
	if (name.startsWith('margin') || name.startsWith('padding')) return within(value, { most: MOST_PX }, fontPx);
	// (A first line that starts left of its paragraph is looked at with the paragraph's own
	// indent, in sanitizeStyle.)
	if (name === 'text-indent') return within(value, { most: MOST_PX, mostBelow: MOST_PX }, fontPx);
	if (name === 'width' || name === 'height') return SIZED_TAGS.has(tag) && within(value, { most: MOST_PX }, fontPx);
	if (name === 'display') return DISPLAY_VALUES.has(value.trim().toLowerCase());
	if (name === 'line-height') return within(value, { most: 400, mostPercent: 1000, mostNumber: 10 }, fontPx);
	if (/^border.*width$/.test(name) || name === 'border-spacing' || name === 'text-decoration-thickness') return within(value, { most: 100 }, fontPx);
	if (name.endsWith('tab-size')) return within(value, { most: MOST_PX, mostNumber: 100 }, fontPx);
	return true;
}

/**
 * Whether a width or height attribute is within a page. (A browser reads the number at its
 * start and takes it as px, or as a share of the width with a % after it.)
 */
function sizeAttributeAllowed(value: string): boolean {
	const match = /^\s*(\d*\.?\d+)\s*(%?)/.exec(value);
	if (!match) return true;
	return Number(match[1]) <= (match[2] === '%' ? 100 : MOST_PX);
}

/** The style text split into what it declares, each as it was written. */
function declarations(raw: string): { name: string; text: string }[] {
	return raw
		.split(';')
		.map((text) => ({ name: (text.includes(':') ? text.slice(0, text.indexOf(':')) : text).trim().toLowerCase(), text }))
		.filter((declaration) => declaration.name !== '');
}

/**
 * Whether a declaration, taken alone, is one this browser does not read. Asked only where two
 * of an attribute's names are a short form and one of its parts ("margin" and "margin-left"):
 * there the properties the browser read do not say which of the two it read them from, and
 * "margin: 0; margin-left: expression(…)" passed as read in full.
 */
function unreadAlone(text: string, el: HTMLElement): boolean {
	const probe = el.ownerDocument.createElement('span');
	probe.setAttribute('style', text);
	return !probe.style || probe.style.length === 0;
}

function sanitizeStyle(el: HTMLElement, tag: string, fonts: FontSizes): void {
	const raw = el.getAttribute('style');
	if (raw === null) return;
	const style = el.style;
	if (!style) {
		el.removeAttribute('style');
		return;
	}
	const wordHidden = WORD_HIDDEN.test(raw);
	const drop: string[] = [];
	// The size of this element's text first: its other lengths may be counted in it.
	let fontPx = fontPxAround(el, fonts);
	const fontSize = style.getPropertyValue('font-size');
	if (fontSize) {
		const px = fontSizePx(fontSize, fontPx);
		if (fontSizeAllowed(px)) fontPx = px;
		else drop.push('font-size');
	}
	fonts.set(el, fontPx);
	for (let i = 0; i < style.length; i++) {
		const name = style.item(i);
		const value = style.getPropertyValue(name);
		if (name === 'font-size') continue;
		if (name in NO_BORDER_IMAGE) {
			// `border: 1px solid` also says "no border picture", and a browser lists that with
			// the properties it read. That much is no reason to write the attribute again; a
			// border picture itself is drawn outside its element, and a document has none.
			if (!NO_BORDER_IMAGE[name].includes(value.trim().toLowerCase())) drop.push(...Object.keys(NO_BORDER_IMAGE));
			continue;
		}
		if (!STYLE_PROPERTY.test(name) || UNSAFE_STYLE_VALUE.test(value) || !sizeAllowed(name, value, tag, fontPx)) drop.push(name);
	}
	// A first line may start left of its paragraph as far as the paragraph is itself moved in:
	// a hanging indent, "margin-left:36pt;text-indent:-36pt". Further, and its first words are
	// left of the editing area, where nothing shows them.
	const first = style.getPropertyValue('text-indent');
	if (first.includes('-') && !drop.includes('text-indent')) {
		const side = el.closest('[dir]')?.getAttribute('dir')?.toLowerCase() === 'rtl' ? 'right' : 'left';
		let room = 0;
		for (const name of [`margin-${side}`, `padding-${side}`]) {
			if (!drop.includes(name)) room += oneLengthPx(style.getPropertyValue(name), fontPx) ?? 0;
		}
		const indent = oneLengthPx(first, fontPx);
		if (indent === null || -indent > room + 0.5) drop.push('text-indent');
	}
	// The attribute stays as it was written only if all of it is something read and kept. What
	// this browser did not read as a property does nothing on this page, but it is still in the
	// attribute for whatever shows the HTML next: "width: expression(…)" went through that way.
	// So where the attribute names a property that is not kept, or a value that loads or runs
	// something, it is written again from the properties that were read and kept.
	const declared = declarations(raw);
	const names = declared.map((declaration) => declaration.name);
	const read = Array.from({ length: style.length }, (_, i) => style.item(i));
	const shortAndPart = names.some((name) => names.some((other) => other.startsWith(`${name}-`)));
	// (A property named twice is read once, and which one cannot be told from here.)
	const unread =
		UNSAFE_STYLE_VALUE.test(raw) ||
		new Set(names).size !== names.length ||
		names.some((name) => !STYLE_PROPERTY.test(name) || !read.some((property) => property === name || property.startsWith(`${name}-`))) ||
		(shortAndPart && declared.some((declaration) => unreadAlone(declaration.text, el)));
	if (drop.length === 0 && !unread) return;
	for (const name of drop) style.removeProperty(name);
	// What Word hid stays hidden, in a way the browser keeps: mso-hide is not a property it
	// reads, so the text showed on screen while the RTF left it out.
	if (wordHidden) style.setProperty('display', 'none');
	const kept = style.cssText;
	if (kept) el.setAttribute('style', kept);
	else el.removeAttribute('style');
}

/**
 * Whether an id is a name the page's scripts look up on `window` (id="location", or a variable
 * of the page's own). In a browser every element's id is also a name on `window`, which gives
 * the element; that is no such name, or a document shown a second time, with its first showing
 * still in the editor, would lose every id it has.
 */
function namesAGlobal(id: string): boolean {
	if (!(id in globalThis)) return false;
	try {
		const value: unknown = (globalThis as Record<string, unknown>)[id];
		if (typeof Element !== 'undefined' && value instanceof Element) return value.id !== id;
		if (typeof HTMLCollection !== 'undefined' && value instanceof HTMLCollection) return value[0]?.id !== id;
	} catch {
		// Not to be read from here: something of the browser's own.
	}
	return true;
}

function sanitizeAttributes(el: HTMLElement, tag: string, fonts: FontSizes, idTaken?: (id: string) => boolean, keep?: Kept): void {
	const own = TAG_ATTRIBUTES[tag];
	for (const attr of Array.from(el.attributes)) {
		const name = attr.name.toLowerCase();
		if (name === 'class') {
			const stay = Array.from(el.classList).filter((token) => token === KEPT_CLASS || keep?.classes.has(token));
			if (stay.length > 0) el.setAttribute('class', stay.join(' '));
			else el.removeAttribute(attr.name);
			continue;
		}
		if (name === 'id') {
			// A document's own ids are kept: an application marks its paragraphs with them. Not
			// one that names something the page's scripts look up on `document` or `window`
			// (id="cookie", id="location"), and not one the page already has an element for
			// (`idTaken`): the newcomer would answer to getElementById in its place, and take on
			// what the page's stylesheet gives "#sidebar". And not one on a link: a script that
			// reads `window.settings` and finds a link there reads the link's address as text.
			if (attr.value in document || namesAGlobal(attr.value) || idTaken?.(attr.value) || (tag === 'a' && el.hasAttribute('href'))) {
				el.removeAttribute(attr.name);
			}
			continue;
		}
		if (!GLOBAL_ATTRIBUTES.has(name) && !own?.includes(name) && !keep?.attributes.has(name)) el.removeAttribute(attr.name);
		// width="100000" is a table a hundred thousand pixels wide.
		else if ((name === 'width' || name === 'height') && !sizeAttributeAllowed(attr.value)) el.removeAttribute(attr.name);
	}
	// What is in a <details> is in the RTF whether it is open or not, so it is shown open.
	if (tag === 'details') el.setAttribute('open', '');
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
	sanitizeStyle(el, tag, fonts);
}

/**
 * Whether an element is a formula's copy for a screen reader, beside the same formula written
 * as text: KaTeX writes both, and its stylesheet hides this one. Kept, "30%" read "30%30%".
 */
function isReadAloudCopy(el: Element): boolean {
	return (
		el.classList.contains('katex-mathml') &&
		Array.from(el.parentElement?.children ?? []).some((beside) => beside.classList.contains('katex-html'))
	);
}

/**
 * Make the elements under `root` safe, in place. With `only`, just the elements it accepts (the
 * ones a paste brought in) are looked at; the rest of the document is left as it is. With
 * `idTaken`, an id it says the page already uses is taken off. With `keep` (see keptMarks),
 * the application's own `data-` attributes and classes stay.
 * Returns whether anything was taken out or changed.
 */
export function sanitizeTree(
	root: Element,
	only?: (el: Element) => boolean,
	idTaken?: (id: string) => boolean,
	keep?: Kept
): boolean {
	let changed = false;
	const fonts: FontSizes = new Map();
	/** The words of the last element that left its words, where they are still in the document. */
	let lastKept: Text | null = null;
	for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
		// Gone already, with something it was in.
		if (!root.contains(el)) continue;
		if (only && !only(el)) continue;
		const tag = el.tagName.toLowerCase();
		if (REMOVED_TAGS.has(tag) || isReadAloudCopy(el)) {
			el.remove();
			changed = true;
			continue;
		}
		if (TEXT_KEPT_TAGS.has(tag)) {
			const text = shownText(el, tag);
			if (text) {
				// Two boxes side by side were two things on the screen: "1" and "5", not "15".
				const kept = el.ownerDocument.createTextNode(lastKept !== null && el.previousSibling === lastKept ? ` ${text}` : text);
				el.replaceWith(kept);
				lastKept = kept;
			} else {
				el.remove();
			}
			changed = true;
			continue;
		}
		// A custom element would be given its behaviour by the page: only what it holds is kept,
		// and nothing of one that was hidden, which would show once the element is gone.
		if (tag.includes('-')) {
			if (hiddenByItself(el)) el.remove();
			else el.replaceWith(...Array.from(el.childNodes));
			changed = true;
			continue;
		}
		const before = el.attributes.length + (el.getAttribute('style') ?? '') + (el.getAttribute('href') ?? '') + (el.getAttribute('width') ?? '') + (el.getAttribute('height') ?? '');
		sanitizeAttributes(el, tag, fonts, idTaken, keep);
		if (before !== el.attributes.length + (el.getAttribute('style') ?? '') + (el.getAttribute('href') ?? '') + (el.getAttribute('width') ?? '') + (el.getAttribute('height') ?? '')) changed = true;
	}
	return changed;
}

/**
 * HTML made safe to show and edit: see the top of this file for what is kept. It is parsed in a
 * document of its own, where nothing in it runs or loads, before any of it reaches the page.
 * Where there is no DOM to parse it with (on a server), nothing is returned: HTML that could
 * not be checked is not passed on. `keepAttributes` and `keepClasses` name marks of the
 * application's own to leave on (see keptMarks).
 */
export function sanitizeHtml(html: string, options?: KeepOptions): string {
	return safeBody(html, undefined, keptMarks(options))?.innerHTML ?? '';
}

/** The HTML, read in a document of its own and made safe there; null where it cannot be. */
function safeBody(html: string, idTaken?: (id: string) => boolean, keep?: Kept): HTMLElement | null {
	if (!html || typeof DOMParser === 'undefined') return null;
	const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
	sanitizeTree(doc.body, undefined, idTaken, keep);
	return doc.body;
}

/**
 * The same, as nodes for `into` to hold. The editor puts these in the page as they are: what was
 * checked is what is shown. Written out as text and read in again, a second reading has to
 * agree with the first for the check to mean anything, and that is where a sanitizer is got
 * round; it is also a third pass over a document that may hold megabytes of pictures.
 */
export function sanitizedNodes(html: string, into: Document, idTaken?: (id: string) => boolean, keep?: Kept): Node[] {
	const body = safeBody(html, idTaken, keep);
	if (!body) return [];
	return Array.from(body.childNodes).map((node) => into.importNode(node, true));
}

// ── What a paste loses on the way in ──
// A paste is made safe after the browser has put it in the page, and a browser changes two
// things first. Chromium takes a <span> whose only style is Word's "mso-hide: all" apart, as a
// span with no style it knows, and its hidden words are then words like any other. And it
// pastes a text box at the end of a paste empty. So both are read from the clipboard itself
// before the paste, and set right after it.

/** A run of a paste's text. */
interface PastePiece {
	text: string;
	/** Hidden by Word's mark. */
	hidden: boolean;
	/** Not shown by a style a browser knows, or by `hidden`. */
	undisplayed: boolean;
}

/** What a paste holds that a browser may not carry into the page as it is. */
export interface PasteNotes {
	/** Its text in order. */
	pieces: PastePiece[];
	/** What each of its text boxes held. */
	textareas: string[];
}

/** Elements whose text is not text of the page. */
const NOT_PAGE_TEXT = new Set(['script', 'style', 'title', 'template', 'noscript', 'textarea']);

const withoutSpace = (text: string) => text.replace(/\s/g, '');

/**
 * Read from a paste's HTML what the browser's own paste may lose: null where it holds neither
 * Word's hidden text nor a text box, which is nearly every paste.
 */
export function pasteNotes(html: string): PasteNotes | null {
	if (typeof DOMParser === 'undefined' || !(WORD_HIDDEN.test(html) || /<textarea/i.test(html))) return null;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const notes: PasteNotes = { pieces: [], textareas: [] };
	// What is pasted is what lies between these two comments, where a program wrote them.
	let inside = !html.includes('<!--StartFragment');
	const todo: { node: Node; hidden: boolean; undisplayed: boolean }[] = [{ node: doc.documentElement, hidden: false, undisplayed: false }];
	while (todo.length > 0) {
		const { node, hidden, undisplayed } = todo.pop()!;
		if (node.nodeType === 8) {
			const comment = (node as Comment).data.trim();
			if (comment.startsWith('StartFragment')) inside = true;
			else if (comment.startsWith('EndFragment')) inside = false;
			continue;
		}
		if (node.nodeType === 3) {
			if (inside) notes.pieces.push({ text: (node as Text).data, hidden, undisplayed });
			continue;
		}
		if (node.nodeType !== 1) continue;
		const el = node as Element;
		const tag = el.tagName.toLowerCase();
		if (tag === 'textarea' && inside) notes.textareas.push(el.textContent ?? '');
		if (NOT_PAGE_TEXT.has(tag)) continue;
		const style = el.getAttribute('style') ?? '';
		const state = {
			hidden: hidden || WORD_HIDDEN.test(style),
			undisplayed: undisplayed || el.hasAttribute('hidden') || STYLED_HIDDEN.test(style)
		};
		const children = Array.from(el.childNodes);
		for (let i = children.length - 1; i >= 0; i--) todo.push({ node: children[i], ...state });
	}
	return notes;
}

/**
 * Take Word's hidden text out of what a paste put under `root`. The paste is the text from the
 * `from`th to the `to`th character of `root` that is not white space. Nothing is done unless
 * that text is the paste's own, character for character: only then is it known which of the
 * characters were the hidden ones. An element left with nothing in it goes too, where
 * `mayRemove` allows (a paragraph that was hidden whole would stay as an empty line in the
 * RTF). Returns whether anything was taken out.
 */
export function removeWordHidden(
	root: Element,
	from: number,
	to: number,
	notes: PasteNotes,
	mayRemove?: (el: Element) => boolean
): boolean {
	const texts: Text[] = [];
	const todo: Node[] = [root];
	while (todo.length > 0) {
		const node = todo.pop()!;
		if (node.nodeType === 3) texts.push(node as Text);
		const children = Array.from(node.childNodes);
		for (let i = children.length - 1; i >= 0; i--) todo.push(children[i]);
	}
	const pasted = withoutSpace(texts.map((text) => text.data).join('')).slice(from, to);
	// A browser may leave what is not displayed out of a paste, or bring it along.
	for (const pieces of [notes.pieces, notes.pieces.filter((piece) => !piece.undisplayed)]) {
		if (withoutSpace(pieces.map((piece) => piece.text).join('')) !== pasted) continue;
		/** The hidden runs, as [first, after last] among the characters that are not white space. */
		const runs: [number, number][] = [];
		let at = from;
		for (const piece of pieces) {
			const length = withoutSpace(piece.text).length;
			if (piece.hidden && length > 0) {
				const last = runs[runs.length - 1];
				if (last && last[1] === at) last[1] = at + length;
				else runs.push([at, at + length]);
			}
			at += length;
		}
		if (runs.length === 0) return false;
		let index = 0;
		let run = 0;
		/** Whether the last character kept was white space, and whether a hidden one came after it. */
		let afterSpace = false;
		let afterHidden = false;
		for (const text of texts) {
			/** The stretches of this text to take out, as [first, after last]. */
			const out: [number, number][] = [];
			const data = text.data;
			for (let i = 0; i < data.length; i++) {
				while (run < runs.length && runs[run][1] <= index) run++;
				const [first, after] = run < runs.length ? runs[run] : [Infinity, Infinity];
				let hide: boolean;
				if (/\s/.test(data[i])) {
					// White space is hidden with the run it is inside of. At the run's edges it
					// stays, but as one space: "one [hidden] two" is "one two", not "one  two".
					hide = (index > first && index < after) || (afterHidden && afterSpace);
					if (!hide) afterSpace = true;
				} else {
					hide = index >= first && index < after;
					if (hide) afterHidden = true;
					else afterSpace = afterHidden = false;
					index++;
				}
				if (!hide) continue;
				const last = out[out.length - 1];
				if (last && last[1] === i) last[1] = i + 1;
				else out.push([i, i + 1]);
			}
			if (out.length === 0) continue;
			// Taken out stretch by stretch, last first: a caret in this text then stays where it
			// was among the characters that are left. Given new text whole, it would jump to
			// the start.
			for (let i = out.length - 1; i >= 0; i--) text.deleteData(out[i][0], out[i][1] - out[i][0]);
			let emptied = text.parentElement;
			if (text.data === '') text.remove();
			while (emptied && emptied !== root && emptied.childNodes.length === 0 && mayRemove?.(emptied)) {
				const up = emptied.parentElement;
				emptied.remove();
				emptied = up;
			}
		}
		return true;
	}
	return false;
}
