<script lang="ts">
	/**
	 * InkEditor — A reusable Svelte 5 Rich Text Editor component.
	 *
	 * Props:
	 *   content       — Initial HTML content (string). Default: empty paragraph.
	 *   placeholder   — Placeholder text shown when editor is empty.
	 *   autosave      — Enable localStorage auto-save. Default: true.
	 *   storageKey    — localStorage key for auto-save. Default: 'ink-editor-content'.
	 *   showToolbar   — Show the formatting toolbar. Default: true.
	 *   showStatusBar — Show the word/char count status bar. Default: true.
	 *   minHeight     — CSS min-height of the editing area. Default: '40vh'.
	 *   readonly      — If true, editor is not editable. Default: false.
	 *   maxImageEdge  — Longest edge (px) an inserted image is scaled down to.
	 *                   0 keeps the original dimensions. Default: 1600.
	 *   maxImageDisplayWidth
	 *                 — Width (px) a newly inserted image is displayed at, unless
	 *                   the editor column is narrower. Defaults to 624 — 6.5in of
	 *                   page at 96 dpi — so pictures arrive sized to the page
	 *                   rather than to the browser window. 0 fills the column.
	 *   maxImageBytes — Encoded byte ceiling per inserted image. Pictures over it
	 *                   are re-encoded (and shrunk if needed) until they fit,
	 *                   which is what bounds the RTF payload — it costs two hex
	 *                   characters per byte. 0 disables. Default: 524288 (512 KB,
	 *                   about 1 MB of document per image).
	 *   fontFamily    — Font for the document, both on screen and in the RTF.
	 *                   Default: 'Arial'.
	 *   fontSize      — Body text size in points, both on screen and in the RTF.
	 *                   Headings scale from it. Default: 12.
	 *
	 * Events (callback props):
	 *   onchange      — Fires on content change with
	 *                   { html, text, wordCount, charCount, estimatedRtfBytes }.
	 *   onsave        — Fires on auto-save or Ctrl+S with { html }.
	 *   onimport      — Fires after a successful RTF import with { html }.
	 *
	 * Bindable methods (via bind:this):
	 *   getHTML()      — Returns the current editor HTML string.
	 *   getText()      — Returns plain text content.
	 *   setHTML(html)  — Replaces editor content with the given HTML.
	 *   getMarkdown()  — Returns Markdown conversion of current content.
	 *   getRTF()       — Returns RTF conversion of current content.
	 *   getRtfSize()   — Returns the exact byte size of that RTF.
	 *   clear()        — Clears the editor (no confirm dialog).
	 *   focus()        — Focuses the editor.
	 *   exportFile(format) — Downloads as 'html', 'md', or 'rtf'.
	 *   importRtf()    — Opens the file picker to import an RTF file.
	 */

	import { onMount } from 'svelte';
	import Toolbar from './Toolbar.svelte';
	import Modal from './Modal.svelte';
	import ImageOverlay from './ImageOverlay.svelte';
	import { htmlToMarkdown, downloadFile } from '../utils.js';
	import { readRtfFile } from '../rtf-parser.js';
	import {
		htmlToRtf,
		estimateRtfBytes,
		isSafeLinkUrl,
		cssFontFamily,
		normalizeFontSize,
		DEFAULT_FONT_FAMILY,
		DEFAULT_FONT_SIZE
	} from '../rtf-writer.js';
	import {
		fileToImageSrc,
		urlToImageSrc,
		isSafeImageUrl,
		stripExtension,
		initialDisplayWidth,
		DEFAULT_MAX_IMAGE_EDGE,
		DEFAULT_MAX_IMAGE_BYTES,
		DEFAULT_MAX_IMAGE_DISPLAY_WIDTH
	} from '../images.js';

	interface ChangePayload {
		html: string;
		text: string;
		wordCount: number;
		charCount: number;
		/**
		 * Approximate size of this document as RTF. Pictures dominate it and are
		 * counted exactly; see getRtfSize() for the precise figure.
		 */
		estimatedRtfBytes: number;
	}

	interface Props {
		content?: string;
		placeholder?: string;
		autosave?: boolean;
		storageKey?: string;
		showToolbar?: boolean;
		showStatusBar?: boolean;
		minHeight?: string;
		readonly?: boolean;
		maxImageEdge?: number;
		maxImageBytes?: number;
		maxImageDisplayWidth?: number;
		fontFamily?: string;
		fontSize?: number;
		onchange?: (payload: ChangePayload) => void;
		onsave?: (payload: { html: string }) => void;
		onimport?: (payload: { html: string }) => void;
	}

	// ── Props ──
	let {
		content = '<p></p>',
		placeholder = 'Start writing something beautiful...',
		autosave = true,
		storageKey = 'ink-editor-content',
		showToolbar = true,
		showStatusBar = true,
		minHeight = '40vh',
		readonly = false,
		maxImageEdge = DEFAULT_MAX_IMAGE_EDGE,
		maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
		maxImageDisplayWidth = DEFAULT_MAX_IMAGE_DISPLAY_WIDTH,
		fontFamily = DEFAULT_FONT_FAMILY,
		fontSize = DEFAULT_FONT_SIZE,
		onchange,
		onsave,
		onimport
	}: Props = $props();

	// The same font and size go to the screen and to the RTF, so the editor
	// shows what the receiving system will show.
	const rtfOptions = $derived({ fontFamily, fontSize });
	const screenFontFamily = $derived(cssFontFamily(fontFamily));
	const screenFontSize = $derived(normalizeFontSize(fontSize));

	// ── Internal state ──
	let editorEl: HTMLDivElement | null = $state(null);
	let contentWrapEl: HTMLDivElement | null = $state(null);
	let wordCount: number = $state(0);
	let charCount: number = $state(0);
	let lastSaved: string = $state('');
	let currentBlock: string = $state('p');

	let formatState = $state({
		bold: false,
		italic: false,
		underline: false,
		strikeThrough: false
	});

	// Modal state
	let linkModalOpen: boolean = $state(false);
	let imageModalOpen: boolean = $state(false);
	let linkUrl: string = $state('');
	let linkError: string = $state('');
	let linkText: string = $state('');
	let imageUrl: string = $state('');
	let imageAlt: string = $state('');
	let imageCaption: string = $state('');
	let savedSelection: Range | null = $state(null);

	// Image state
	let imageInputEl: HTMLInputElement | null = $state(null);
	let pendingImageFiles: File[] = $state([]);
	let selectedImage: HTMLImageElement | null = $state(null);
	let overlayRef: { reposition: () => void } | null = $state(null);
	let insertingImages: boolean = $state(false);

	// Import state
	let fileInputEl: HTMLInputElement | null = $state(null);
	let importing: boolean = $state(false);
	let importError: string = $state('');

	// ── Public API (exposed via bind:this) ──
	export function getHTML(): string {
		return editorEl?.innerHTML || '';
	}

	export function getText(): string {
		return editorEl?.innerText || '';
	}

	export function setHTML(html: string): void {
		if (editorEl) {
			selectedImage = null;
			documentReplaced();
			editorEl.innerHTML = html;
			updateCounts();
			if (autosave) scheduleAutoSave();
		}
	}

	export function getMarkdown(): string {
		if (!editorEl) return '';
		return htmlToMarkdown(editorEl);
	}

	export function getRTF(): string {
		if (!editorEl) return '';
		return htmlToRtf(editorEl, rtfOptions);
	}

	/**
	 * Exact size of the RTF this document produces, in bytes. The output is
	 * ASCII, so this is also its character count — the figure a transport with a
	 * field-length limit cares about. Does the full conversion, including
	 * hex-encoding every picture, so call it when a number is needed rather than
	 * on every keystroke; the onchange payload carries an estimate for that.
	 */
	export function getRtfSize(): number {
		if (!editorEl) return 0;
		return htmlToRtf(editorEl, rtfOptions).length;
	}

	export function clear(): void {
		if (editorEl) {
			selectedImage = null;
			documentReplaced();
			editorEl.innerHTML = '<p></p>';
			try { localStorage.removeItem(storageKey); } catch (e) {}
			updateCounts();
			lastSaved = '';
			fireChange();
		}
	}

	export function focus(): void {
		editorEl?.focus();
	}

	export function exportFile(format = 'html'): void {
		if (!editorEl) return;
		switch (format) {
			case 'html': {
				const html = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>Document</title></head>\n<body>\n${editorEl.innerHTML}\n</body>\n</html>`;
				downloadFile('document.html', html, 'text/html');
				break;
			}
			case 'md':
			case 'markdown': {
				const md = htmlToMarkdown(editorEl);
				downloadFile('document.md', md, 'text/markdown');
				break;
			}
			case 'rtf': {
				const rtf = htmlToRtf(editorEl, rtfOptions);
				downloadFile('document.rtf', rtf, 'application/rtf');
				break;
			}
		}
	}

	export function importRtf(): void {
		fileInputEl?.click();
	}

	/**
	 * The whole document is about to be replaced (setHTML, clear, an RTF import): nothing that
	 * points into the old one may act on the new one. Indent steps no longer undo, the Copy format
	 * brush is put down, and a paste that inserted nothing is forgotten.
	 */
	function documentReplaced(): void {
		indentUndo = [];
		pastedOver = null;
		stopCopyFormat();
	}

	// The frame around the paragraph copied from follows it when the text reflows: typing is caught
	// by the input handler, and a picture finishing loading or the editor changing width by this.
	$effect(() => {
		if (copyFormat !== 'apply' || !editorEl || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => placeCopySourceBox());
		observer.observe(editorEl);
		return () => observer.disconnect();
	});

	// A read-only editor has no toolbar to put the brush down with.
	$effect(() => {
		if (readonly) stopCopyFormat();
	});

	// ── Selection helpers ──
	function saveSelection(): void {
		const sel = window.getSelection();
		if (sel && sel.rangeCount > 0) {
			savedSelection = sel.getRangeAt(0).cloneRange();
		}
	}

	function restoreSelection(): void {
		if (savedSelection) {
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(savedSelection);
		}
	}

	// ── Exec command ──
	function exec(cmd: string, value: string | null = null): void {
		restoreSelection();
		editorEl?.focus();
		// Color commands require an actual text selection — a collapsed cursor
		// would silently apply the color to nothing (or to subsequently typed
		// text), which causes accidental color spans to appear in the RTF output.
		if (cmd === 'foreColor' || cmd === 'hiliteColor') {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) return;
		}
		if (isIndentCommand(cmd)) {
			indentBlocks(cmd);
			return;
		}
		if (cmd === 'hangAtCaret') {
			hangAtCaret();
			return;
		}
		if (cmd === 'undo' && undoIndent()) return;
		document.execCommand(cmd, false, value ?? undefined);
		updateToolbarState();
	}

	// ── Indent ──
	// Indent and Outdent move the paragraphs the selection touches by half an inch (48px, written
	// to RTF as \li720) per press, as margin-left on each paragraph. The browser's own commands are
	// not used: Chromium's Outdent strips the first paragraph to loose text ("one<br>"), and the
	// browsers disagree on the markup. Only a style changes (and a line of loose text gets a
	// paragraph of its own), so earlier typing stays undoable; the editor keeps its own undo for
	// these steps until the next edit.
	//
	// The right indent and the hanging indent move by the same step, on a paragraph (a <p>, or a
	// <div> that holds text) outside a table cell, which is where the RTF writer sends them:
	//
	// | Command                          | Style on the paragraph                 | RTF            |
	// |----------------------------------|----------------------------------------|----------------|
	// | indent / outdent                 | margin-left                            | \liN           |
	// | rightIndent / rightOutdent       | margin-right                           | \riN           |
	// | hangingIndent / hangingOutdent   | margin-left, and text-indent the other | \liN\fi-N     |
	// |                                  | way, so the first line stays put       |                |
	//
	// Outdent stops where the first line of a hanging paragraph would reach the left edge.
	const INDENT_STEP_PX = 48;
	const INDENT_COMMANDS = ['indent', 'outdent', 'rightIndent', 'rightOutdent', 'hangingIndent', 'hangingOutdent'] as const;
	type IndentCommand = (typeof INDENT_COMMANDS)[number];
	function isIndentCommand(cmd: string): cmd is IndentCommand {
		return (INDENT_COMMANDS as readonly string[]).includes(cmd);
	}
	/** Commands that take an indent away: they never make a paragraph around loose text. */
	function decreases(cmd: IndentCommand): boolean {
		return cmd === 'outdent' || cmd === 'rightOutdent' || cmd === 'hangingOutdent';
	}
	const INDENT_TARGETS = 'p, div, h1, h2, h3, h4, h5, h6, pre, ul, ol, blockquote, figure';
	/** CSS lengths a margin is written in, in px. */
	const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

	/** One block an Indent or Outdent changed, and how to put it back. */
	interface IndentChange {
		el: HTMLElement;
		before: string | null;
		after: string | null;
		/** The block is a paragraph this step made around loose text, and the <br> that ended it. */
		wrapped: { br: HTMLBRElement | null } | null;
		/** The paragraph's data-rtf-tab-stops before a step that changed it. */
		stops?: { before: string | null; after: string | null };
	}
	let indentUndo: IndentChange[][] = [];

	function indentBlocks(cmd: IndentCommand): void {
		if (readonly || !editorEl) return;
		editorEl.focus();
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !editorEl.contains(sel.anchorNode)) return;
		const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
		const wrapped = new Map<HTMLElement, HTMLBRElement | null>();
		const targets = indentTargets(sel.getRangeAt(0), cmd, wrapped);
		// Wrapping loose text moves the selected text nodes, which collapses the selection; put it
		// back so the next press moves the same lines.
		if (wrapped.size > 0 && anchorNode instanceof Text && focusNode instanceof Text && anchorNode.isConnected && focusNode.isConnected) {
			sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
		}
		const step: IndentChange[] = [];
		for (const el of targets) {
			const before = el.getAttribute('style');
			const left = marginLeftPx(el);
			const first = textIndentPx(el);
			const setPx = (prop: 'marginLeft' | 'marginRight' | 'textIndent', px: number) => {
				el.style[prop] = px !== 0 ? `${Math.round(px * 100) / 100}px` : '';
			};
			if (cmd === 'indent') {
				setPx('marginLeft', left + INDENT_STEP_PX);
			} else if (cmd === 'outdent') {
				// A hanging paragraph's first line starts left of its margin: stop at the edge.
				const next = Math.max(0, -first, left - INDENT_STEP_PX);
				if (next === left) continue;
				setPx('marginLeft', next);
			} else if (cmd === 'rightIndent') {
				setPx('marginRight', marginRightPx(el) + INDENT_STEP_PX);
			} else if (cmd === 'rightOutdent') {
				const right = marginRightPx(el);
				if (right === 0) continue;
				setPx('marginRight', Math.max(0, right - INDENT_STEP_PX));
			} else if (cmd === 'hangingIndent') {
				setPx('marginLeft', left + INDENT_STEP_PX);
				setPx('textIndent', first - INDENT_STEP_PX);
			} else {
				// Only what hangs comes back: a paragraph with no hanging indent stays as it is.
				const back = Math.min(INDENT_STEP_PX, -first, left);
				if (back <= 0) continue;
				setPx('marginLeft', left - back);
				setPx('textIndent', first + back);
			}
			if (!el.getAttribute('style')) el.removeAttribute('style');
			const br = wrapped.get(el);
			step.push({ el, before, after: el.getAttribute('style'), wrapped: br === undefined ? null : { br } });
		}
		if (step.length === 0) return;
		indentUndo.push(step);
		indentChanged();
	}

	/** An element's left margin in px: its own, from the inline style, or 0. */
	function marginLeftPx(el: HTMLElement): number {
		return Math.max(0, stylePx(el, 'marginLeft'));
	}

	/** An element's right margin in px: its own, from the inline style, or 0. */
	function marginRightPx(el: HTMLElement): number {
		return Math.max(0, stylePx(el, 'marginRight'));
	}

	/** An element's first-line indent in px, from the inline style: negative when it hangs. */
	function textIndentPx(el: HTMLElement): number {
		return stylePx(el, 'textIndent');
	}

	/** A length from an element's inline style, in px, or 0 when it sets none. */
	function stylePx(el: HTMLElement, prop: 'marginLeft' | 'marginRight' | 'textIndent'): number {
		const value = el.style[prop].trim();
		if (!value) return 0;
		return (lengthPx(value) ?? parseFloat(getComputedStyle(el)[prop])) || 0;
	}

	/** A CSS length in px, or null when it is not a number in px, pt, in, cm or mm. */
	function lengthPx(value: string): number | null {
		const m = /^(-?\d*\.?\d+)(px|pt|in|cm|mm)$/.exec(value.trim().toLowerCase());
		return m ? parseFloat(m[1]) * PX_PER_UNIT[m[2]] : null;
	}

	/** A <p>, or a <div> that holds text and no blocks: what a right or hanging indent is set on. */
	function isPlainParagraph(el: HTMLElement): boolean {
		if (el.tagName !== 'P' && el.tagName !== 'DIV') return false;
		return !Array.from(el.children).some((c) => c.matches(`${INDENT_TARGETS}, table, hr`));
	}

	/**
	 * The indent shape Chromium, WebKit and Gmail paste: a blockquote with a left margin and
	 * border: none. A quotation keeps its border. The RTF writer reads it the same way.
	 */
	function isIndentBlockquote(el: Element): el is HTMLElement {
		return el instanceof HTMLElement && el.tagName === 'BLOCKQUOTE' && el.style.borderLeftStyle === 'none';
	}

	// ── Hang at caret ──
	// Sets the hanging indent to where the caret is: the first line stays where it starts, and the
	// lines after it begin under the caret. Put the caret after "A. Pancreas: " and the rest of the
	// paragraph lines up under the diagnosis. With the caret at the start of the line the hang is
	// taken away. Works on a paragraph (a <p>, or a <div> that holds text) outside a table cell,
	// aligned left or justified, where a position measured from the left means something.
	//
	// When a tab comes before the caret, the tab has to end at the new indent for the first line to
	// line up with the rest. The paragraph gets a tab stop there: tab-size on screen (stops are
	// counted from the indent, so one hang's width puts a stop on it) and data-rtf-tab-stops for
	// the writer's \tx.
	const TAB_STOPS = 'data-rtf-tab-stops';

	function hangAtCaret(): void {
		if (readonly || !editorEl) return;
		editorEl.focus();
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !editorEl.contains(sel.anchorNode)) return;
		const caret = sel.getRangeAt(0).cloneRange();
		caret.collapse(true);
		const node = caret.startContainer;
		const offset = caret.startOffset;
		const el = node instanceof Element ? node : node.parentElement;
		if (!el || el.closest('td, th, li, pre, figure, h1, h2, h3, h4, h5, h6')) return;
		const x = caretLeft(caret);
		if (x === null) return;

		const closest = el.closest(PAINT_BLOCKS);
		let block = closest instanceof HTMLElement && closest !== editorEl && editorEl.contains(closest) ? closest : null;
		let wrapped: { br: HTMLBRElement | null } | null = null;
		if (block && !isPlainParagraph(block)) return;
		if (!block) {
			const made = wrapLooseLine(node);
			if (!made) return;
			block = made.p;
			wrapped = { br: made.br };
			// Wrapping moved the text the caret was in: put the caret back.
			if (node.isConnected) sel.collapse(node, offset);
		}
		// A centered <div align="center"> computes to -webkit-center or -moz-center.
		if (/(center|right)$|^end$/.test(getComputedStyle(block).textAlign)) {
			if (wrapped) undoWrap(block, wrapped);
			return;
		}

		const left = marginLeftPx(block);
		// Where the first line starts, and where the caret is, both from the page's left edge.
		const first = Math.max(0, left + textIndentPx(block));
		const at = Math.round(x - (block.getBoundingClientRect().left - left));
		const hang = at - first;
		const before = wrapped ? null : block.getAttribute('style');
		const stopsBefore = block.getAttribute(TAB_STOPS);
		const before0 = document.createRange();
		before0.setStart(block, 0);
		before0.setEnd(node, offset);
		const tabBefore = before0.toString().includes('\t');

		// The stop an earlier hang put at the old indent goes with that hang. Any other stop the
		// paragraph has (data-rtf-tab-stops="1.75in,3.5in") is not this command's to remove.
		// A tab stop counts from the page margin, as \tx does, while the indents above count from the
		// block around the paragraph: a quotation or a pasted indent moves the stop with it.
		const outer = surroundingIndentPx(block);
		const hung = textIndentPx(block) < 0;
		const stops = (stopsBefore ?? '')
			.split(',')
			.map((v) => v.trim())
			.filter((v) => v && !(hung && Math.abs((lengthPx(v) ?? NaN) - (outer + left)) < 0.5));
		// tab-size shows one stop, the one at the hang: it goes when that stop does.
		block.style.tabSize = '';
		if (hang < 1) {
			block.style.marginLeft = first > 0 ? `${first}px` : '';
			block.style.textIndent = '';
		} else {
			block.style.marginLeft = `${at}px`;
			block.style.textIndent = `${-hang}px`;
			if (tabBefore) {
				block.style.tabSize = `${hang}px`;
				const stop = outer + at;
				if (!stops.some((v) => Math.abs((lengthPx(v) ?? NaN) - stop) < 0.5)) stops.push(`${stop}px`);
			}
		}
		if (stops.length > 0) block.setAttribute(TAB_STOPS, stops.join(','));
		else block.removeAttribute(TAB_STOPS);
		if (!block.getAttribute('style')) block.removeAttribute('style');
		const after = block.getAttribute('style');
		const stopsAfter = block.getAttribute(TAB_STOPS);
		if (!wrapped && after === before && stopsAfter === stopsBefore) return;
		indentUndo.push([{ el: block, before, after, wrapped, stops: { before: stopsBefore, after: stopsAfter } }]);
		indentChanged();
	}

	/**
	 * The left indent the RTF writer gives a paragraph from the blocks around it, in px: a pasted
	 * indent's margin, a <div>'s margin, and a quotation's margin plus the half inch every
	 * quotation is indented (rtf-writer's blockquote case).
	 */
	function surroundingIndentPx(block: HTMLElement): number {
		let px = 0;
		for (let a = block.parentElement; a && a !== editorEl; a = a.parentElement) {
			if (a.tagName === 'BLOCKQUOTE') px += marginLeftPx(a) + (isIndentBlockquote(a) ? 0 : INDENT_STEP_PX);
			else if (a.tagName === 'DIV') px += marginLeftPx(a);
		}
		return px;
	}

	/** Take away the paragraph wrapLooseLine made, leaving the loose line as it was. */
	function undoWrap(p: HTMLElement, wrapped: { br: HTMLBRElement | null }): void {
		if (wrapped.br) p.after(wrapped.br);
		p.replaceWith(...Array.from(p.childNodes));
	}

	/**
	 * The caret's distance from the left of the window. A caret between two pieces of text can have
	 * no box of its own, so the character after it, or the one before, stands in.
	 */
	function caretLeft(caret: Range): number | null {
		const own = caret.getClientRects()[0];
		if (own && (own.height > 0 || own.width > 0)) return own.left;
		const node = caret.startContainer;
		if (!(node instanceof Text)) return null;
		const probe = document.createRange();
		if (caret.startOffset < node.length) {
			probe.setStart(node, caret.startOffset);
			probe.setEnd(node, caret.startOffset + 1);
			const r = probe.getClientRects()[0];
			if (r) return r.left;
		}
		if (caret.startOffset > 0) {
			probe.setStart(node, caret.startOffset - 1);
			probe.setEnd(node, caret.startOffset);
			const rects = probe.getClientRects();
			const r = rects[rects.length - 1];
			if (r) return r.right;
		}
		return null;
	}

	// ── Copy format ──
	// The toolbar's Copy format button turns the pointer into a format brush. The first click in
	// the text picks the paragraph to copy from; each click after that gives the clicked paragraph
	// the same alignment and indents. It stays on until Escape, Done, or the button again, so one
	// format can go to as many paragraphs as needed.
	//
	// What is copied is the paragraph's own formatting, the part the RTF writer sends as \q, \li,
	// \ri and \fi: text-align, margin-left, margin-right and text-indent, and with them the tab
	// stop Hang at caret sets (tab-size, data-rtf-tab-stops). Each block takes what the writer
	// sends for it: a heading all of it but the tab stop, and a heading or paragraph in a table
	// cell the alignment and the left indent only. Lists, code blocks and pictures are left alone.
	// Each click is one Undo step.
	interface ParagraphFormat {
		textAlign: string;
		marginLeft: string;
		marginRight: string;
		textIndent: string;
		/** The tab stop that goes with a hanging indent: tab-size on screen, \tx in the RTF. */
		tabSize: string;
		tabStops: string;
	}
	const NO_FORMAT: ParagraphFormat = { textAlign: '', marginLeft: '', marginRight: '', textIndent: '', tabSize: '', tabStops: '' };
	const PAINT_BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6';

	/** 'pick': waiting for the paragraph to copy from. 'apply': each click applies the format. */
	let copyFormat: 'off' | 'pick' | 'apply' = $state('off');
	let copiedFormat: ParagraphFormat = NO_FORMAT;
	let copySource: HTMLElement | null = null;
	/** Where the frame around the paragraph copied from sits, inside the content wrapper. */
	let copySourceBox: { top: number; left: number; width: number; height: number } | null = $state(null);

	function toggleCopyFormat(): void {
		if (copyFormat !== 'off') {
			stopCopyFormat();
			return;
		}
		if (readonly) return;
		selectedImage = null;
		copyFormat = 'pick';
	}

	function stopCopyFormat(): void {
		copyFormat = 'off';
		copiedFormat = NO_FORMAT;
		copySource = null;
		copySourceBox = null;
	}

	function placeCopySourceBox(): void {
		if (!copySource?.isConnected || !contentWrapEl) {
			copySourceBox = null;
			return;
		}
		const wrap = contentWrapEl.getBoundingClientRect();
		const r = copySource.getBoundingClientRect();
		// A hanging first line starts left of the paragraph's own box: frame it too.
		const hang = Math.max(0, -textIndentPx(copySource));
		copySourceBox = { top: r.top - wrap.top, left: r.left - wrap.left - hang, width: r.width + hang, height: r.height };
	}

	function formatOf(el: HTMLElement): ParagraphFormat {
		const align = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
		return {
			textAlign: align === 'left' || align === 'start' ? '' : align,
			marginLeft: el.style.marginLeft,
			marginRight: el.style.marginRight,
			textIndent: el.style.textIndent,
			tabSize: el.style.tabSize,
			tabStops: el.getAttribute(TAB_STOPS) ?? ''
		};
	}

	/**
	 * The paragraph a click landed on: a <p>, a heading, or a <div> that holds text. A click on a
	 * line of loose text lands on the editor itself, so the caret the click placed says which line.
	 */
	function paragraphAt(e: MouseEvent): { block: HTMLElement | null; loose: Node | null } {
		const none = { block: null, loose: null };
		if (!editorEl) return none;
		const target = e.target instanceof Element ? e.target : null;
		if (!target || !editorEl.contains(target)) return none;
		if (target.closest('li, pre, figure')) return none;
		const own = paintable(target);
		if (own !== undefined) return own ? { block: own, loose: null } : none;
		// The click landed on the editor itself, not on a paragraph: loose text, a margin, or the
		// empty space below the text. Only loose text counts. The caret also lands in the nearest
		// paragraph when its margin is clicked, and that paragraph was not what was clicked.
		const anchor = window.getSelection()?.anchorNode ?? null;
		if (!(anchor instanceof Text) || !anchor.data.trim() || !editorEl.contains(anchor)) return none;
		const parent = anchor.parentElement;
		if (!parent || parent.closest('li, pre, figure, blockquote') || paintable(parent) !== undefined) return none;
		return { block: null, loose: anchor };
	}

	/**
	 * The paragraph an element is in that Copy format can read or set: a heading, a <p>, or a
	 * <div> that holds text. null when it is in a block that cannot take one (a <div> holding other
	 * blocks); undefined when it is in no block at all, which is loose text.
	 */
	function paintable(el: Element): HTMLElement | null | undefined {
		if (!editorEl) return undefined;
		const block = el.closest(PAINT_BLOCKS);
		const cell = el.closest('td, th');
		if (!(block instanceof HTMLElement) || block === editorEl || !editorEl.contains(block)) return undefined;
		if (cell && !cell.contains(block)) return undefined;
		return /^H[1-6]$/.test(block.tagName) || isPlainParagraph(block) ? block : null;
	}

	function handleCopyFormatClick(e: MouseEvent): void {
		const { block, loose } = paragraphAt(e);
		if (!block && !loose) return;
		if (copyFormat === 'pick') {
			copiedFormat = block ? formatOf(block) : NO_FORMAT;
			copySource = block;
			copyFormat = 'apply';
			placeCopySourceBox();
			return;
		}
		if (block && block === copySource) return;
		let target = block;
		let wrapped: { br: HTMLBRElement | null } | null = null;
		if (!target && loose) {
			// A line of loose text has no format to take away, and needs a paragraph to carry one.
			if (Object.values(copiedFormat).every((v) => !v)) return;
			const made = wrapLooseLine(loose);
			if (!made) return;
			target = made.p;
			wrapped = { br: made.br };
		}
		if (!target) return;
		const before = wrapped ? null : target.getAttribute('style');
		const stopsBefore = target.getAttribute(TAB_STOPS);
		// What the writer sends decides what a block can take: a paragraph or a heading outside a
		// table cell carries all three indents, and only a paragraph carries tab stops.
		const outsideCell = !target.closest('td, th');
		const whole = outsideCell && isPlainParagraph(target);
		const indents = whole || (outsideCell && /^H[1-6]$/.test(target.tagName));
		// align="center" (Firefox) outranks an empty style, so say left out loud over it.
		target.style.textAlign = copiedFormat.textAlign || (target.hasAttribute('align') ? 'left' : '');
		target.style.marginLeft = copiedFormat.marginLeft;
		if (indents) {
			target.style.marginRight = copiedFormat.marginRight;
			target.style.textIndent = copiedFormat.textIndent;
		}
		if (whole) {
			target.style.tabSize = copiedFormat.tabSize;
			if (copiedFormat.tabStops) target.setAttribute(TAB_STOPS, copiedFormat.tabStops);
			else target.removeAttribute(TAB_STOPS);
		}
		if (!target.getAttribute('style')) target.removeAttribute('style');
		const after = target.getAttribute('style');
		const stopsAfter = target.getAttribute(TAB_STOPS);
		if (!wrapped && after === before && stopsAfter === stopsBefore) return;
		indentUndo.push([{ el: target, before, after, wrapped, stops: { before: stopsBefore, after: stopsAfter } }]);
		indentChanged();
		placeCopySourceBox();
	}

	/** Undo the last Indent or Outdent, if nothing has changed since. */
	function undoIndent(): boolean {
		const step = indentUndo.pop();
		if (!step) return false;
		// Content replaced or edited since (setHTML, an import, a link): the step no longer applies.
		if (step.some(({ el, after }) => !el.isConnected || el.getAttribute('style') !== after)) {
			indentUndo = [];
			return false;
		}
		for (const { el, before, wrapped, stops } of step) {
			if (before === null) el.removeAttribute('style');
			else el.setAttribute('style', before);
			if (stops) {
				if (stops.before === null) el.removeAttribute(TAB_STOPS);
				else el.setAttribute(TAB_STOPS, stops.before);
			}
			if (wrapped) undoWrap(el, wrapped);
		}
		indentChanged();
		return true;
	}

	function indentChanged(): void {
		placeCopySourceBox();
		updateToolbarState();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/**
	 * The blocks Indent moves: each line's paragraph, and a list, a quotation or a picture as a
	 * whole. A line of loose text (typed straight into the editor or a table cell) is first given a
	 * paragraph of its own, so the margin moves that line only. Outdent on a line with no margin
	 * of its own moves the pasted indent around it (isIndentBlockquote) instead. A right or hanging
	 * indent moves paragraphs only (isPlainParagraph), and nothing inside a table cell.
	 */
	function indentTargets(
		range: Range,
		cmd: IndentCommand,
		wrapped: Map<HTMLElement, HTMLBRElement | null>
	): HTMLElement[] {
		if (!editorEl) return [];
		const root = editorEl;
		const found: HTMLElement[] = [];
		const add = (el: HTMLElement | null) => {
			if (el && !found.includes(el)) found.push(el);
		};
		const blockFor = (node: Node): HTMLElement | null => {
			if (node === root || !root.contains(node)) return null;
			const el = node instanceof Element ? node : node.parentElement;
			if (!el) return null;
			const cell = el.closest('td, th');
			const inScope = (b: Element | null | undefined): b is HTMLElement =>
				b instanceof HTMLElement && b !== root && root.contains(b) && (!cell || cell.contains(b));
			const item = el.closest('li');
			const closest = el.closest(INDENT_TARGETS);
			const block = inScope(item) ? item.parentElement : inScope(closest) ? closest : null;
			if (cmd !== 'indent' && cmd !== 'outdent') {
				if (cell) return null;
				if (inScope(block)) return isPlainParagraph(block) ? block : null;
				if (decreases(cmd)) return null;
				const made = wrapLooseLine(node);
				if (made) wrapped.set(made.p, made.br);
				return made?.p ?? null;
			}
			if (cmd === 'outdent' && (!block || marginLeftPx(block) === 0)) {
				for (let a = (block ?? el).parentElement; inScope(a); a = a.parentElement) {
					if (isIndentBlockquote(a) && marginLeftPx(a) > 0) return a;
				}
				return block;
			}
			if (inScope(block)) return block;
			if (cmd === 'outdent') return null;
			const made = wrapLooseLine(node);
			if (made) wrapped.set(made.p, made.br);
			return made?.p ?? null;
		};
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const texts: Text[] = [];
		for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
			if (!n.data.trim() || !range.intersectsNode(n)) continue;
			// A selection that only touches a line's edge (dragged to the start of the next line)
			// does not move that line.
			if (n === range.endContainer && range.endOffset === 0 && !range.collapsed) continue;
			if (n === range.startContainer && range.startOffset === n.length && !range.collapsed) continue;
			texts.push(n);
		}
		if (texts.length === 0) add(blockFor(range.startContainer));
		for (const t of texts) add(blockFor(t));
		return found;
	}

	/**
	 * Put the run of loose text and inline elements around a node into a <p>, and return it with
	 * the <br> that ended the run, which the paragraph replaces.
	 */
	function wrapLooseLine(node: Node): { p: HTMLElement; br: HTMLBRElement | null } | null {
		if (!editorEl || node === editorEl || !editorEl.contains(node)) return null;
		let start: Node = node;
		while (start.parentNode && start.parentNode !== editorEl && !(start.parentNode as Element).matches?.('td, th')) {
			start = start.parentNode;
		}
		const parent = start.parentNode;
		if (!parent || !editorEl.contains(parent)) return null;
		const isBreak = (n: Node | null) =>
			!n || (n instanceof Element && (n.matches(INDENT_TARGETS) || n.matches('br, table, hr')));
		if (isBreak(start)) return null;
		let first: Node = start;
		while (!isBreak(first.previousSibling)) first = first.previousSibling!;
		let last: Node = start;
		while (!isBreak(last.nextSibling)) last = last.nextSibling!;
		const p = document.createElement('p');
		parent.insertBefore(p, first);
		let n: Node | null = first;
		while (n) {
			const next: Node | null = n === last ? null : n.nextSibling;
			p.appendChild(n);
			n = next;
		}
		let br: HTMLBRElement | null = null;
		if (p.nextSibling instanceof HTMLBRElement) {
			br = p.nextSibling;
			br.remove();
		}
		return { p, br };
	}

	// ── Block type ──
	function setBlock(tag: string): void {
		restoreSelection();
		editorEl?.focus();
		document.execCommand('formatBlock', false, tag);
		updateToolbarState();
	}

	// ── Toolbar state ──
	function updateToolbarState(): void {
		// Snapshot the selection so exec/setBlock can restore it even if focus
		// temporarily moved to a toolbar element (e.g. colour picker, select).
		saveSelection();

		formatState = {
			bold: document.queryCommandState('bold'),
			italic: document.queryCommandState('italic'),
			underline: document.queryCommandState('underline'),
			strikeThrough: document.queryCommandState('strikeThrough')
		};

		const block = document.queryCommandValue('formatBlock');
		const normalized = block.replace(/[<>]/g, '').toLowerCase();
		const map: Record<string, string> = { h1: 'h1', h2: 'h2', h3: 'h3', blockquote: 'blockquote', pre: 'pre', p: 'p' };
		currentBlock = map[normalized] || 'p';

		updateCounts();
	}

	function updateCounts(): void {
		if (!editorEl) return;
		const text = editorEl.innerText || '';
		const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
		wordCount = words.length;
		charCount = text.length;
	}

	function fireChange(): void {
		onchange?.({
			html: editorEl?.innerHTML || '',
			text: editorEl?.innerText || '',
			wordCount,
			charCount,
			estimatedRtfBytes: editorEl ? estimateRtfBytes(editorEl) : 0
		});
	}

	// ── Auto-save ──
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function autoSaveNow(): void {
		if (!editorEl || !autosave) return;
		try {
			localStorage.setItem(storageKey, editorEl.innerHTML);
			lastSaved = `Saved ${new Date().toLocaleTimeString()}`;
		} catch (e) {
			// Embedded images can push a document past the localStorage quota. Say
			// so instead of showing a "Saved" that did not happen — onsave still
			// fires so the host app can persist the content itself.
			lastSaved = 'Too large to auto-save in this browser';
		}
		onsave?.({ html: editorEl.innerHTML });
	}

	function scheduleAutoSave(): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(autoSaveNow, 1000);
	}

	// ── Input handler ──
	function handleInput(): void {
		placeCopySourceBox();
		if (pastedOver) {
			tidyPasted(pastedOver);
			pastedOver = null;
		}
		indentUndo = [];
		updateToolbarState();
		// Typing means the user is editing text, not the picture. Dropping the
		// selection here keeps Backspace editing that text instead of deleting a
		// still-selected image somewhere else in the document.
		selectedImage = null;
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	// ── Link modal ──
	function openLinkModal(): void {
		saveSelection();
		linkUrl = '';
		linkText = '';
		linkError = '';
		linkModalOpen = true;
	}

	function applyLink(): void {
		if (!linkUrl) { linkModalOpen = false; return; }
		// Only a web, mail or phone address becomes a link; a javascript: address would
		// run when clicked in the editor and in any viewer of the stored HTML. The dialog
		// stays open and says why, rather than closing as if the link had been added.
		if (!isSafeLinkUrl(linkUrl)) {
			linkError = 'Enter a web address (https://…), an email address (mailto:…) or a phone number (tel:…).';
			return;
		}
		linkError = '';
		// Inserting changes the document outside an input event: earlier indent steps no longer undo.
		indentUndo = [];
		restoreSelection();
		editorEl?.focus();

		if (linkText) {
			const sel = window.getSelection();
			if (sel && sel.rangeCount) {
				const range = sel.getRangeAt(0);
				range.deleteContents();
				const a = document.createElement('a');
				a.href = linkUrl;
				a.textContent = linkText;
				range.insertNode(a);
				range.setStartAfter(a);
				sel.removeAllRanges();
				sel.addRange(range);
			}
		} else {
			document.execCommand('createLink', false, linkUrl);
		}
		linkModalOpen = false;
	}

	// ── Images ──
	function openImageModal(): void {
		saveSelection();
		imageUrl = '';
		imageAlt = '';
		imageCaption = '';
		pendingImageFiles = [];
		imageModalOpen = true;
	}

	function chooseImageFiles(): void {
		imageInputEl?.click();
	}

	function handleImageFilesChosen(e: Event): void {
		const input = e.target as HTMLInputElement;
		pendingImageFiles = Array.from(input.files || []).filter((f) => f.type.startsWith('image/'));
		input.value = '';
	}

	async function applyImage(): Promise<void> {
		const files = pendingImageFiles;
		const url = imageUrl.trim();
		const caption = imageCaption.trim();
		const alt = imageAlt.trim();

		imageModalOpen = false;
		pendingImageFiles = [];

		if (files.length > 0) {
			await insertImageFiles(files, caption, alt);
			return;
		}
		if (!url) return;
		if (!isSafeImageUrl(url)) {
			showError('That image address is not supported');
			return;
		}

		insertingImages = true;
		try {
			const { src, embedded } = await urlToImageSrc(url, imageLimits());
			restoreSelection();
			editorEl?.focus();
			finishInsert(insertFigure(src, alt || caption, caption));
			// It displays either way, but only embedded bytes reach the RTF.
			if (!embedded) {
				showError('That image could not be embedded — it will export as a placeholder');
			}
		} finally {
			insertingImages = false;
		}
	}

	/** Caps applied to a picture as it is inserted. */
	function imageLimits(): { maxEdge: number; maxBytes: number } {
		return { maxEdge: maxImageEdge, maxBytes: maxImageBytes };
	}

	/** Width in px available to an image — the editor's content box. */
	function contentWidth(): number {
		if (!editorEl) return 0;
		const styles = getComputedStyle(editorEl);
		const padding = parseFloat(styles.paddingLeft || '0') + parseFloat(styles.paddingRight || '0');
		return Math.max(0, editorEl.clientWidth - padding);
	}

	/** The direct child of the editor that contains the caret, if any. */
	function caretBlock(): HTMLElement | null {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !editorEl) return null;
		let node: Node | null = sel.getRangeAt(0).startContainer;
		if (!editorEl.contains(node)) return null;
		while (node && node.parentNode !== editorEl) node = node.parentNode;
		return node instanceof HTMLElement ? node : null;
	}

	function isEmptyBlock(el: HTMLElement): boolean {
		if (el.querySelector('img, table, hr')) return false;
		return (el.textContent || '').trim().length === 0;
	}

	function placeCaret(el: HTMLElement, atStart = true): void {
		const range = document.createRange();
		range.selectNodeContents(el);
		range.collapse(atStart);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		savedSelection = range.cloneRange();
	}

	/**
	 * Insert a <figure><img><figcaption> block at the caret. Figures are block
	 * level, so they are placed between top-level blocks rather than inside the
	 * paragraph the caret happens to be in.
	 */
	function insertFigure(
		src: string,
		alt: string,
		caption: string
	): { img: HTMLImageElement; after: HTMLElement } | null {
		if (!editorEl) return null;
		indentUndo = [];

		const figure = document.createElement('figure');
		const img = document.createElement('img');
		img.src = src;
		if (alt) img.alt = alt;
		const figcaption = document.createElement('figcaption');
		if (caption) figcaption.textContent = caption;
		figure.append(img, figcaption);

		const block = caretBlock();
		if (block && isEmptyBlock(block)) block.replaceWith(figure);
		else if (block) block.after(figure);
		else editorEl.appendChild(figure);

		// Guarantee somewhere to keep typing after the image.
		let after = figure.nextElementSibling as HTMLElement | null;
		if (!after || after.tagName === 'FIGURE') {
			const p = document.createElement('p');
			p.appendChild(document.createElement('br'));
			figure.after(p);
			after = p;
		}

		fitImageWhenLoaded(img);
		return { img, after };
	}

	/**
	 * Size a freshly inserted image: the smallest of its natural width, the
	 * editor column and the page cap, never larger. The page cap is what keeps
	 * \picwgoal inside the width of the page the document lands on — a browser
	 * -wide picture would be written as 12in and overflow it. The user can still
	 * enlarge it deliberately with the resize handles.
	 */
	function fitImage(img: HTMLImageElement): void {
		const width = initialDisplayWidth(img.naturalWidth, contentWidth(), maxImageDisplayWidth);
		if (!width) return;
		img.style.width = `${width}px`;
		img.style.height = 'auto';
		overlayRef?.reposition();
	}

	function fitImageWhenLoaded(img: HTMLImageElement): void {
		if (img.complete && img.naturalWidth) {
			fitImage(img);
			return;
		}
		img.addEventListener(
			'load',
			() => {
				fitImage(img);
				updateCounts();
				fireChange();
				if (autosave) scheduleAutoSave();
			},
			{ once: true }
		);
	}

	function finishInsert(inserted: { img: HTMLImageElement; after: HTMLElement } | null): void {
		if (!inserted) return;
		placeCaret(inserted.after);
		selectedImage = inserted.img;
		updateCounts();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/** Insert one figure per file, in the order they were given. */
	async function insertImageFiles(files: File[], caption = '', alt = ''): Promise<void> {
		if (files.length === 0) return;
		insertingImages = true;
		let inserted: { img: HTMLImageElement; after: HTMLElement } | null = null;

		try {
			for (const file of files) {
				try {
					const src = await fileToImageSrc(file, imageLimits());
					restoreSelection();
					editorEl?.focus();
					// A single image takes the description typed in the dialog; a batch
					// gets empty captions the user fills in under each picture.
					const isBatch = files.length > 1;
					inserted = insertFigure(
						src,
						alt || caption || stripExtension(file.name),
						isBatch ? '' : caption
					);
					if (inserted) placeCaret(inserted.after);
				} catch (err) {
					showError((err as Error).message || 'Could not insert the image');
				}
			}
		} finally {
			insertingImages = false;
		}

		finishInsert(inserted);
	}

	function showError(message: string): void {
		importError = message;
		setTimeout(() => (importError = ''), 4000);
	}

	// ── Image selection / editing ──
	function handleContentClick(e: MouseEvent): void {
		if (readonly) return;
		if (copyFormat !== 'off') {
			handleCopyFormatClick(e);
			return;
		}
		const target = e.target as HTMLElement | null;
		selectedImage = target?.tagName === 'IMG' ? (target as HTMLImageElement) : null;
	}

	function selectionInCaption(): boolean {
		const node = window.getSelection()?.anchorNode;
		if (!node) return false;
		const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
		return !!el?.closest('figcaption');
	}

	function removeSelectedImage(): void {
		if (!selectedImage) return;
		const figure = selectedImage.closest('figure');
		const next = (figure ?? selectedImage).nextElementSibling as HTMLElement | null;
		(figure ?? selectedImage).remove();
		selectedImage = null;
		if (next) placeCaret(next);
		updateCounts();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/** Put the caret in the image's description line, creating it if needed. */
	function focusCaption(img: HTMLImageElement): void {
		const figure = img.closest('figure');
		if (!figure) return;
		let caption = figure.querySelector('figcaption');
		if (!caption) {
			caption = document.createElement('figcaption');
			figure.appendChild(caption);
		}
		editorEl?.focus();
		placeCaret(caption as HTMLElement, false);
	}

	function handleImageEdited(): void {
		updateCounts();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	function handleDragOver(e: DragEvent): void {
		if (readonly) return;
		if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
	}

	function handleDrop(e: DragEvent): void {
		if (readonly) return;
		const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
		if (files.length === 0) return;
		e.preventDefault();
		editorEl?.focus();
		placeCaretAtPoint(e.clientX, e.clientY);
		void insertImageFiles(files);
	}

	/** Move the caret under the pointer so a dropped image lands where it was dropped. */
	function placeCaretAtPoint(x: number, y: number): void {
		const doc = document as Document & {
			caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};

		let range: Range | null = null;
		if (typeof doc.caretPositionFromPoint === 'function') {
			const pos = doc.caretPositionFromPoint(x, y);
			if (pos) {
				range = document.createRange();
				range.setStart(pos.offsetNode, pos.offset);
				range.collapse(true);
			}
		} else if (typeof doc.caretRangeFromPoint === 'function') {
			range = doc.caretRangeFromPoint(x, y);
		}

		if (!range || !editorEl?.contains(range.startContainer)) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		savedSelection = range.cloneRange();
	}

	// ── Import RTF ──
	async function handleFileImport(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		importError = '';
		importing = true;

		try {
			const html = await readRtfFile(file, { fontSize });
			if (editorEl) {
				selectedImage = null;
				documentReplaced();
				editorEl.innerHTML = html;
				updateCounts();
				fireChange();
				if (autosave) scheduleAutoSave();
				onimport?.({ html });
			}
		} catch (err) {
			showError((err as Error).message || 'Failed to import RTF file');
		} finally {
			importing = false;
			if (fileInputEl) fileInputEl.value = '';
		}
	}

	// ── Keyboard shortcuts ──
	function handleKeydown(e: KeyboardEvent): void {
		// Escape puts the Copy format brush down, and does nothing else that press.
		if (copyFormat !== 'off' && e.key === 'Escape') {
			e.preventDefault();
			stopCopyFormat();
			return;
		}
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === 'b') { e.preventDefault(); exec('bold'); }
		if (mod && e.key === 'i') { e.preventDefault(); exec('italic'); }
		if (mod && e.key === 'u') { e.preventDefault(); exec('underline'); }
		if (mod && e.key === 'k') { e.preventDefault(); openLinkModal(); }
		if (mod && e.key === 's') { e.preventDefault(); autoSaveNow(); }
		if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && undoIndent()) { e.preventDefault(); return; }
		if (mod && e.key === ']') { e.preventDefault(); indentBlocks('indent'); return; }
		if (mod && e.key === '[') { e.preventDefault(); indentBlocks('outdent'); return; }

		// Moving the caret leaves the picture behind, so drop its selection frame.
		// Deliberately falls through: these keys still have their normal meaning,
		// including Tab inside a <pre> below.
		if (selectedImage && (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Escape' ||
			e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown')) {
			selectedImage = null;
		}

		// Backspace/Delete removes a selected image — but not while the caret is
		// in its description, where those keys must edit text as usual.
		if (selectedImage && !selectionInCaption() && (e.key === 'Backspace' || e.key === 'Delete')) {
			e.preventDefault();
			removeSelectedImage();
			return;
		}

		if (e.key === 'Tab') handleTab(e);
		else tabLeavesEditor = e.key === 'Escape';
	}

	// ── Tab ──
	// Tab types a tab, as in a word processor, so a pathologist can indent a line; before this it
	// left the editor for the next control on the page. Escape, then Tab or Shift+Tab, still moves
	// focus on, so the keyboard is never trapped here. A readonly editor keeps the browser's Tab.
	let tabLeavesEditor = false;

	function handleTab(e: KeyboardEvent): void {
		if (readonly || e.ctrlKey || e.metaKey || e.altKey) return;
		if (tabLeavesEditor) {
			tabLeavesEditor = false;
			return;
		}
		const sel = window.getSelection();
		if (!sel || !sel.anchorNode || !editorEl?.contains(sel.anchorNode)) return;
		e.preventDefault();

		if (sel.anchorNode.parentElement?.closest?.('pre')) {
			if (!e.shiftKey) document.execCommand('insertText', false, '  ');
			return;
		}
		// Several lines selected: Tab and Shift+Tab indent and outdent them all, as a word
		// processor does. Within one line, Tab types a tab.
		if (selectionSpansLines(sel)) {
			indentBlocks(e.shiftKey ? 'outdent' : 'indent');
			return;
		}
		if (!e.shiftKey) {
			insertTab(sel);
			return;
		}
		// Shift+Tab takes one tab off the start of the line the caret is on, wherever the caret is
		// on it, as a word processor outdents.
		if (sel.isCollapsed) removeLeadingTab(sel);
	}

	/**
	 * Type a tab, on the undo stack. Chromium and WebKit wrap it in <span style="white-space:pre">,
	 * which the RTF writer sends as \tab. Firefox types spaces instead, so there the typing is
	 * undone and the same span is inserted, with the caret put after it so the text that follows
	 * is not typed inside it.
	 */
	function insertTab(sel: Selection): void {
		document.execCommand('insertText', false, '\t');
		if (textBeforeCaret(sel).endsWith('\t')) return;
		document.execCommand('undo');
		document.execCommand('insertHTML', false, '<span style="white-space:pre">\t</span>');
		const node = sel.anchorNode;
		const span = (node instanceof Element ? node : node?.parentElement)?.closest('span');
		if (span && span.textContent === '\t' && editorEl?.contains(span)) {
			const after = document.createRange();
			after.setStartAfter(span);
			after.collapse(true);
			sel.removeAllRanges();
			sel.addRange(after);
		}
	}

	function textBeforeCaret(sel: Selection): string {
		if (!editorEl || sel.rangeCount === 0) return '';
		const range = sel.getRangeAt(0).cloneRange();
		range.collapse(true);
		range.setStart(editorEl, 0);
		return range.toString();
	}

	/** Whether a selection runs across more than one paragraph or line. */
	function selectionSpansLines(sel: Selection): boolean {
		if (sel.isCollapsed || sel.rangeCount === 0 || !editorEl) return false;
		const range = sel.getRangeAt(0);
		const blockOf = (n: Node) =>
			(n instanceof Element ? n : n.parentElement)?.closest(LINE_BLOCKS) ?? editorEl;
		if (blockOf(range.startContainer) !== blockOf(range.endContainer)) return true;
		return range.cloneContents().querySelector('br') !== null;
	}

	const LINE_BLOCKS = 'p, div, li, td, th, h1, h2, h3, h4, h5, h6, blockquote';

	/** The first tab of the caret's line, if the line starts with one: its text node and offset. */
	function leadingTab(sel: Selection): { node: Text; offset: number } | null {
		if (!editorEl || !sel.anchorNode) return null;
		const anchorEl = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
		const found = anchorEl?.closest(LINE_BLOCKS);
		const block = found && editorEl.contains(found) && found !== editorEl ? found : editorEl;
		const caret = sel.getRangeAt(0);

		// Walk the block's text and line breaks up to the caret. A <br>, or text in a different
		// block from the text before it, starts a new line.
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
		let lineStart: { node: Text; offset: number } | null = null;
		let lineHasText = false;
		let lastBlock: Element | null = null;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (caret.comparePoint(n, 0) > 0) break;
			if (n.nodeName === 'BR') {
				lineStart = null;
				lineHasText = false;
				continue;
			}
			if (n.nodeType !== Node.TEXT_NODE) continue;
			const textBlock = n.parentElement?.closest(LINE_BLOCKS) ?? block;
			if (textBlock !== lastBlock) {
				lastBlock = textBlock;
				lineStart = null;
				lineHasText = false;
			}
			if (!lineHasText) {
				const text = (n as Text).data;
				if (text.length === 0) continue;
				lineHasText = true;
				lineStart = text[0] === '\t' ? { node: n as Text, offset: 0 } : null;
			}
		}
		return lineStart;
	}

	function removeLeadingTab(sel: Selection): void {
		const tab = leadingTab(sel);
		if (!tab) return;
		const caret = sel.getRangeAt(0).cloneRange();
		const range = document.createRange();
		range.setStart(tab.node, tab.offset);
		range.setEnd(tab.node, tab.offset + 1);
		// Delete through execCommand so Ctrl+Z puts the tab back, then return the caret.
		sel.removeAllRanges();
		sel.addRange(range);
		document.execCommand('delete');
		if (caret.startContainer.isConnected) {
			sel.removeAllRanges();
			sel.addRange(caret);
		}
	}

	function handlePaste(e: ClipboardEvent): void {
		// clipboardData is only valid during the event — pull the files out first.
		const files = Array.from(e.clipboardData?.items || [])
			.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);

		if (files.length > 0 && !readonly) {
			e.preventDefault();
			void insertImageFiles(files);
			return;
		}

		const sel = window.getSelection();
		if (sel?.anchorNode?.parentElement?.closest?.('pre')) {
			e.preventDefault();
			const text = e.clipboardData?.getData('text/plain') || '';
			document.execCommand('insertText', false, text);
			return;
		}
		// The browser pastes next; the input event that follows tidies what came in.
		if (!readonly && editorEl) {
			const snapshot = new Set(editorEl.querySelectorAll('*'));
			pastedOver = snapshot;
			// A paste that inserts nothing (an empty clipboard, a host that cancels it) raises no
			// input event. Left set, the snapshot would make the next keystroke treat the whole
			// document as pasted.
			setTimeout(() => {
				if (pastedOver === snapshot) pastedOver = null;
			}, 0);
		}
	}

	// ── Pasted formatting ──
	// A browser copies a paragraph with its looks written out: Chromium turns the editor's own
	// spacing into "margin: 0px 0px 0.2em 96px" on the copy, and repeats the id. Pasted back, the
	// copy looked the same until the writer or a later edit met those extra values, and two
	// elements shared one id. After a paste, each element that came in loses its id, and loses any
	// margin or first-line indent that changes nothing: one the editor's own style already gives,
	// or one on a piece of text inside a line, where neither has an effect.
	const PASTED_SPACING = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'text-indent'];
	/** The elements in the editor just before a paste; what is not in it came from the paste. */
	let pastedOver: Set<Element> | null = null;

	function tidyPasted(before: Set<Element>): void {
		if (!editorEl) return;
		for (const el of Array.from(editorEl.querySelectorAll<HTMLElement>('*'))) {
			if (before.has(el)) continue;
			el.removeAttribute('id');
			if (!el.getAttribute('style')) continue;
			const inline = !el.matches(`${INDENT_TARGETS}, li, table, thead, tbody, tfoot, tr, td, th, figcaption, hr`);
			for (const prop of PASTED_SPACING) {
				const value = el.style.getPropertyValue(prop);
				if (!value) continue;
				const shown = getComputedStyle(el).getPropertyValue(prop);
				el.style.removeProperty(prop);
				if (!inline && getComputedStyle(el).getPropertyValue(prop) !== shown) el.style.setProperty(prop, value);
			}
			if (!el.getAttribute('style')) el.removeAttribute('style');
		}
		// A picture copied with its text comes in by address (<img src="https://…">). Only picture
		// data held in the document reaches the RTF, so it is fetched and embedded, as the image
		// dialog does for an address typed there.
		const linked = Array.from(editorEl.querySelectorAll('img')).filter(
			(img) => !before.has(img) && !/^data:image\//i.test(img.getAttribute('src') || '')
		);
		if (linked.length > 0) void embedPastedImages(linked);
	}

	/**
	 * Fetch each pasted picture and hold its data in the document. One that cannot be fetched
	 * (the site forbids it, or there is no network) still shows, but leaves in the RTF as an
	 * "[Image: …]" placeholder: the editor says so now, rather than letting it be found downstream.
	 */
	async function embedPastedImages(images: HTMLImageElement[]): Promise<void> {
		let failed = 0;
		let changed = false;
		for (const img of images) {
			const url = img.getAttribute('src') || '';
			if (!isSafeImageUrl(url)) {
				failed++;
				continue;
			}
			const { src, embedded } = await urlToImageSrc(url, imageLimits());
			// It may have been deleted or replaced while it was fetched.
			if (!img.isConnected || img.getAttribute('src') !== url) continue;
			if (embedded) {
				img.setAttribute('src', src);
				changed = true;
			} else {
				failed++;
			}
		}
		if (failed > 0) {
			showError(
				failed === 1
					? 'A pasted image could not be embedded — it will export as a placeholder'
					: `${failed} pasted images could not be embedded — they will export as placeholders`
			);
		}
		if (changed) {
			updateCounts();
			fireChange();
			if (autosave) scheduleAutoSave();
		}
	}

	// ── Lifecycle ──
	onMount(() => {
		if (!editorEl) return;
		if (autosave) {
			try {
				const saved = localStorage.getItem(storageKey);
				if (saved) {
					editorEl.innerHTML = saved;
					updateCounts();
					return;
				}
			} catch (e) {}
		}
		// Always write the initial content prop so the div isn't empty.
		// {#html content} must NOT be used inside the contenteditable div —
		// Svelte would re-inject it on every reactive update, duplicating text.
		editorEl.innerHTML = content || '<p></p>';
		updateCounts();
	});

	// Suppress unused warning for importing state (used in template)
	$effect(() => { void importing; });
</script>

<!-- Hidden file input for RTF import -->
<input
	type="file"
	accept=".rtf,application/rtf,text/rtf"
	class="ink-hidden-input"
	bind:this={fileInputEl}
	onchange={handleFileImport}
/>

<!-- Hidden file input for image insertion (multiple images at once) -->
<input
	type="file"
	accept="image/*"
	multiple
	class="ink-hidden-input"
	bind:this={imageInputEl}
	onchange={handleImageFilesChosen}
/>

<svelte:window
	onkeydown={(e) => {
		if (copyFormat !== 'off' && e.key === 'Escape') stopCopyFormat();
	}}
	onresize={placeCopySourceBox}
/>

<div
	class="ink-editor"
	style:--ink-min-height={minHeight}
	style:--ink-font-family={screenFontFamily}
	style:--ink-font-size="{screenFontSize}pt"
>
	{#if showToolbar && !readonly}
		<Toolbar
			{formatState}
			blockType={currentBlock}
			onexec={exec}
			onblock={setBlock}
			oninsertlink={openLinkModal}
			oninsertimage={openImageModal}
			copyingFormat={copyFormat !== 'off'}
			oncopyformat={toggleCopyFormat}
		/>
	{/if}

	{#if copyFormat !== 'off' && !readonly}
		<div class="ink-copy-format" role="status">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="14" height="6" rx="1.5"/><path d="M17 6h3v5h-9v3"/><rect x="9.5" y="14" width="3" height="7" rx="1"/></svg>
			<span>
				{copyFormat === 'pick'
					? 'Copy format: click the paragraph to copy from.'
					: 'Format copied. Click each paragraph that should get it.'}
			</span>
			<button type="button" class="ink-copy-format-done" onmousedown={(e) => e.preventDefault()} onclick={stopCopyFormat}>
				{copyFormat === 'pick' ? 'Cancel' : 'Done'}
			</button>
			<span class="ink-copy-format-key">or press Esc</span>
		</div>
	{/if}

	<div class="ink-content-wrap" bind:this={contentWrapEl}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="ink-content"
			class:copy-format-pick={copyFormat === 'pick'}
			class:copy-format-apply={copyFormat === 'apply'}
			contenteditable={!readonly}
			spellcheck="true"
			bind:this={editorEl}
			oninput={handleInput}
			onmouseup={updateToolbarState}
			onkeyup={updateToolbarState}
			onkeydown={handleKeydown}
			onmousedown={() => (tabLeavesEditor = false)}
			onblur={() => (tabLeavesEditor = false)}
			onpaste={handlePaste}
			onclick={handleContentClick}
			ondragover={handleDragOver}
			ondrop={handleDrop}
			data-placeholder={placeholder}
		></div>

		{#if copySourceBox}
			<div
				class="ink-copy-format-source"
				style:top="{copySourceBox.top}px"
				style:left="{copySourceBox.left}px"
				style:width="{copySourceBox.width}px"
				style:height="{copySourceBox.height}px"
			></div>
		{/if}

		{#if !readonly}
			<ImageOverlay
				bind:this={overlayRef}
				target={selectedImage}
				bounds={contentWrapEl}
				maxWidth={contentWidth}
				onchange={handleImageEdited}
				onremove={removeSelectedImage}
				oncaption={focusCaption}
			/>
		{/if}
	</div>

	{#if showStatusBar}
		<div class="ink-status-bar">
			<span>{wordCount} word{wordCount !== 1 ? 's' : ''} · {charCount} character{charCount !== 1 ? 's' : ''}</span>
			{#if autosave}
				<span>{lastSaved || 'Auto-saved to browser'}</span>
			{/if}
		</div>
	{/if}
</div>

<!-- Link Modal -->
<Modal title="Insert Link" open={linkModalOpen} onclose={() => (linkModalOpen = false)}>
	<input type="text" placeholder="Link text (leave empty to use selection)" bind:value={linkText} />
	<input
		type="url"
		placeholder="https://example.com"
		bind:value={linkUrl}
		onkeydown={(e) => e.key === 'Enter' && applyLink()}
		aria-invalid={linkError ? 'true' : undefined}
		aria-describedby={linkError ? 'ink-link-error' : undefined}
	/>
	{#if linkError}
		<p class="ink-modal-error" id="ink-link-error" role="alert">{linkError}</p>
	{/if}
	{#snippet actions()}
		<button class="ink-btn-ghost" onclick={() => (linkModalOpen = false)}>Cancel</button>
		<button class="ink-btn-primary" onclick={applyLink}>Insert</button>
	{/snippet}
</Modal>

<!-- Image Modal -->
<Modal title="Insert Image" open={imageModalOpen} onclose={() => (imageModalOpen = false)}>
	<button class="ink-file-pick" onclick={chooseImageFiles}>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
		{pendingImageFiles.length > 0
			? `${pendingImageFiles.length} image${pendingImageFiles.length === 1 ? '' : 's'} selected`
			: 'Choose images from this device'}
	</button>

	{#if pendingImageFiles.length > 0}
		<p class="ink-file-list">{pendingImageFiles.map((f) => f.name).join(', ')}</p>
	{/if}

	{#if pendingImageFiles.length === 0}
		<div class="ink-modal-or"><span>or paste an address</span></div>
		<input
			type="url"
			placeholder="https://example.com/image.jpg"
			bind:value={imageUrl}
			onkeydown={(e) => e.key === 'Enter' && applyImage()}
		/>
	{/if}

	{#if pendingImageFiles.length > 1}
		<p class="ink-modal-hint">Add a description under each image after inserting.</p>
	{:else}
		<input type="text" placeholder="Description shown below the image (optional)" bind:value={imageCaption} />
	{/if}
	<input type="text" placeholder="Alt text for screen readers (optional)" bind:value={imageAlt} />

	{#snippet actions()}
		<button class="ink-btn-ghost" onclick={() => (imageModalOpen = false)}>Cancel</button>
		<button
			class="ink-btn-primary"
			disabled={insertingImages || (pendingImageFiles.length === 0 && !imageUrl.trim())}
			onclick={applyImage}
		>
			{insertingImages ? 'Inserting…' : 'Insert'}
		</button>
	{/snippet}
</Modal>

<!-- Import Error Toast -->
{#if importError}
	<div class="ink-toast-error">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
		{importError}
	</div>
{/if}

<style>
	.ink-hidden-input {
		display: none;
	}

	.ink-editor {
		width: 100%;
	}

	/* Anchors the image selection frame, which lives outside the
	   contenteditable area so it never lands in the exported HTML. */
	.ink-content-wrap {
		position: relative;
	}

	/* ── Content Area ── */
	.ink-content {
		min-height: var(--ink-min-height, 40vh);
		padding: 48px 56px;
		background: white;
		border: 1px solid var(--border, #e5e2dc);
		border-radius: var(--radius, 8px);
		box-shadow: var(--shadow-md, 0 4px 12px rgba(44, 37, 32, 0.08));
		outline: none;
		font-family: var(--ink-font-family, Arial, sans-serif);
		font-size: var(--ink-font-size, 12pt);
		line-height: 1.75;
		color: var(--text, #2c2520);
		caret-color: var(--accent, #d4622b);
		transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.ink-content:focus {
		border-color: var(--border-active, #c4b5a0);
	}

	/* ── Copy format ── */
	/* The pointer says which step it is: a crosshair to pick the paragraph to copy from, then a
	   brush that paints the format on. The paragraph under the pointer lights up, so it is clear
	   what a click will act on. None of this is in the content, so none of it is exported. */
	.ink-content.copy-format-pick,
	.ink-content.copy-format-pick :global(*) {
		cursor: crosshair !important;
	}

	.ink-content.copy-format-apply,
	.ink-content.copy-format-apply :global(*) {
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='white' stroke='%231a1714' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='14' height='6' rx='1.5'/%3E%3Cpath d='M17 6h3v5h-9v3' fill='none'/%3E%3Crect x='9.5' y='14' width='3' height='7' rx='1'/%3E%3C/svg%3E")
				4 4,
			copy !important;
	}

	/* A <div> line counts as a paragraph (isPlainParagraph) unless it holds other blocks. */
	.ink-content.copy-format-pick :global(:is(p, h1, h2, h3, h4, h5, h6, div:not(:has(p, div, h1, h2, h3, h4, h5, h6, pre, ul, ol, blockquote, figure, table, hr))):hover),
	.ink-content.copy-format-apply :global(:is(p, h1, h2, h3, h4, h5, h6, div:not(:has(p, div, h1, h2, h3, h4, h5, h6, pre, ul, ol, blockquote, figure, table, hr))):hover) {
		background: var(--accent-soft, #ede9fe);
		border-radius: 3px;
	}

	.ink-copy-format {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: -8px 0 12px;
		padding: 8px 12px;
		border: 1px solid var(--accent, #6e56cf);
		border-radius: var(--radius-sm, 5px);
		background: var(--accent-soft, #ede9fe);
		color: var(--text, #2c2520);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
	}

	.ink-copy-format svg {
		flex-shrink: 0;
		color: var(--accent, #6e56cf);
	}

	.ink-copy-format-done {
		margin-left: auto;
		padding: 4px 12px;
		border: 1px solid var(--accent, #6e56cf);
		border-radius: var(--radius-sm, 5px);
		background: white;
		color: var(--accent, #6e56cf);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.ink-copy-format-done:hover {
		background: var(--accent, #6e56cf);
		color: white;
	}

	.ink-copy-format-key {
		color: var(--text-muted, #8a7e72);
		font-size: 12px;
	}

	.ink-copy-format-source {
		position: absolute;
		box-sizing: border-box;
		border: 1.5px dashed var(--accent, #6e56cf);
		border-radius: 3px;
		pointer-events: none;
	}

	/* Placeholder */
	.ink-content:empty::before {
		content: attr(data-placeholder);
		color: var(--text-muted, #8a7e72);
		opacity: 0.5;
		pointer-events: none;
	}

	/* ── Typography inside editor ── */
	/* Headings use the document font and keep the same ratio to the body text
	   as the RTF writer gives them, so the screen matches the RTF. */
	.ink-content :global(h1) {
		font-size: 2em;
		line-height: 1.2;
		color: var(--ink, #1a1714);
		margin-bottom: 16px;
		letter-spacing: -0.5px;
	}

	.ink-content :global(h2) {
		font-size: 1.5em;
		line-height: 1.3;
		color: var(--ink, #1a1714);
		margin-bottom: 12px;
		margin-top: 32px;
	}

	.ink-content :global(h3) {
		font-size: calc(7em / 6);
		font-weight: 600;
		line-height: 1.4;
		color: var(--ink, #1a1714);
		margin-bottom: 8px;
		margin-top: 24px;
	}

	/* A line the browser made as a <div> (after a paste, or Enter in loose text) is a paragraph
	   like any other, and is written to RTF the same way: it gets the same spacing. */
	.ink-content :global(p),
	.ink-content :global(div) {
		margin: 0 0 0.2em;
	}

	.ink-content :global(blockquote) {
		border-left: 3px solid var(--accent, #d4622b);
		padding: 8px 20px;
		margin: 16px 0;
		color: var(--text-muted, #8a7e72);
		font-style: italic;
		background: var(--accent-soft, #fdf0e9);
		border-radius: 0 var(--radius-sm, 5px) var(--radius-sm, 5px) 0;
	}

	/* The indent Chromium, WebKit and Gmail paste (border: none) is an indent, not a quotation:
	   the RTF writes it plain, so it shows plain here too. */
	.ink-content :global(blockquote[style*='border: none']),
	.ink-content :global(blockquote[style*='border:none']),
	.ink-content :global(blockquote[style*='border-style: none']),
	.ink-content :global(blockquote[style*='border-left: none']) {
		font-style: normal;
		color: inherit;
		background: none;
		border-radius: 0;
	}

	.ink-content :global(pre) {
		background: var(--ink, #1a1714);
		color: #e8e2da;
		padding: 20px 24px;
		border-radius: var(--radius, 8px);
		/* Same font and ratio to the body as the RTF writes code blocks in. */
		font-family: 'Courier New', monospace;
		font-size: calc(5em / 6);
		line-height: 1.6;
		margin: 16px 0;
		overflow-x: auto;
	}

	.ink-content :global(code) {
		font-family: 'Courier New', monospace;
		font-size: 1em;
		background: var(--surface, #f2f0ec);
		padding: 2px 6px;
		border-radius: 3px;
		color: var(--accent, #d4622b);
	}

	.ink-content :global(pre code) {
		background: none;
		padding: 0;
		color: inherit;
	}

	.ink-content :global(ul),
	.ink-content :global(ol) {
		padding-left: 24px;
		margin-bottom: 12px;
	}

	.ink-content :global(li) {
		margin-bottom: 4px;
	}

	.ink-content :global(a) {
		color: var(--accent, #d4622b);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.ink-content :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius, 8px);
		margin: 16px 0;
	}

	/* ── Figures (image + description) ── */
	.ink-content :global(figure) {
		margin: 20px 0;
	}

	.ink-content :global(figure img) {
		margin: 0;
		vertical-align: bottom;
		cursor: pointer;
	}

	.ink-content :global(figcaption) {
		margin-top: 8px;
		/* Body size, as the RTF writes captions. */
		font-size: 1em;
		line-height: 1.5;
		font-style: italic;
		color: var(--text-muted, #8a7e72);
	}

	.ink-content :global(figcaption:empty)::before {
		content: 'Add a description…';
		opacity: 0.55;
	}

	.ink-content :global(hr) {
		border: none;
		height: 1px;
		background: var(--border, #e5e2dc);
		margin: 32px 0;
	}

	/* A page break read from RTF (\page): a dashed rule, written back as \page. */
	.ink-content :global(hr[style*='break-after']) {
		height: 0;
		background: none;
		border-top: 1px dashed var(--text-muted, #8a7e72);
	}

	/* ── Status Bar ── */
	.ink-status-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 0;
		font-size: 12px;
		color: var(--text-muted, #8a7e72);
		letter-spacing: 0.2px;
	}

	.ink-status-bar span {
		opacity: 0.7;
	}

	/* ── Buttons (for modals) ── */
	:global(.ink-btn-primary) {
		background: var(--accent, #d4622b);
		border: none;
		padding: 8px 18px;
		border-radius: var(--radius-sm, 5px);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: white;
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ink-btn-primary:hover) {
		background: var(--accent-hover, #be5524);
	}

	:global(.ink-btn-primary:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Image dialog ── */
	.ink-file-pick {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 14px;
		margin-bottom: 12px;
		border: 1px dashed var(--border-active, #c4b5a0);
		border-radius: var(--radius-sm, 5px);
		background: var(--surface, #f2f0ec);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text, #2c2520);
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.ink-file-pick:hover {
		border-color: var(--accent, #d4622b);
		color: var(--accent, #d4622b);
	}

	.ink-file-list {
		margin: -6px 0 12px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-muted, #8a7e72);
		word-break: break-word;
	}

	.ink-modal-hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--text-muted, #8a7e72);
	}

	.ink-modal-error {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--danger, #b42318);
	}

	.ink-modal-or {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-muted, #8a7e72);
	}

	.ink-modal-or::before,
	.ink-modal-or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border, #e5e2dc);
	}

	:global(.ink-btn-ghost) {
		background: none;
		border: 1px solid var(--border, #e5e2dc);
		padding: 8px 16px;
		border-radius: var(--radius-sm, 5px);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted, #8a7e72);
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ink-btn-ghost:hover) {
		border-color: var(--border-active, #c4b5a0);
		color: var(--text, #2c2520);
		background: var(--surface, #f2f0ec);
	}

	/* ── Error Toast ── */
	.ink-toast-error {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		background: #d32f2f;
		color: white;
		padding: 10px 20px;
		border-radius: var(--radius, 8px);
		font-size: 13px;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 8px;
		box-shadow: var(--shadow-lg, 0 8px 30px rgba(44, 37, 32, 0.12));
		z-index: 300;
		animation: inkToastIn 0.25s ease-out;
	}

	.ink-toast-error svg {
		flex-shrink: 0;
	}

	@keyframes inkToastIn {
		from { opacity: 0; transform: translateX(-50%) translateY(12px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	/* ── Responsive ── */
	@media (max-width: 700px) {
		.ink-content {
			padding: 28px 24px;
		}
	}
</style>
