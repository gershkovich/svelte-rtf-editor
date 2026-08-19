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
	import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
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
		onchange,
		onsave,
		onimport
	}: Props = $props();

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
		return htmlToRtf(editorEl);
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
		return htmlToRtf(editorEl).length;
	}

	export function clear(): void {
		if (editorEl) {
			selectedImage = null;
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
				const rtf = htmlToRtf(editorEl);
				downloadFile('document.rtf', rtf, 'application/rtf');
				break;
			}
		}
	}

	export function importRtf(): void {
		fileInputEl?.click();
	}

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
		document.execCommand(cmd, false, value ?? undefined);
		updateToolbarState();
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
		linkModalOpen = true;
	}

	function applyLink(): void {
		if (!linkUrl) { linkModalOpen = false; return; }
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
			const html = await readRtfFile(file);
			if (editorEl) {
				selectedImage = null;
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
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === 'b') { e.preventDefault(); exec('bold'); }
		if (mod && e.key === 'i') { e.preventDefault(); exec('italic'); }
		if (mod && e.key === 'u') { e.preventDefault(); exec('underline'); }
		if (mod && e.key === 'k') { e.preventDefault(); openLinkModal(); }
		if (mod && e.key === 's') { e.preventDefault(); autoSaveNow(); }

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

		if (e.key === 'Tab') {
			const sel = window.getSelection();
			if (sel?.anchorNode?.parentElement?.closest?.('pre')) {
				e.preventDefault();
				document.execCommand('insertHTML', false, '  ');
			}
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

<div class="ink-editor" style="--ink-min-height: {minHeight};">
	{#if showToolbar && !readonly}
		<Toolbar
			{formatState}
			blockType={currentBlock}
			onexec={exec}
			onblock={setBlock}
			oninsertlink={openLinkModal}
			oninsertimage={openImageModal}
		/>
	{/if}

	<div class="ink-content-wrap" bind:this={contentWrapEl}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="ink-content"
			contenteditable={!readonly}
			spellcheck="true"
			bind:this={editorEl}
			oninput={handleInput}
			onmouseup={updateToolbarState}
			onkeyup={updateToolbarState}
			onkeydown={handleKeydown}
			onpaste={handlePaste}
			onclick={handleContentClick}
			ondragover={handleDragOver}
			ondrop={handleDrop}
			data-placeholder={placeholder}
		></div>

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
	/>
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
		font-family: 'DM Sans', sans-serif;
		font-size: 16px;
		line-height: 1.75;
		color: var(--text, #2c2520);
		caret-color: var(--accent, #d4622b);
		transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.ink-content:focus {
		border-color: var(--border-active, #c4b5a0);
	}

	/* Placeholder */
	.ink-content:empty::before {
		content: attr(data-placeholder);
		color: var(--text-muted, #8a7e72);
		opacity: 0.5;
		pointer-events: none;
	}

	/* ── Typography inside editor ── */
	.ink-content :global(h1) {
		font-family: 'Instrument Serif', serif;
		font-size: 38px;
		line-height: 1.2;
		color: var(--ink, #1a1714);
		margin-bottom: 16px;
		letter-spacing: -0.5px;
	}

	.ink-content :global(h2) {
		font-family: 'Instrument Serif', serif;
		font-size: 28px;
		line-height: 1.3;
		color: var(--ink, #1a1714);
		margin-bottom: 12px;
		margin-top: 32px;
	}

	.ink-content :global(h3) {
		font-family: 'DM Sans', sans-serif;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.4;
		color: var(--ink, #1a1714);
		margin-bottom: 8px;
		margin-top: 24px;
	}

	.ink-content :global(p) {
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

	.ink-content :global(pre) {
		background: var(--ink, #1a1714);
		color: #e8e2da;
		padding: 20px 24px;
		border-radius: var(--radius, 8px);
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		line-height: 1.6;
		margin: 16px 0;
		overflow-x: auto;
	}

	.ink-content :global(code) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
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
		font-size: 13px;
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
		.ink-content :global(h1) {
			font-size: 28px;
		}
		.ink-content :global(h2) {
			font-size: 22px;
		}
	}
</style>
