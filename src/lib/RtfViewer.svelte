<script lang="ts">
    import { rtfToHtml } from "./rtf-parser.js";

    let { content }: { content: string } = $props();

    const htmlContent = $derived(rtfToHtml(content));

    let copied = $state(false);

    async function copyRtf() {
        await navigator.clipboard.writeText(content);
        copied = true;
        setTimeout(() => (copied = false), 2000);
    }
</script>

<div class="rtf-viewer-wrap">
    <button class="copy-btn" onclick={copyRtf} title="Copy raw RTF">
        {#if copied}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Copied
        {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy RTF
        {/if}
    </button>
    <div class="rtf-viewer">
        {@html htmlContent}
    </div>
</div>

<style>
    .rtf-viewer-wrap {
        position: relative;
    }

    .copy-btn {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 500;
        border: 1px solid var(--border, #e5e2dc);
        border-radius: var(--radius-sm, 5px);
        background: var(--surface, #f2f0ec);
        color: var(--text-muted, #8a7e72);
        cursor: pointer;
        transition: all 150ms ease;
    }

    .copy-btn:hover {
        background: var(--border, #e5e2dc);
        color: var(--text, #2c2520);
    }

    .copy-btn svg {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
    }

    .rtf-viewer {
        line-height: 1.4;
        white-space: normal;
        word-wrap: break-word;
    }

    .rtf-viewer :global(br) {
        display: inline;
    }

    .rtf-viewer :global(strong) {
        font-weight: 600;
    }

    .rtf-viewer :global(em) {
        font-style: italic;
    }

    .rtf-viewer :global(u) {
        text-decoration: underline;
    }

    .rtf-viewer :global(p) {
        margin: 0 0 0.2em;
    }

    .rtf-viewer :global(p:last-child) {
        margin-bottom: 0;
    }

    /* Pictures decoded from \pict groups keep their stored width but never
       overflow the viewer. */
    .rtf-viewer :global(img) {
        max-width: 100%;
        height: auto;
    }

    .rtf-viewer :global(figure) {
        margin: 1em 0;
    }

    .rtf-viewer :global(figcaption) {
        margin-top: 0.4em;
        font-size: 0.85em;
        font-style: italic;
        color: var(--text-muted, #8a7e72);
    }
</style>
