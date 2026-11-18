import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { tableModel, columnShares } from '../table-model.js';

/**
 * Tables with merged cells (issue #2). RTF has no table element: each row says where its cells
 * end, and a cell merged down several rows is written again in every one of them. So a table only
 * arrives in one piece if every row is written against the same column edges, and a reader has
 * to work those edges back into rowspan and colspan. Both directions are here, then the two
 * together. Invented text.
 */

const R = String.raw;
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** The RTF after the header, without the closing brace. */
const body = (html: string) => {
	const rtf = htmlToRtf(el(html));
	return rtf.slice(rtf.indexOf('\\pard\\f0\\fs24 ') + '\\pard\\f0\\fs24 '.length, -1);
};
const rows = (rtf: string) => rtf.split('\\trowd').slice(1);
/** Each cell of a row's definition: its merge and border flags, then its right edge. */
const definition = (row: string) =>
	Array.from(row.slice(0, row.indexOf('\\trkeep')).matchAll(/((?:\\cl[a-z]+|\\brdrs)*)\\cellx(\d+)/g)).map((m) => `${m[1]}${m[2]}`);
/** The text of each cell of a row, in order. */
const texts = (row: string) => Array.from(row.matchAll(/\\fi0 (.*?)\\cell\}/g)).map((m) => m[1]);
const read = (rtfBody: string) => rtfToHtml(`{\\rtf1\\ansi\\deff0 ${rtfBody}}`);
/** A table as rows of "text" or "text[colspan x rowspan]". */
const shape = (html: string) =>
	Array.from(el(html).querySelectorAll('tr')).map((tr) =>
		Array.from(tr.children).map((c) => {
			const cs = c.getAttribute('colspan');
			const rs = c.getAttribute('rowspan');
			return `${c.textContent}${cs || rs ? `[${cs ?? 1}x${rs ?? 1}]` : ''}`;
		})
	);

const PLANETS =
	'<table>' +
	'<tr><th>Group</th><th>Planet</th><th>Moons</th></tr>' +
	'<tr><td rowspan="2">Terrestrial planets</td><td>Earth</td><td>1</td></tr>' +
	'<tr><td>Mars</td><td>2</td></tr>' +
	'<tr><td rowspan="2">Gas giants</td><td>Jupiter</td><td>95</td></tr>' +
	'<tr><td>Saturn</td><td>146</td></tr>' +
	'<tr><td>Ice giants</td><td colspan="2">Uranus and Neptune</td></tr>' +
	'</table>';

describe('the grid of a table', () => {
	const grid = (html: string) => {
		const model = tableModel(el(html).querySelector('table')!);
		return model.rows.map((row) => row.map((cell) => (cell ? cell.el.textContent : '-')).join(' '));
	};

	it('a cell down two rows takes its column in both, and the row below starts beside it', () => {
		expect(grid('<table><tr><td rowspan="2">G</td><td>a</td></tr><tr><td>c</td></tr></table>')).toEqual(['G a', 'G c']);
	});

	it('a cell across two columns takes both', () => {
		expect(grid('<table><tr><td colspan="2">w</td><td>x</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>')).toEqual(['w w x', 'a b c']);
	});

	it('a short row is as wide as the table, with empty slots', () => {
		expect(grid('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>')).toEqual(['a b c', 'd - -']);
	});

	it('no span reaches past the last row, and rowspan="0" reaches it', () => {
		expect(grid('<table><tr><td rowspan="9">G</td><td>a</td></tr><tr><td>b</td></tr></table>')).toEqual(['G a', 'G b']);
		expect(grid('<table><tr><td rowspan="0">G</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>')).toEqual(['G a', 'G b', 'G c']);
	});

	it('a span that is not a number, or is negative, is one cell', () => {
		expect(grid('<table><tr><td colspan="x">a</td><td rowspan="-3">b</td></tr><tr><td>c</td><td>d</td></tr></table>')).toEqual(['a b', 'c d']);
	});

	it('a column no cell starts in is not a column: colspan="100" for "the whole table" adds none', () => {
		expect(grid('<table><tr><td>label</td><td colspan="100">value</td></tr><tr><td>a</td><td>b</td></tr></table>')).toEqual(['label value', 'a b']);
		expect(grid('<table><tr><td colspan="100">title</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>')).toEqual(['title title title', 'a b c']);
		expect(grid('<table><tr><td colspan="2">x</td><td>y</td></tr></table>')).toEqual(['x y']);
	});

	it('a huge colspan is cut down, not followed', () => {
		const model = tableModel(el('<table><tr><td colspan="2000000000">a</td><td>b</td></tr></table>').querySelector('table')!);
		expect(model.columns).toBe(2);
	});

	it('rows are in the order shown: the head first and the foot last, wherever they are written', () => {
		expect(
			grid('<table><tfoot><tr><td>foot</td></tr></tfoot><tbody><tr><td>body</td></tr></tbody><thead><tr><th>head</th></tr></thead></table>')
		).toEqual(['head', 'body', 'foot']);
	});

	it('columns share the width: a cell\'s own percentage, then what is left', () => {
		const shares = (html: string) => columnShares(tableModel(el(html).querySelector('table')!)).map((s) => Math.round(s * 1000) / 10);
		expect(shares('<table><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>')).toEqual([25, 25, 25, 25]);
		expect(shares('<table><tr><td style="width:50%">a</td><td>b</td><td>c</td></tr></table>')).toEqual([50, 25, 25]);
		// A cell across two columns gives what it has left to the one with no width of its own.
		expect(shares('<table><tr><td colspan="2" style="width:70%">w</td><td>c</td></tr><tr><td style="width:20%">a</td><td>b</td><td>c</td></tr></table>')).toEqual([20, 50, 30]);
		// Widths that add up to more than the table are scaled to fit it.
		expect(shares('<table><tr><td style="width:60%">a</td><td style="width:60%">b</td></tr></table>')).toEqual([50, 50]);
		// A width in pixels says nothing about a share of the page.
		expect(shares('<table><tr><td style="width:300px">a</td><td>b</td></tr></table>')).toEqual([50, 50]);
	});
});

