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
	let kept = 0;
	for (let c = 0; c <= width; c++) {
		index[c] = kept;
		if (starts[c]) kept++;
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

	return { columns, rows, cells };
}

/** The share of the table's width a cell asks for, in percent, or null when it asks for none. */
function percentWidth(el: HTMLElement): number | null {
	const m = (el.style?.width || el.getAttribute('width') || '').trim().match(/^(\d+(?:\.\d+)?|\.\d+)%$/);
	const value = m ? parseFloat(m[1]) : 0;
	return value > 0 ? value : null;
}

/**
 * The share of the table's width each column takes, adding up to 1. A column is as wide as a
 * cell of its own says (width: 25%); a cell across several columns gives what it has left to
 * those of them with no width; the rest share what remains equally.
 */
export function columnShares(model: TableModel): number[] {
	const width: (number | null)[] = new Array(model.columns).fill(null);

	for (const cell of model.cells) {
		if (cell.colspan !== 1 || width[cell.col] != null) continue;
		width[cell.col] = percentWidth(cell.el);
	}
	for (const cell of model.cells) {
		if (cell.colspan === 1) continue;
		const pct = percentWidth(cell.el);
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
