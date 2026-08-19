<script lang="ts">
	import { rtfToHtml } from '$lib/rtf-parser.js';
	import { htmlToRtf } from '$lib/rtf-writer.js';
	import { InkEditor } from '$lib/index.js';
	import patientOrganWeights3 from '../../test-files/patient_organ_weights3.rtf?raw';

	// ── Editor section ────────────────────────────────────────────────────────
	let editorRef: { getRTF: () => string; importRtf: () => void } | null = $state(null);
	let editorCopied = $state(false);

	async function copyEditorRtf() {
		if (!editorRef) return;
		await navigator.clipboard.writeText(editorRef.getRTF());
		editorCopied = true;
		setTimeout(() => (editorCopied = false), 1500);
	}

	// ── Payload measurement ───────────────────────────────────────────────────
	// What an embedded picture actually costs: RTF stores it as hex, two
	// characters per byte, and the whole document has to fit the transport
	// (an HL7 OBX-5 field, in our case).

	interface ImageStat {
		n: number;
		format: string;
		pixels: string;
		displayed: string;
		onPage: string;
		bytes: number;
	}

	let imageStats: ImageStat[] = $state([]);
	let rtfChars = $state(0);
	let measured = $state(false);

	/** Decoded byte length of a base64 data URL. */
	function base64Bytes(dataUrl: string): number {
		const comma = dataUrl.indexOf(',');
		if (comma < 0) return 0;
		const body = dataUrl.slice(comma + 1);
		const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
		return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
	}

	function measureImages() {
		if (!editorRef) return;
		// Measure the live images so naturalWidth/Height are already resolved.
		const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.ink-content img'));
		imageStats = imgs.map((img, i) => {
			const src = img.getAttribute('src') || '';
			const match = src.match(/^data:image\/([a-z+]+);base64,/i);
			// \picwgoal is twips: px × 15. A Letter page with 1in margins has 6.5in
			// of text width, so anything past that overflows the page it lands on.
			const px = parseFloat(img.style.width) || img.naturalWidth || 0;
			const inches = (px * 15) / 1440;
			return {
				n: i + 1,
				format: match ? match[1].toUpperCase() : 'not embedded',
				pixels: `${img.naturalWidth || '?'} × ${img.naturalHeight || '?'}`,
				displayed: img.style.width || 'auto',
				onPage: inches ? `${inches.toFixed(1)}in${inches > 6.5 ? ' ⚠' : ''}` : '—',
				bytes: base64Bytes(src)
			};
		});
		rtfChars = editorRef.getRTF().length;
		measured = true;
	}

	const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
	const totalImageBytes = $derived(imageStats.reduce((sum, s) => sum + s.bytes, 0));

	// ── Test cases ────────────────────────────────────────────────────────────
	const cases: { label: string; rtf: string }[] = [
		{
			label: 'Basic formatting',
			rtf: String.raw`{\rtf1\ansi\deff0 {\fonttbl{\f0 Times New Roman;}}Plain, \b bold\b0 , \i italic\i0 , \ul underline\ulnone .}`
		},
		{
			label: 'Paragraphs',
			rtf: String.raw`{\rtf1\ansi First paragraph.\par Second paragraph.\par\par After blank line.}`
		},
		{
			label: 'Colors',
			rtf: String.raw`{\rtf1\ansi\deff0 {\colortbl;\red255\green0\blue0;\red0\green128\blue0;\red0\green0\blue255;}Normal, \cf1 red\cf0 , \cf2 green\cf0 , \cf3 blue\cf0 .}`
		},
		{
			label: 'Patient organ weights (alignment, color, unicode)',
			rtf: patientOrganWeights3
		},
		// ── Bug reproductions ──────────────────────────────────────────────────
		// Add entries here to visually inspect failing RTF.
		{
			label: 'Bug: blank lines after bullet sections dropped',
			rtf: String.raw`{\rtf1\ansi\deff0 {\fonttbl {\f0 Arial;}}
{\b A. SECTION ONE:}\par \bullet First item.\line \bullet Second item.\line \bullet Third item.\par \par {\b B. SECTION TWO:}\par \bullet Only item here.\par \par {\b C. SECTION THREE:}\par \bullet Only item here.\par \par {\b NOTES:}\par Some additional commentary goes here.\par }`
		},
	];

	function parse(rtfString: string): string {
		try {
			return rtfToHtml(rtfString);
		} catch (e) {
			return `<pre style="color:red">${e}</pre>`;
		}
	}

	let copied = $state<string | null>(null);

	async function copySource(label: string, rtfString: string) {
		await navigator.clipboard.writeText(rtfString);
		copied = label + ':source';
		setTimeout(() => (copied = null), 1500);
	}

	async function copyRoundtrip(label: string, rtfString: string) {
		const html = parse(rtfString);
		const container = document.createElement('div');
		container.innerHTML = html;
		const rtf = htmlToRtf(container);
		await navigator.clipboard.writeText(rtf);
		copied = label + ':roundtrip';
		setTimeout(() => (copied = null), 1500);
	}