describe('htmlToRtf: a cell down several rows (rowspan)', () => {
	const rtf = body('<table><tr><td rowspan="2">Group</td><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>');
	const [first, second] = rows(rtf);

	it('both rows have the same three column edges', () => {
		expect(definition(first).map((d) => d.replace(/\D+/g, ''))).toEqual(['2880', '5760', '8640']);
		expect(definition(second).map((d) => d.replace(/\D+/g, ''))).toEqual(['2880', '5760', '8640']);
	});

	it('the cell is \\clvmgf where it starts and an empty \\clvmrg cell in the row below', () => {
		expect(definition(first)).toEqual(['\\clvmgf2880', '5760', '8640']);
		expect(definition(second)).toEqual(['\\clvmrg2880', '5760', '8640']);
		expect(texts(first)).toEqual(['Group', 'a', 'b']);
		expect(texts(second)).toEqual(['', 'c', 'd']);
	});

	it('every row still has one \\cell for each \\cellx, and one \\row', () => {
		for (const row of rows(rtf)) {
			expect(row.split('\\cell{').length - 1 + (row.split('\\cell}').length - 1)).toBe(definition(row).length);
			expect(row.split('\\row').length - 1).toBe(1);
		}
	});

	it('a cell down three rows is continued in each of them', () => {
		const three = rows(body('<table><tr><td rowspan="3">G</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>'));
		expect(three.map((row) => definition(row)[0])).toEqual(['\\clvmgf4320', '\\clvmrg4320', '\\clvmrg4320']);
		expect(three.map((row) => texts(row))).toEqual([['G', 'a'], ['', 'b'], ['', 'c']]);
	});

	it('a merged cell in the last column', () => {
		const last = rows(body('<table><tr><td>a</td><td rowspan="2">G</td></tr><tr><td>b</td></tr></table>'));
		expect(last.map(definition)).toEqual([['4320', '\\clvmgf8640'], ['4320', '\\clvmrg8640']]);
		expect(last.map(texts)).toEqual([['a', 'G'], ['b', '']]);
	});

	it('a row with no cells of its own, under merged cells, is still a row', () => {
		const empty = rows(body('<table><tr><td rowspan="2">G</td><td rowspan="2">H</td></tr><tr></tr></table>'));
		expect(empty.map(definition)).toEqual([['\\clvmgf4320', '\\clvmgf8640'], ['\\clvmrg4320', '\\clvmrg8640']]);
	});

	it('a rowspan of one, or one cut down to one by the end of the table, is an ordinary cell', () => {
		expect(body('<table><tr><td rowspan="1">a</td></tr></table>')).not.toContain('\\clvm');
		expect(body('<table><tr><td rowspan="5">a</td><td>b</td></tr></table>')).not.toContain('\\clvm');
	});
});

