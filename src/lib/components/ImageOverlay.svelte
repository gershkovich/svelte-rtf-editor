<script lang="ts">
	/**
	 * ImageOverlay — selection frame for an image inside the editor.
	 *
	 * Renders outside the contenteditable area (so it never ends up in the
	 * exported HTML) and is absolutely positioned over the target image by
	 * `bounds`, which must be a positioned ancestor of the editing surface.
	 *
	 * Provides drag-to-resize corner handles plus a small toolbar for
	 * placement (left / centre / right), width presets, caption editing and
	 * deletion.
	 */

	interface Props {
		/** Image currently selected in the editor, or null when nothing is selected. */
		target?: HTMLImageElement | null;
		/** Positioned element the overlay coordinates are relative to. */
		bounds?: HTMLElement | null;
		/** Widest the image may become — the editor's content box width in px. */
		maxWidth?: () => number;
		onchange?: () => void;
		onremove?: () => void;
		oncaption?: (img: HTMLImageElement) => void;
	}

	let { target = null, bounds = null, maxWidth, onchange, onremove, oncaption }: Props = $props();

	const MIN_WIDTH = 40;
	const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;

	let frame = $state({ left: 0, top: 0, width: 0, height: 0 });
	let visible = $state(false);
	let dragging = $state(false);
	let sizeLabel = $state('');

	/** Recompute the frame position — call after anything that reflows content. */
	export function reposition(): void {
		if (!target || !bounds || !target.isConnected) {
			visible = false;
			return;
		}
		const t = target.getBoundingClientRect();
		const b = bounds.getBoundingClientRect();
		frame = { left: t.left - b.left, top: t.top - b.top, width: t.width, height: t.height };
		visible = t.width > 0 && t.height > 0;
	}

	$effect(() => {
		// Re-read `target` so the effect re-runs whenever the selection changes.
		void target;
		reposition();
	});

	function limit(): number {
		const max = maxWidth?.() ?? 0;
		return max > MIN_WIDTH ? max : Number.POSITIVE_INFINITY;
	}

	function applyWidth(px: number): void {
		if (!target) return;
		const width = Math.round(Math.min(Math.max(px, MIN_WIDTH), limit()));
		// The width attribute would fight the style rule — the style is the
		// single source of truth that both the RTF writer and CSS read.
		target.removeAttribute('width');
		target.removeAttribute('height');
		target.style.width = `${width}px`;
		target.style.height = 'auto';
		reposition();
	}

	function startResize(e: PointerEvent, corner: string): void {
		if (!target) return;
		e.preventDefault();
		e.stopPropagation();

		const rect = target.getBoundingClientRect();
		const startX = e.clientX;
		const startWidth = rect.width;
		const ratio = rect.width > 0 ? rect.height / rect.width : 1;
		const handle = e.currentTarget as HTMLElement;

		dragging = true;
		sizeLabel = `${Math.round(startWidth)} × ${Math.round(rect.height)}`;
		handle.setPointerCapture?.(e.pointerId);

		const onMove = (ev: PointerEvent) => {
			// West-side handles grow the image as the pointer moves left.
			const dx = corner.includes('w') ? startX - ev.clientX : ev.clientX - startX;
			applyWidth(startWidth + dx);
			const w = target ? target.getBoundingClientRect().width : 0;
			sizeLabel = `${Math.round(w)} × ${Math.round(w * ratio)}`;
		};

		const onUp = (ev: PointerEvent) => {
			handle.releasePointerCapture?.(ev.pointerId);
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			handle.removeEventListener('pointercancel', onUp);
			dragging = false;
			onchange?.();
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
		handle.addEventListener('pointercancel', onUp);
	}

	function align(value: 'left' | 'center' | 'right'): void {
		if (!target) return;
		const block = target.closest('figure') ?? target.parentElement;
		if (!block) return;
		if (value === 'left') block.removeAttribute('style');
		else (block as HTMLElement).style.textAlign = value;
		reposition();
		onchange?.();
	}

	function currentAlign(): string {
		const block = target?.closest('figure') ?? target?.parentElement;
		return (block as HTMLElement | null)?.style?.textAlign || 'left';
	}

	function scaleTo(percent: number): void {
		const max = maxWidth?.() ?? 0;
		if (!max) return;
		applyWidth((max * percent) / 100);
		onchange?.();
	}
</script>

<svelte:window onresize={reposition} onscroll={reposition} />

{#if visible && target}
	<div
		class="ink-img-frame"
		class:dragging
		style="left:{frame.left}px;top:{frame.top}px;width:{frame.width}px;height:{frame.height}px"
	>
		<div class="ink-img-tools">
			<button
				type="button"
				title="Align left"
				class:active={currentAlign() === 'left'}
				onclick={() => align('left')}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
			</button>
			<button
				type="button"
				title="Align center"
				class:active={currentAlign() === 'center'}
				onclick={() => align('center')}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
			</button>
			<button
				type="button"
				title="Align right"
				class:active={currentAlign() === 'right'}
				onclick={() => align('right')}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
			</button>

			<span class="ink-img-sep"></span>

			<button type="button" title="Quarter width" onclick={() => scaleTo(25)}>25%</button>
			<button type="button" title="Half width" onclick={() => scaleTo(50)}>50%</button>
			<button type="button" title="Full width" onclick={() => scaleTo(100)}>100%</button>

			<span class="ink-img-sep"></span>

			<button type="button" title="Edit description" onclick={() => target && oncaption?.(target)}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h16v2"/><line x1="9" y1="19" x2="15" y2="19"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
			</button>
			<button type="button" class="danger" title="Remove image" onclick={() => onremove?.()}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
			</button>
		</div>

		{#each CORNERS as corner}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="ink-img-handle {corner}"
				onpointerdown={(e) => startResize(e, corner)}
			></span>
		{/each}

		{#if dragging}
			<span class="ink-img-size">{sizeLabel}</span>
		{/if}
	</div>
{/if}

<style>
	.ink-img-frame {
		position: absolute;
		box-sizing: border-box;
		border: 1.5px solid var(--accent, #d4622b);
		border-radius: 2px;
		/* Clicks fall through to the image/text underneath; only the handles
		   and the toolbar are interactive. */
		pointer-events: none;
		z-index: 20;
	}

	.ink-img-handle {
		position: absolute;
		width: 11px;
		height: 11px;
		background: white;
		border: 1.5px solid var(--accent, #d4622b);
		border-radius: 2px;
		pointer-events: auto;
		touch-action: none;
	}

	.ink-img-handle.nw { top: -6px; left: -6px; cursor: nwse-resize; }
	.ink-img-handle.ne { top: -6px; right: -6px; cursor: nesw-resize; }
	.ink-img-handle.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
	.ink-img-handle.se { bottom: -6px; right: -6px; cursor: nwse-resize; }

	.ink-img-tools {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		background: white;
		border: 1px solid var(--border, #e5e2dc);
		border-radius: var(--radius-sm, 5px);
		box-shadow: var(--shadow-md, 0 4px 12px rgba(44, 37, 32, 0.12));
		pointer-events: auto;
		white-space: nowrap;
	}

	.dragging .ink-img-tools {
		opacity: 0;
	}

	.ink-img-tools button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 26px;
		height: 26px;
		padding: 0 5px;
		border: none;
		background: none;
		border-radius: 4px;
		color: var(--text-muted, #8a7e72);
		font-family: 'DM Sans', sans-serif;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.ink-img-tools button:hover {
		background: var(--surface, #f2f0ec);
		color: var(--text, #2c2520);
	}

	.ink-img-tools button.active {
		background: var(--accent-soft, #fdf0e9);
		color: var(--accent, #d4622b);
	}

	.ink-img-tools button.danger:hover {
		background: #fdecea;
		color: #d32f2f;
	}

	.ink-img-tools svg {
		width: 14px;
		height: 14px;
	}

	.ink-img-sep {
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--border, #e5e2dc);
	}

	.ink-img-size {
		position: absolute;
		bottom: 6px;
		right: 6px;
		padding: 2px 7px;
		border-radius: 3px;
		background: rgba(26, 23, 20, 0.78);
		color: white;
		font-family: 'DM Sans', sans-serif;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
</style>