</script>

<style>
	h1 { padding: 1rem; margin: 0; font-size: 1.2rem; background: #f0f0f0; border-bottom: 1px solid #ccc; }
	h2 { padding: 0.75rem 1rem; margin: 0; font-size: 1rem; background: #f8f8f8; border-bottom: 1px solid #ddd; display: flex; align-items: center; justify-content: space-between; }
	.editor-wrap { padding: 1rem; }
	.cases { display: flex; flex-direction: column; gap: 0; }
	.case { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #ddd; }
	.case-label { grid-column: 1 / -1; padding: 0.4rem 1rem; background: #e8e8e8; font-weight: bold; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; }
	button { font-size: 0.75rem; padding: 0.2rem 0.6rem; cursor: pointer; border: 1px solid #aaa; border-radius: 3px; background: white; }
	button.copied { background: #d4edda; border-color: #5a9e6f; color: #2d6a4f; }
	.pane { padding: 1rem; overflow: auto; }
	.pane + .pane { border-left: 1px solid #ddd; }
	pre { margin: 0; white-space: pre-wrap; font-size: 0.75rem; color: #444; }
	.rendered { font-family: serif; }

	.payload { margin-top: 1rem; padding: 0.75rem 1rem; background: #f8f8f8; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem; }
	.payload table { border-collapse: collapse; width: 100%; margin-bottom: 0.6rem; }
	.payload th, .payload td { text-align: left; padding: 3px 10px 3px 0; border-bottom: 1px solid #e4e4e4; font-variant-numeric: tabular-nums; }
	.payload th { font-weight: 600; color: #555; }
	.payload-total { margin: 0 0 0.4rem; }
	.payload-note { margin: 0; color: #666; font-size: 0.75rem; }
	.payload-empty { margin: 0 0 0.4rem; color: #666; }
	.payload code { background: #eee; padding: 1px 4px; border-radius: 3px; }
</style>

<h1>RTF Dev Harness</h1>

<h2>
	<span>Editor</span>
	<span>
		<button onclick={() => editorRef?.importRtf()}>Import RTF</button>
		<button onclick={measureImages}>Measure payload</button>
		<button class:copied={editorCopied} onclick={copyEditorRtf}>
			{editorCopied ? 'Copied!' : 'Copy RTF'}
		</button>
	</span>
</h2>
<div class="editor-wrap">
	<InkEditor bind:this={editorRef} autosave={false} storageKey="dev-harness" minHeight="20vh" />

	{#if measured}
		<div class="payload">
			{#if imageStats.length === 0}
				<p class="payload-empty">No images in the document.</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th>#</th>
							<th>Format</th>
							<th>Stored pixels</th>
							<th>Displayed at</th>
							<th>On page</th>
							<th>Encoded</th>
							<th>Hex in RTF</th>
						</tr>
					</thead>
					<tbody>
						{#each imageStats as s}
							<tr>
								<td>{s.n}</td>
								<td>{s.format}</td>
								<td>{s.pixels}</td>
								<td>{s.displayed}</td>
								<td>{s.onPage}</td>
								<td>{kb(s.bytes)}</td>
								<td>{kb(s.bytes * 2)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<p class="payload-total">
				<strong>Whole document: {rtfChars.toLocaleString()} characters</strong>
				— this is what one OBX-5 has to carry.
				{#if imageStats.length > 0}
					Pictures account for {kb(totalImageBytes * 2)} of it.
				{/if}
			</p>
			<p class="payload-note">
				Stored pixels are capped by <code>maxImageEdge</code> (1600) and the encoded size by
				<code>maxImageBytes</code> (512 KB). "Displayed at" is the editor resize — it changes
				<code>\picwgoal</code> only, never the payload. "On page" is that width in inches as
				the receiver will draw it; ⚠ marks anything wider than the 6.5in text column of a
				Letter page.
			</p>
		</div>
	{/if}
</div>

<h2><span>Parser test cases</span></h2>
<div class="cases">
	{#each cases as c}
		<div class="case">
			<div class="case-label">
				<span>{c.label}</span>
				<span>
					<button class:copied={copied === c.label + ':source'} onclick={() => copySource(c.label, c.rtf)}>
						{copied === c.label + ':source' ? 'Copied!' : 'Copy source RTF'}
					</button>
					<button class:copied={copied === c.label + ':roundtrip'} onclick={() => copyRoundtrip(c.label, c.rtf)}>
						{copied === c.label + ':roundtrip' ? 'Copied!' : 'Copy round-trip RTF'}
					</button>
				</span>
			</div>
			<div class="pane"><pre>{c.rtf}</pre></div>
			<div class="pane rendered">{@html parse(c.rtf)}</div>
		</div>
	{/each}
</div>