describe('htmlToRtf: a cell across several columns (colspan)', () => {
	it('ends at the right edge of the last column it covers', () => {
		const [first, second] = rows(body('<table><tr><td colspan="2">wide</td><td>c</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>'));
		expect(definition(first)).toEqual(['5760', '8640']);
		expect(definition(second)).toEqual(['2880', '5760', '8640']);
		expect(texts(first)).toEqual(['wide', 'c']);
	});

	it('a cell across the whole table', () => {
		const [first] = rows(body('<table><tr><td colspan="3">all</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>'));
		expect(definition(first)).toEqual(['8640']);
	});

	it('a cell in the middle and one at the end', () => {
		const middle = rows(body('<table><tr><td>a</td><td colspan="2">mid</td><td>d</td></tr><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>'));
		expect(definition(middle[0])).toEqual(['2160', '6480', '8640']);
		const end = rows(body('<table><tr><td>a</td><td colspan="2">end</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>'));
		expect(definition(end[0])).toEqual(['2880', '8640']);
	});

	it('a cell across columns and down rows is one cell in each row, as wide as it is', () => {
		const both = rows(body('<table><tr><td rowspan="2" colspan="2">big</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>'));
		expect(both.map(definition)).toEqual([['\\clvmgf5760', '8640'], ['\\clvmrg5760', '8640'], ['2880', '5760', '8640']]);
		expect(both.map(texts)).toEqual([['big', 'a'], ['', 'b'], ['c', 'd', 'e']]);
	});

	it('the columns keep the widths their own cells give them', () => {
		const [first, second] = rows(body('<table><tr><td colspan="2">wide</td><td>c</td></tr><tr><td style="width:10%">a</td><td style="width:40%">b</td><td style="width:50%">c</td></tr></table>'));
		expect(definition(second)).toEqual(['864', '4320', '8640']);
		expect(definition(first)).toEqual(['4320', '8640']);
	});
});

describe('htmlToRtf: the table as a whole', () => {
	it('the planets table: every row is written against the same three edges', () => {
		const all = rows(body(PLANETS));
		expect(all.length).toBe(6);
		const edgesOf = (row: string) => definition(row).map((d) => Number(d.replace(/\D+/g, '')));
		for (const row of all) {
			for (const edge of edgesOf(row)) expect([2880, 5760, 8640]).toContain(edge);
			expect(edgesOf(row).at(-1)).toBe(8640);
		}
		expect(all.map(definition)).toEqual([
			['\\clbrdrb\\brdrs2880', '\\clbrdrb\\brdrs5760', '\\clbrdrb\\brdrs8640'],
			['\\clvmgf2880', '5760', '8640'],
			['\\clvmrg2880', '5760', '8640'],
			['\\clvmgf2880', '5760', '8640'],
			['\\clvmrg2880', '5760', '8640'],
			['2880', '8640']
		]);
		expect(all.map(texts)).toEqual([
			['Group', 'Planet', 'Moons'],
			['Terrestrial planets', 'Earth', '1'],
			['', 'Mars', '2'],
			['Gas giants', 'Jupiter', '95'],
			['', 'Saturn', '146'],
			['Ice giants', 'Uranus and Neptune']
		]);
	});

	it('a cell with colspan="100" across a two-column table leaves the columns their width', () => {
		const [first, second] = rows(body('<table><tr><td colspan="100">title</td></tr><tr><td>a</td><td>b</td></tr></table>'));
		expect(definition(first)).toEqual(['8640']);
		expect(definition(second)).toEqual(['4320', '8640']);
	});

	it('a row short of cells is filled with empty ones, so its edges are the table\'s', () => {
		const [first, second] = rows(body('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>'));
		expect(definition(second)).toEqual(definition(first));
		expect(texts(second)).toEqual(['d', '', '']);
	});

	it('#3.13: only a <th> gets the header border, also when it is merged', () => {
		const [first, second] = rows(body('<table><tr><th rowspan="2">h</th><td>d</td></tr><tr><td>e</td></tr></table>'));
		expect(definition(first)).toEqual(['\\clvmgf\\clbrdrb\\brdrs4320', '8640']);
		expect(definition(second)).toEqual(['\\clvmrg\\clbrdrb\\brdrs4320', '8640']);
	});

	it('#3.13: the head is written first and the foot last, wherever the source has them', () => {
		const rtf = body('<table><tfoot><tr><td>foot</td></tr></tfoot><tbody><tr><td>body</td></tr></tbody><thead><tr><th>head</th></tr></thead></table>');
		expect(rows(rtf).map((row) => texts(row)[0])).toEqual(['head', 'body', 'foot']);
	});

	it('a table with no cells writes nothing', () => {
		expect(body('<table></table>')).toBe('');
		expect(body('<table><tr></tr></table>')).toBe('');
	});

	it('an ordinary table: each cell ends inside its group, and the last row says it is the last', () => {
		// Changed on purpose for issue 21: a cell ended "\\par}\\cell", which Apple's reader showed
		// as an extra empty paragraph in every cell, and no row said where the table ended.
		expect(body('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>')).toBe(
			'{\\trowd\\trgaph120\\clbrdrb\\brdrs\\cellx4320\\clbrdrb\\brdrs\\cellx8640\\trkeep\\intbl{{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 H1\\cell}{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 H2\\cell}}\\intbl\\row}' +
			'{\\trowd\\trgaph120\\cellx4320\\cellx8640\\trkeep\\intbl{{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 a\\cell}{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 b\\cell}}\\intbl\\lastrow\\row}'
		);
	});

	it('the size estimate covers a table with merged cells and short rows', () => {
		for (const html of [PLANETS, '<table><tr><td rowspan="0">G</td><td>a</td><td>b</td></tr><tr><td>c</td></tr><tr></tr><tr><td>d</td></tr></table>']) {
			const dom = el(html);
			expect(estimateRtfBytes(dom)).toBeGreaterThanOrEqual(htmlToRtf(dom).length);
		}
	});
});

