<script lang="ts">
	import ToolbarButton from './ToolbarButton.svelte';
	import ColorPicker from './ColorPicker.svelte';

	interface Props {
		formatState?: Record<string, boolean>;
		blockType?: string;
		onexec?: (cmd: string, value?: string | null) => void;
		onblock?: (tag: string) => void;
		oninsertlink?: () => void;
		oninsertimage?: () => void;
	}

	let {
		formatState = {},
		blockType = 'p',
		onexec,
		onblock,
		oninsertlink,
		oninsertimage
	}: Props = $props();

	function exec(cmd: string, value: string | null = null) {
		onexec?.(cmd, value);
	}
</script>

<div class="toolbar">
	<!-- Block type -->
	<div class="toolbar-group">
		<select
			class="tb-select"
			value={blockType}
			onchange={(e) => onblock?.((e.target as HTMLSelectElement).value)}
		>
			<option value="p">Paragraph</option>
			<option value="h1">Heading 1</option>
			<option value="h2">Heading 2</option>
			<option value="h3">Heading 3</option>
			<option value="blockquote">Quote</option>
			<option value="pre">Code Block</option>
		</select>
	</div>

	<div class="toolbar-divider"></div>

	<!-- Inline formatting -->
	<div class="toolbar-group">
		<ToolbarButton active={formatState.bold} title="Bold (Ctrl+B)" onclick={() => exec('bold')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
		</ToolbarButton>
		<ToolbarButton active={formatState.italic} title="Italic (Ctrl+I)" onclick={() => exec('italic')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
		</ToolbarButton>
		<ToolbarButton active={formatState.underline} title="Underline (Ctrl+U)" onclick={() => exec('underline')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>
		</ToolbarButton>
		<ToolbarButton active={formatState.strikeThrough} title="Strikethrough" onclick={() => exec('strikeThrough')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 4c-.5-1.5-2.5-3-5-3-3 0-5 2-5 4.5 0 2 1 3.5 5 5"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M8 20c.5 1.5 2.5 3 5 3 3 0 5-2 5-4.5 0-1.5-.5-2.5-2-3.5"/></svg>
		</ToolbarButton>
	</div>

	<div class="toolbar-divider"></div>

	<!-- Colors -->
	<div class="toolbar-group">
		<ColorPicker value="#2C2520" title="Text color" onchange={(c) => exec('foreColor', c)} />
	</div>

	<div class="toolbar-divider"></div>

	<!-- Lists -->
	<div class="toolbar-group">
		<ToolbarButton title="Bullet list" onclick={() => exec('insertUnorderedList')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="18" r="1.5" fill="currentColor"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Numbered list" onclick={() => exec('insertOrderedList')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="3" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="3" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="3" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
		</ToolbarButton>
	</div>

	<div class="toolbar-divider"></div>

	<!-- Alignment -->
	<div class="toolbar-group">
		<ToolbarButton title="Align left" onclick={() => exec('justifyLeft')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Align center" onclick={() => exec('justifyCenter')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Align right" onclick={() => exec('justifyRight')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
		</ToolbarButton>
	</div>

	<div class="toolbar-divider"></div>

	<!-- Indent -->
	<div class="toolbar-group">
		<ToolbarButton title="Decrease indent (Ctrl+[)" onclick={() => exec('outdent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="11" y1="10" x2="21" y2="10"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="7 9 4 12 7 15"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Increase indent (Ctrl+])" onclick={() => exec('indent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="11" y1="10" x2="21" y2="10"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="4 9 7 12 4 15"/></svg>
		</ToolbarButton>
	</div>

	<div class="toolbar-divider"></div>

	<!-- Insert -->
	<div class="toolbar-group">
		<ToolbarButton title="Insert link (Ctrl+K)" onclick={oninsertlink}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Insert image" onclick={oninsertimage}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Horizontal rule" onclick={() => exec('insertHorizontalRule')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>
		</ToolbarButton>
	</div>

	<div class="toolbar-divider"></div>

	<!-- History -->
	<div class="toolbar-group">
		<ToolbarButton title="Undo (Ctrl+Z)" onclick={() => exec('undo')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7v6h6"/><path d="M3 13c0 0 2.03-7 9-7a9 9 0 0 1 9 9 9 9 0 0 1-9 9c-3.5 0-6-1.5-7.5-4"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Redo" onclick={() => exec('redo')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 7v6h-6"/><path d="M21 13c0 0-2.03-7-9-7a9 9 0 0 0-9 9 9 9 0 0 0 9 9c3.5 0 6-1.5 7.5-4"/></svg>
		</ToolbarButton>
		<ToolbarButton title="Clear formatting" onclick={() => exec('removeFormat')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><line x1="18" y1="4" x2="4" y2="20" stroke="var(--accent)" stroke-width="2"/></svg>
		</ToolbarButton>
	</div>
</div>

<style>
	.toolbar {
		position: static;
		background: var(--bg-toolbar);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 6px 8px;
		margin: 24px 0 16px;
		display: flex;
		align-items: center;
		gap: 2px;
		flex-wrap: wrap;
		box-shadow: var(--shadow-sm);
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.toolbar-divider {
		width: 1px;
		height: 24px;
		background: var(--border);
		margin: 0 6px;
		flex-shrink: 0;
	}

	.tb-select {
		height: 34px;
		padding: 0 10px;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: all var(--transition);
		appearance: none;
		-webkit-appearance: none;
		padding-right: 22px;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A7E72' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 6px center;
	}

	.tb-select:hover {
		background: var(--surface);
		color: var(--text);
	}
</style>
