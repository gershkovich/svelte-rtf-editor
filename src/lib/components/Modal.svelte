<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		title?: string;
		onclose?: () => void;
		children: Snippet;
		actions?: Snippet;
	}

	let { open = false, title = '', onclose, children, actions }: Props = $props();

	let dialogEl: HTMLDivElement | null = $state(null);
	const titleId = `ink-modal-title-${Math.random().toString(36).slice(2, 10)}`;

	const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

	function focusable(): HTMLElement[] {
		return dialogEl ? Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
	}

	// An open dialog takes the keyboard. Left where it was, in the document behind the dialog,
	// what was typed for the dialog (a link's address) replaced the selected text instead.
	// Closed with Escape or Cancel, the keyboard goes back to where it was.
	$effect(() => {
		if (!open || !dialogEl) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const first = dialogEl.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? dialogEl;
		first.focus();
		const dialog = dialogEl;
		return () => {
			// Only if the keyboard is still the dialog's to hand back: whoever closed the dialog
			// may have put it somewhere already (Insert puts it in the document).
			const active = document.activeElement;
			if (previous?.isConnected && (!active || active === document.body || dialog.contains(active))) previous.focus();
		};
	});

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose?.();
			return;
		}
		// Tab goes round the dialog, not on into the page behind it.
		if (e.key !== 'Tab' || !dialogEl) return;
		const items = focusable();
		if (items.length === 0) {
			e.preventDefault();
			return;
		}
		const active = document.activeElement;
		const first = items[0];
		const last = items[items.length - 1];
		if (!dialogEl.contains(active)) {
			e.preventDefault();
			first.focus();
		} else if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={handleOverlayClick}>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1" bind:this={dialogEl}>
			<h3 id={titleId}>{title}</h3>
			{@render children()}
			{#if actions}
				<div class="modal-actions">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(44, 37, 32, 0.3);
		backdrop-filter: blur(4px);
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: fadeOverlay 0.15s ease-out;
	}

	@keyframes fadeOverlay {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal {
		background: white;
		border-radius: var(--radius);
		padding: 28px;
		width: 420px;
		max-width: 90vw;
		box-shadow: var(--shadow-lg);
		animation: slideUp 0.2s ease-out;
	}

	@keyframes slideUp {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.modal:focus {
		outline: none;
	}

	.modal h3 {
		font-family: 'Instrument Serif', serif;
		font-size: 22px;
		margin-bottom: 16px;
		color: var(--ink);
	}

	.modal :global(input[type='text']),
	.modal :global(input[type='url']) {
		width: 100%;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: 'DM Sans', sans-serif;
		font-size: 14px;
		margin-bottom: 12px;
		outline: none;
		transition: border-color var(--transition);
	}

	.modal :global(input:focus) {
		border-color: var(--accent);
	}

	.modal-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 8px;
	}
</style>
