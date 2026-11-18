<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/**
		 * Whether the button is on, for one that is on or off (Bold). Left out for one that does
		 * something once (Undo, Insert image): that one is not announced as pressed or not.
		 */
		active?: boolean;
		title?: string;
		onclick?: () => void;
		children: Snippet;
	}

	let { active, title = '', onclick, children }: Props = $props();
</script>

<button
	class="tb"
	class:active={active === true}
	{title}
	aria-label={title || undefined}
	aria-pressed={active}
	onclick={onclick}
	onmousedown={(e) => e.preventDefault()}
	type="button"
>
	{@render children()}
</button>

<style>
	.tb {
		width: 34px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--text-muted);
		transition: all var(--transition);
		position: relative;
	}

	.tb:hover {
		background: var(--surface);
		color: var(--text);
	}

	.tb.active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.tb :global(svg) {
		width: 18px;
		height: 18px;
	}

	.tb:hover::after {
		content: attr(title);
		position: absolute;
		bottom: -30px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--ink);
		color: #e8e2da;
		font-size: 11px;
		padding: 4px 8px;
		border-radius: 4px;
		white-space: nowrap;
		pointer-events: none;
		z-index: 10;
	}
</style>