describe('htmlToRtf: a cell\'s alignment', () => {
	it('is written on the cell\'s paragraph', () => {
		const [row] = rows(body('<table><tr><td style="text-align:right">1.5</td><td style="text-align:center">mid</td><td align="justify">j</td><td>left</td></tr></table>'));
		expect(Array.from(row.matchAll(/\{\\pard\\intbl(\\q[a-z])? \\f0/g)).map((m) => m[1] ?? '')).toEqual(['\\qr', '\\qc', '\\qj', '']);
	});

	it('every paragraph, heading, list item and code block in the cell has it', () => {
		const rtf = body('<table><tr><td style="text-align:center"><p>one</p><p>two</p><h2>head</h2><ul><li>item</li></ul><pre>code</pre>tail</td></tr></table>');
		expect(rtf).toContain('\\pard\\intbl\\qc one\\par ');
		expect(rtf).toContain('\\pard\\intbl\\qc two\\par ');
		expect(rtf).toContain('\\pard\\intbl\\qc\\f0\\fs36\\b head');
		expect(rtf).toContain('\\pard\\intbl\\qc\\li720\\fi-360\\bullet\\tab item\\par ');
		expect(rtf).toContain('\\pard\\intbl\\qc\\f1\\fs20 code');
	});

	it('a paragraph with an alignment of its own keeps it, and one set left says so', () => {
		const rtf = body('<table><tr><td style="text-align:center"><p style="text-align:right">r</p><p style="text-align:left">l</p></td></tr></table>');
		expect(rtf).toContain('\\pard\\intbl\\qr r\\par ');
		expect(rtf).toContain('\\pard\\intbl\\ql l\\cell}');
	});

	it('does not reach the next cell, or the paragraph after the table', () => {
		const rtf = body('<table><tr><td style="text-align:right">a</td><td><p>b</p><p>c</p></td></tr></table><p>after</p>');
		expect(rtf).toContain('{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 b\\par \\pard\\intbl c\\cell}');
		expect(rtf.endsWith('\\pard after\\par ')).toBe(true);
	});
});

describe('htmlToRtf: a table inside a table cell', () => {
	const rtf = body('<table><tr><td>before<table><tr><td>in 1</td><td>in 2</td></tr><tr><td>in 3</td><td>in 4</td></tr></table>after</td><td>beside</td></tr></table>');

	it('is written as lines of text in that cell, its cells a tab apart: no row opens inside a cell', () => {
		expect(rows(rtf).length).toBe(1);
		expect(rtf).toContain('before\\par \\pard\\intbl in 1\\tab in 2\\par \\pard\\intbl in 3\\tab in 4\\par \\pard\\intbl after\\cell}');
	});

	it('loses none of the text, and reads back as those lines', () => {
		const html = rtfToHtml(htmlToRtf(el('<table><tr><td>before<table><tr><td>in 1</td><td>in 2</td></tr></table>after</td></tr></table>')));
		expect(el(html).querySelectorAll('table').length).toBe(1);
		expect(el(html).querySelector('td')!.innerHTML).toBe('before<br>in 1<span style="white-space:pre">\t</span>in 2<br>after');
	});
});

describe('rtfToHtml: merged cells', () => {
	it('#2: \\clvmgf and \\clvmrg are one cell with rowspan, and no empty cell under it', () => {
		const html = read(R`\trowd\clvmgf\cellx2880\cellx5760 \intbl Group\cell a\cell\row \trowd\clvmrg\cellx2880\cellx5760 \intbl \cell c\cell\row \trowd\clvmrg\cellx2880\cellx5760 \intbl \cell d\cell\row`);
		expect(shape(html)).toEqual([['Group[1x3]', 'a'], ['c'], ['d']]);
	});

	it('two merges in one column, one after the other', () => {
		const html = read(
			R`\trowd\clvmgf\cellx2880\cellx5760 \intbl A\cell 1\cell\row \trowd\clvmrg\cellx2880\cellx5760 \intbl \cell 2\cell\row ` +
			R`\trowd\clvmgf\cellx2880\cellx5760 \intbl B\cell 3\cell\row \trowd\clvmrg\cellx2880\cellx5760 \intbl \cell 4\cell\row`
		);
		expect(shape(html)).toEqual([['A[1x2]', '1'], ['2'], ['B[1x2]', '3'], ['4']]);
	});

	it('a \\clvmrg cell with nothing above it to join stays a cell', () => {
		const html = read(R`\trowd\clvmrg\cellx2880\cellx5760 \intbl x\cell a\cell\row`);
		expect(shape(html)).toEqual([['x', 'a']]);
	});

	it('text in a cell that says it is merged away is kept, in the cell it joins', () => {
		const html = read(R`\trowd\clvmgf\cellx2880 \intbl top\cell\row \trowd\clvmrg\cellx2880 \intbl stray\cell\row`);
		expect(el(html).querySelector('td')!.innerHTML).toBe('top<br>stray');
	});

	it('#2: a cell that crosses the column edges of other rows has colspan', () => {
		const html = read(R`\trowd\cellx5760\cellx8640 \intbl wide\cell c\cell\row \trowd\cellx2880\cellx5760\cellx8640 \intbl a\cell b\cell c\cell\row`);
		expect(shape(html)).toEqual([['wide[2x1]', 'c'], ['a', 'b', 'c']]);
	});

	it('edges a twip or two apart are the same edge, not a sliver of a column', () => {
		const html = read(R`\trowd\cellx2880\cellx8640 \intbl a\cell b\cell\row \trowd\cellx2881\cellx8639 \intbl c\cell d\cell\row`);
		expect(shape(html)).toEqual([['a', 'b'], ['c', 'd']]);
	});

	it('\\clmgf and \\clmrg, the older way to merge across, are one cell with colspan', () => {
		const html = read(R`\trowd\clmgf\cellx2880\clmrg\cellx5760\cellx8640 \intbl wide\cell \cell c\cell\row \trowd\cellx2880\cellx5760\cellx8640 \intbl a\cell b\cell c\cell\row`);
		expect(shape(html)).toEqual([['wide[2x1]', 'c'], ['a', 'b', 'c']]);
	});

	it('a merge across and down at once', () => {
		const html = read(
			R`\trowd\clvmgf\cellx5760\cellx8640 \intbl big\cell a\cell\row \trowd\clvmrg\cellx5760\cellx8640 \intbl \cell b\cell\row ` +
			R`\trowd\cellx2880\cellx5760\cellx8640 \intbl c\cell d\cell e\cell\row`
		);
		expect(shape(html)).toEqual([['big[2x2]', 'a'], ['b'], ['c', 'd', 'e']]);
	});

	it('a cell is as wide as the columns it covers', () => {
		const html = read(R`\trowd\cellx5760\cellx8640 \intbl wide\cell c\cell\row \trowd\cellx2880\cellx5760\cellx8640 \intbl a\cell b\cell c\cell\row`);
		const widths = Array.from(el(html).querySelectorAll<HTMLElement>('td')).map((td) => td.style.width);
		expect(widths).toEqual(['66.67%', '33.33%', '33.33%', '33.34%', '33.33%']);
	});

	it('a header cell is the one with the bottom border, not its whole row', () => {
		const html = read(R`\trowd\clbrdrb\brdrs\cellx4320\cellx8640 \intbl h\cell d\cell\row`);
		expect(Array.from(el(html).querySelectorAll('tr > *')).map((c) => c.tagName)).toEqual(['TH', 'TD']);
	});

	it('a cell with more text than the row has edges for is kept', () => {
		const html = read(R`\trowd\cellx4320 \intbl a\cell b\cell c\cell\row`);
		expect(shape(html)).toEqual([['a', 'b', 'c']]);
	});

	it('a table inside a cell, as Word writes one, is lines of text in that cell', () => {
		const html = read(
			R`\trowd\cellx8640 \pard\intbl outer \pard\intbl\itap2 in 1\nestcell in 2\nestcell{\*\nesttableprops\trowd\cellx2000\cellx4000\nestrow}{\nonesttables\par}` +
			R`\pard\intbl\itap2 in 3\nestcell in 4\nestcell{\*\nesttableprops\trowd\cellx2000\cellx4000\nestrow}{\nonesttables\par}\pard\intbl after\cell\row`
		);
		expect(el(html).querySelector('td')!.textContent).toBe('outer in 1\tin 2in 3\tin 4after');
		expect(el(html).querySelector('td')!.querySelectorAll('br').length).toBe(2);
	});
});

describe('a table with merged cells, saved, reloaded and saved again (#2)', () => {
	const cases: Record<string, string> = {
		'the planets table': PLANETS,
		'a cell down two rows': '<table><tr><td rowspan="2">Group</td><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
		'a cell across two columns': '<table><tr><td colspan="2">wide</td><td>c</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>',
		'a cell across and down': '<table><tr><td rowspan="2" colspan="2">big</td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>',
		'merged header cells': '<table><tr><th rowspan="2">Site</th><th colspan="2">Margin</th></tr><tr><th>mm</th><th>status</th></tr><tr><td>Deep</td><td>2</td><td>negative</td></tr></table>',
		'column widths that are no round share of the page': '<table><tr><td style="width:17%">a</td><td style="width:41%">b</td><td>c</td></tr><tr><td colspan="2">ab</td><td>c</td></tr></table>',
		'aligned cells in a merged table': '<table><tr><td rowspan="2" style="text-align:center">G</td><td style="text-align:right">1.5</td></tr><tr><td style="text-align:right">2.5</td></tr></table>'
	};

	for (const [name, html] of Object.entries(cases)) {
		it(`${name}: the RTF is the same, and so is the table`, () => {
			const first = htmlToRtf(el(html));
			const back = rtfToHtml(first);
			expect(htmlToRtf(el(back))).toBe(first);
			expect(shape(back)).toEqual(shape(html));
			expect(rtfToHtml(htmlToRtf(el(back)))).toBe(back);
		});
	}

	it('a merged table Word wrote reads, and is then written the same save after save', () => {
		const word =
			R`\trowd\clvmgf\clbrdrb\brdrs\cellx3000\clbrdrb\brdrs\cellx9000\pard\plain\intbl {Group\cell Value\cell }\pard\plain\intbl {\trowd\clvmgf\clbrdrb\brdrs\cellx3000\clbrdrb\brdrs\cellx9000\row }` +
			R`\trowd\clvmrg\cellx3000\cellx6000\cellx9000\pard\plain\intbl {\cell a\cell b\cell }\pard\plain\intbl {\trowd\clvmrg\cellx3000\cellx6000\cellx9000\row }\pard\plain after\par`;
		const html = read(word);
		expect(shape(html.split('\n')[0])).toEqual([['Group[1x2]', 'Value[2x1]'], ['a', 'b']]);
		const saved = htmlToRtf(el(html));
		expect(htmlToRtf(el(rtfToHtml(saved)))).toBe(saved);
	});
});
