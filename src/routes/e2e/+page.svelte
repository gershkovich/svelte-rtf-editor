<script lang="ts">
	// The page the browser tests (e2e/) drive: one editor and one viewer, set up from the
	// address, with the library on `window` so a test can call it in the browser.
	import { onMount } from 'svelte';
	import * as lib from '../../lib/index.js';
	import { InkEditor, RtfViewer } from '../../lib/index.js';

	type Harness = { ed?: unknown; lib?: typeof lib; setViewer?: (rtf: string) => void; changes?: number };

	let ed: ReturnType<typeof InkEditor> | null = $state(null);
	let rtf = $state('');
	let params = $state<{ autosave: boolean; content?: string; key?: string; onchange: boolean; keepAttributes: string[]; keepClasses: string[] } | null>(null);

	onMount(() => {
		const q = new URLSearchParams(location.search);
		params = {
			autosave: q.get('autosave') === '1',
			content: q.get('content') ?? undefined,
			key: q.get('key') ?? undefined,
			onchange: q.get('onchange') === '1',
			keepAttributes: (q.get('keepAttributes') ?? '').split(',').filter(Boolean),
			keepClasses: (q.get('keepClasses') ?? '').split(',').filter(Boolean)
		};
		const w = window as unknown as Harness;
		w.lib = lib;
		w.changes = 0;
		w.setViewer = (value: string) => (rtf = value);
	});

	$effect(() => {
		(window as unknown as Harness).ed = ed;
	});
</script>

{#if params}
	<InkEditor
		bind:this={ed}
		autosave={params.autosave}
		content={params.content}
		storageKey={params.key}
		keepAttributes={params.keepAttributes}
		keepClasses={params.keepClasses}
		onchange={params.onchange ? () => { (window as unknown as Harness).changes!++; } : undefined}
	/>
	<div id="viewer"><RtfViewer content={rtf} /></div>
{/if}
