/**
 * A <table> as a grid: which cell covers which row and column once rowspan and colspan are
 * resolved. RTF and Markdown both describe a table column by column, so both writers start here.
 */

/** One <td> or <th>, with where it starts and how far it reaches. */
export interface GridCell {
	el: HTMLElement;
	row: number;
	col: number;
	rowspan: number;
	colspan: number;
}

export interface TableModel {
	/** The number of columns in the widest row. */
	columns: number;
	/** For each row, the cell that covers each column, or null where no cell does. */
	rows: (GridCell | null)[][];
	cells: GridCell[];
	/** For each column, which column of the markup it is: columns no cell starts in are not counted. */
	source: number[];
}

/** The most columns one cell may span, as in HTML. */
const MAX_COLSPAN = 1000;

/**
 * A table's rows in the order a browser shows them: the head first and the foot last, wherever
 * the source wrote them.
 */
export function tableRowsInOrder(table: Element): Element[] {
	const pick = (selector: string) => Array.from(table.querySelectorAll(selector));
	return [
		...pick(':scope > thead > tr'),
		...pick(':scope > tbody > tr, :scope > tr'),
		...pick(':scope > tfoot > tr')
	];
}

/** A row's own cells. */
export function rowCells(row: Element): HTMLElement[] {
	return Array.from(row.querySelectorAll<HTMLElement>(':scope > td, :scope > th'));
}

function span(el: Element, name: 'rowspan' | 'colspan'): number {
	const value = parseInt(el.getAttribute(name) ?? '', 10);
	return Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * Lay a table's cells out on a grid. A cell goes in the first free column of its row and covers
 * colspan columns and rowspan rows from there; rowspan="0" reaches the last row, as in HTML, and
 * no span reaches past the table. Where two cells would overlap, the one placed first keeps the slot.
 *
 * A column in which no cell starts is not a column: a browser gives it no width. That is what
 * colspan="100" on a cell meant to cross "the whole table" leaves behind, and counted as columns
 * they would squeeze the real ones into a sliver of the page.
 */
export function tableModel(table: Element): TableModel {
	const trs = tableRowsInOrder(table);
	const cells: GridCell[] = [];

	/** Put each cell on a grid, in order; returns the grid and its width. */
	const place = (): { rows: (GridCell | null)[][]; columns: number } => {
		const rows: (GridCell | null)[][] = trs.map(() => []);
		let columns = 0;
		for (const cell of cells) {
			for (let dr = 0; dr < cell.rowspan; dr++) {
				for (let dc = 0; dc < cell.colspan; dc++) {
					if (!rows[cell.row + dr][cell.col + dc]) rows[cell.row + dr][cell.col + dc] = cell;
				}
			}
			columns = Math.max(columns, cell.col + cell.colspan);
		}
		return { rows, columns };
	};

	// First pass: where each cell starts, with the spans the markup gives.
	const taken: boolean[][] = trs.map(() => []);
	trs.forEach((tr, r) => {
		let c = 0;
		for (const el of rowCells(tr)) {
			while (taken[r][c]) c++;
			const colspan = Math.min(MAX_COLSPAN, Math.max(1, span(el, 'colspan')));
			const rowspan = Math.min(trs.length - r, span(el, 'rowspan') || trs.length - r);
			cells.push({ el, row: r, col: c, rowspan, colspan });
			for (let dr = 0; dr < rowspan; dr++) {
				for (let dc = 0; dc < colspan; dc++) taken[r + dr][c + dc] = true;
			}
			c += colspan;
		}
	});

	// Second pass: keep only the columns a cell starts in, and count each span in those.
	const width = cells.reduce((max, cell) => Math.max(max, cell.col + cell.colspan), 0);
	const starts = new Array<boolean>(width).fill(false);
	for (const cell of cells) starts[cell.col] = true;
	const index: number[] = [];
	const source: number[] = [];
	let kept = 0;
	for (let c = 0; c <= width; c++) {
		index[c] = kept;
		if (starts[c]) {
			source.push(c);
			kept++;
		}
	}
	for (const cell of cells) {
		const end = index[cell.col + cell.colspan];
		cell.col = index[cell.col];
		cell.colspan = Math.max(1, end - cell.col);
	}

	const { rows, columns } = place();
	// Every row as wide as the table, so a short row has explicit empty slots.
	for (const row of rows) {
		for (let c = 0; c < columns; c++) row[c] = row[c] ?? null;
	}

	return { columns, rows, cells, source };
}

/** A width as it is asked for: a share of the table in percent, or a length in twips. */
type Width = { percent: number } | { twips: number };

const TWIPS_PER_UNIT: Record<string, number> = { px: 15, pt: 20, in: 1440, cm: 1440 / 2.54, mm: 144 / 2.54 };

/** The width an element asks for (style or the width attribute, where a bare number is pixels), or null. */
function widthOf(el: Element | null | undefined): Width | null {
	if (!el) return null;
	const value = ((el as HTMLElement).style?.width || el.getAttribute('width') || '').trim().toLowerCase();
	const m = value.match(/^(\d+(?:\.\d+)?|\.\d+)(%|px|pt|in|cm|mm)?$/);
	if (!m) return null;
	const n = parseFloat(m[1]);
	if (!(n > 0)) return null;
	return m[2] === '%' ? { percent: n } : { twips: n * TWIPS_PER_UNIT[m[2] ?? 'px'] };
}

/** The width each column of the markup is given by <col> and <colgroup>, where it is given one. */
function colWidths(table: Element): (Width | null)[] {
	const widths: (Width | null)[] = [];
	const add = (el: Element, fallback: Width | null) => {
		const span = Math.min(MAX_COLSPAN, Math.max(1, parseInt(el.getAttribute('span') ?? '', 10) || 1));
		const width = widthOf(el) ?? fallback;
		for (let k = 0; k < span && widths.length < MAX_COLSPAN; k++) widths.push(width);
	};
	for (const child of Array.from(table.children)) {
		const tag = child.tagName.toLowerCase();
		if (tag === 'col') add(child, null);
		if (tag !== 'colgroup') continue;
		const cols = Array.from(child.children).filter((c) => c.tagName.toLowerCase() === 'col');
		if (cols.length === 0) add(child, null);
		for (const col of cols) add(col, widthOf(child));
	}
	return widths;
}

/**
 * The share of the table's width each column takes, adding up to 1. A column is as wide as a
 * cell of its own says, or else its <col> (width: 25%); a cell across several columns gives what
 * it has left to those of them with no width; the rest share what remains equally.
 *
 * Widths given as lengths (120px, 90pt, the bare width="120" of a pasted table) count too: as a
 * share of the table where the table's own width is a length, and otherwise, where no width is a
 * percentage, in proportion to each other. Lengths beside percentages with no table width to
 * measure them against cannot be compared, and are left out.
 */
export function columnShares(model: TableModel, table?: Element): number[] {
	const cols = table ? colWidths(table) : [];
	const asked: (Width | null)[] = Array.from({ length: model.columns }, (_, c) => cols[model.source[c]] ?? null);
	const own: boolean[] = new Array(model.columns).fill(false);
	for (const cell of model.cells) {
		if (cell.colspan !== 1 || own[cell.col]) continue;
		const w = widthOf(cell.el);
		if (!w) continue;
		asked[cell.col] = w;
		own[cell.col] = true;
	}

	const tableWidth = widthOf(table);
	const tableTwips = tableWidth && 'twips' in tableWidth ? tableWidth.twips : 0;
	const spanning = model.cells.filter((cell) => cell.colspan !== 1).map((cell) => ({ cell, width: widthOf(cell.el) }));
	const anyPercent = asked.some((w) => w && 'percent' in w) || spanning.some((s) => s.width && 'percent' in s.width);
	const lengths = asked.filter((w): w is { twips: number } => w != null && 'twips' in w);

	if (!tableTwips && !anyPercent && lengths.length > 0) {
		// Lengths only: the columns in proportion, one with no width as wide as the average.
		const average = lengths.reduce((sum, w) => sum + w.twips, 0) / lengths.length;
		const twips = asked.map((w) => (w && 'twips' in w ? w.twips : average));
		const all = twips.reduce((a, b) => a + b, 0) || 1;
		return twips.map((t) => t / all);
	}

	/** A width in percent of the table, or null where it cannot be told. */
	const percent = (w: Width | null): number | null => {
		if (!w) return null;
		if ('percent' in w) return w.percent;
		return tableTwips ? (w.twips / tableTwips) * 100 : null;
	};

	const width: (number | null)[] = asked.map(percent);
	for (const { cell, width: w } of spanning) {
		const pct = percent(w);
		if (pct == null) continue;
		const cols = Array.from({ length: cell.colspan }, (_, k) => cell.col + k).filter((c) => c < model.columns);
		const open = cols.filter((c) => width[c] == null);
		const taken = cols.reduce((sum, c) => sum + (width[c] ?? 0), 0);
		if (open.length === 0 || pct <= taken) continue;
		for (const c of open) width[c] = (pct - taken) / open.length;
	}

	const known = width.filter((w): w is number => w != null);
	const sum = known.reduce((a, b) => a + b, 0);
	const open = width.length - known.length;
	if (open > 0) {
		// What is left of 100%; where the given widths already fill it, the average of those.
		const share = sum < 100 ? (100 - sum) / open : known.length > 0 ? sum / known.length : 100 / open;
		for (let c = 0; c < width.length; c++) width[c] = width[c] ?? share;
	}

	const total = (width as number[]).reduce((a, b) => a + b, 0) || 1;
	return (width as number[]).map((w) => w / total);
}
