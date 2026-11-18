import { describe, it, expect } from 'vitest';
import { rtfToHtml } from '../rtf-parser.js';
import { htmlToRtf } from '../rtf-writer.js';

/**
 * What rtfToHtml makes of RTF that this library's own writer never writes, but Word and TextEdit
 * do: tracked changes, hidden text, the Symbol font, footnotes, text boxes, binary pictures,
 * alignment stated once for many paragraphs, tables that follow each other, and files built to
 * freeze the page. Every case here was first found by reading real files or by comparing with
 * Apple's reader (issue 21), where the reader showed text that is not there, lost text that is,
 * or changed what the text says. Invented text.
 */

const R = String.raw;
/** \uN with its one-character fallback, built by hand: a raw template would read the escape itself. */
const u = (code: number, fallback = '?') => `\\u${code}${fallback}`;
const FONTS = R`{\fonttbl{\f0\fswiss Helvetica;}{\f1\fmodern Courier New;}{\f2\froman\fcharset2 Symbol;}{\f3\fnil\fcharset2 Wingdings;}}`;
const COLORS = R`{\colortbl;\red255\green0\blue0;}`;
const read = (body: string, fontSize?: number) => rtfToHtml(`{\\rtf1\\ansi\\ansicpg1252\\deff0${FONTS}${COLORS}\\pard ${body}}`, { fontSize });
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** A one-pixel PNG as picture data. */
const PNG = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf500f0003860180ee2b5b450000000049454e44ae426082';
const picture = R`{\pict\pngblip\picw1\pich1 ${PNG}}`;
const TABLE = '<table style="border-collapse:collapse;width:100%;margin:4px 0">';
const cell = (text: string, width: string, more = '') => `<td style="padding:2px 6px;width:${width}%${more}">${text}</td>`;

describe('tracked changes (issue 21, item 1)', () => {
	it('text a tracked change deleted is not shown; what replaced it is', () => {
		expect(read(R`Diagnosis: {\deleted malignant}{\revised benign} lesion.\par`)).toBe('<p>Diagnosis: benign lesion.</p>');
	});

	it('\\deleted0 and \\plain end it', () => {
		expect(read(R`a\deleted b\deleted0 c\deleted d\plain e\par`)).toBe('<p>ace</p>');
	});

	it('a deleted tab, line break, picture and Unicode character are not shown either', () => {
		expect(read(`a{\\deleted \\tab x\\line ${picture}${u(233)}${u(-10179)}}b\\par`)).toBe('<p>ab</p>');
	});
});

describe('the Symbol font (issue 21, item 2)', () => {
	it('a letter set in Symbol is the Greek letter the font shows: 5 mg is not 5 μg', () => {
		expect(read(R`5 {\f2 m}g, 10 {\f2 W}, {\f2 abg}\par`)).toBe('<p>5 μg, 10 Ω, αβγ</p>');
	});

	it('a byte above 127 is the sign the font has there', () => {
		expect(read(R`37{\f2\'b0}C, x {\f2\'b3} 5, y {\f2\'a3} 2, a {\f2\'b1} b, {\f2\'b7} item\par`)).toBe('<p>37°C, x ≥ 5, y ≤ 2, a ± b, • item</p>');
	});

	it('Word writes a Symbol character as U+F000 plus its byte', () => {
		expect(read(`{\\f2 ${u(-3987)}}g\\par`)).toBe('<p>μg</p>');
	});

	it('the same letters in any other font are the letters, and Symbol ends with its group or \\plain', () => {
		expect(read(R`{\f0 m}{\f1 m}{\f3 m} {\f2 m}m \f2 m\plain m\par`)).toBe('<p>m<code>m</code>m μm μm</p>');
	});

	it('a font table written with no group around each font is read the same', () => {
		const rtf = R`{\rtf1\ansi{\fonttbl\f0\fswiss\fcharset0 Helvetica;\f1\fnil\fcharset2 Symbol;}\f0 5 \f1 m\f0 g\par}`;
		expect(rtfToHtml(rtf)).toBe('<p>5 μg</p>');
	});

	it('only a Symbol font in the symbol character set is one: TextEdit\'s, in the Mac character set, holds ordinary text', () => {
		// As Apple's own reader reads the three: "5 μg" for \fcharset2, "5 mg" for the others.
		const doc = (charset: string) => `{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;\\f1\\ftech${charset} Symbol;}\\f0 5 \\f1 m\\f0 g\\par}`;
		expect(rtfToHtml(doc(R`\fcharset2`))).toBe('<p>5 μg</p>');
		expect(rtfToHtml(doc(R`\fcharset77`))).toBe('<p>5 mg</p>');
		expect(rtfToHtml(doc(R`\fcharset0`))).toBe('<p>5 mg</p>');
		expect(rtfToHtml(doc(''))).toBe('<p>5 mg</p>');
	});

	it('a character with no place in the font is left as it is', () => {
		expect(read(`{\\f2 ${u(8805)}\\'f0}\\par`)).toBe('<p>≥ð</p>');
	});

	it('a symbol field is the character it names, shown once', () => {
		// Word's Insert Symbol: the field says which character, and its result holds the same one.
		expect(read(R`37{\field{\*\fldinst SYMBOL 176 \\f "Symbol" \\s 12}{\fldrslt\f2\fs24 \'b0}}C\par`)).toBe('<p>37°C</p>');
		// With no result at all, which is how the degree sign went missing.
		expect(read(R`37{\field{\*\fldinst SYMBOL 176 \\f "Symbol"}}C, 5 {\field{\*\fldinst SYMBOL 0x6D \\f Symbol}}g\par`)).toBe('<p>37°C, 5 μg</p>');
	});

	it('a symbol field with no font is the character of that number; one in a font not known here keeps its own result', () => {
		expect(read(R`caf{\field{\*\fldinst SYMBOL 233}{\fldrslt x}} {\field{\*\fldinst SYMBOL 8805 \\u}}\par`)).toBe('<p>café ≥</p>');
		// Below 256 the number is a byte of Windows-1252, where 147 is an opening quotation mark.
		expect(read(R`{\field{\*\fldinst SYMBOL 147}}quoted\par`)).toBe('<p>“quoted</p>');
		// What 252 shows in Wingdings is not known here: the field's own result stands.
		expect(read(R`{\field{\*\fldinst SYMBOL 252 \\f "Wingdings"}{\fldrslt\f3 \'fb}}\par`)).toBe('<p>û</p>');
	});
});

describe('hidden text (issue 21, item 6)', () => {
	it('hidden text is not shown, and \\v0 or \\plain ends it', () => {
		expect(read(R`Visible {\v HIDDEN }again\v gone\v0  back\v gone\plain  here\par`)).toBe('<p>Visible again back here</p>');
	});

	it('an index entry and a contents entry are not text where they are marked', () => {
		expect(read(R`Colon{\xe {\v colon biopsy}}, biopsy{\tc {Contents line}}.\par`)).toBe('<p>Colon, biopsy.</p>');
	});

	it('half of a hidden surrogate pair leaves no replacement character behind', () => {
		expect(read(`a{\\v ${u(-10179)}}b\\par`)).toBe('<p>ab</p>');
	});
});

describe('footnotes (issue 21, item 7)', () => {
	it('a footnote does not split its sentence: its text goes to the end, after the number it is referred to by', () => {
		const html = read(R`benign{\super\chftn}{\footnote\pard\plain {\super\chftn} See addendum.\par} and margins are clear.\par Next paragraph.\par`);
		expect(html).toBe('<p>benign<sup>1</sup> and margins are clear.</p>\n<p>Next paragraph.</p>\n<p><sup>1</sup> See addendum.</p>');
	});

	it('Word nests the note inside the group of its reference mark', () => {
		const html = read(R`one{\super\chftn{\footnote\pard\plain\fs20{\super\chftn} first note}} two{\super\chftn{\footnote\pard\plain\fs20{\super\chftn} second note}}.\par`);
		expect(html).toBe(
			'<p>one<sup>1</sup> two<sup>2</sup>.</p>\n' +
				'<p><sup><span style="font-size:10pt">1</span></sup><span style="font-size:10pt"> first note</span></p>\n' +
				'<p><sup><span style="font-size:10pt">2</span></sup><span style="font-size:10pt"> second note</span></p>'
		);
	});

	it('a note with no number of its own is kept, without one', () => {
		expect(read(R`benign{\footnote\pard\plain See addendum.\par} and clear.\par`)).toBe('<p>benign and clear.</p>\n<p>See addendum.</p>');
	});

	it('in a table cell the note does not take the cell out of its table', () => {
		const html = read(R`\trowd\cellx3000\cellx6000\pard\intbl A{\super\chftn}{\footnote\pard\plain{\super\chftn} note}\cell B\cell\row\pard after\par`);
		expect(html).toBe(`${TABLE}<tr>${cell('A<sup>1</sup>', '50.0')}${cell('B', '50.0')}</tr></table>\n<p>after</p>\n<p><sup>1</sup> note</p>`);
	});

	it('the note keeps its own formatting, and the text after it keeps the text\'s', () => {
		const html = read(R`\qc\b bold{\footnote\pard\plain\i note\par} still bold\b0\par`);
		expect(html).toBe('<p style="text-align:center"><strong>bold still bold</strong></p>\n<p><em>note</em></p>');
	});

	it('a note that does not reset its formatting is not raised with its reference mark', () => {
		expect(read(R`text{\super\chftn{\footnote plain note}}\par`)).toBe('<p>text<sup>1</sup></p>\n<p>plain note</p>');
	});

	it('a table inside a note stays in the note', () => {
		const html = read(R`text{\footnote\pard\plain\trowd\cellx3000\intbl in note\cell\row} more\par`);
		expect(html).toBe(`<p>text more</p>\n${TABLE}<tr>${cell('in note', '100.0')}</tr></table>`);
	});
});

describe('text boxes, floating pictures and embedded objects (issue 21, item 11)', () => {
	it('the text of a text box is kept, as paragraphs after the one it is anchored in', () => {
		const html = read(
			R`Before {\shp{\*\shpinst\shpleft0{\sp{\sn shapeType}{\sv 202}}{\shptxt \pard\plain TEXT IN BOX\par second line\par}}{\shprslt{\pard fallback copy\par}}}after\par Next\par`
		);
		expect(html).toBe('<p>Before after</p>\n<p>TEXT IN BOX</p>\n<p>second line</p>\n<p>Next</p>');
	});

	it('a text box anchored in a table cell is kept after the table', () => {
		const html = read(R`\trowd\cellx3000\pard\intbl A{\shp{\*\shpinst{\shptxt \pard\plain boxed\par}}}\cell\row\pard after\par`);
		expect(html).toBe(`${TABLE}<tr>${cell('A', '100.0')}</tr></table>\n<p>boxed</p>\n<p>after</p>`);
	});

	it('two boxes in one drawing are read in order', () => {
		const html = read(R`x{\shp{\*\shpinst{\shpgrp{\shp{\*\shpinst{\shptxt \pard one\par}}}{\shp{\*\shpinst{\shptxt \pard two\par}}}}}}\par`);
		expect(html).toBe('<p>x</p>\n<p>one</p>\n<p>two</p>');
	});

	it('a picture with text wrapped around it is shown where it is anchored', () => {
		const html = read(R`Text {\shp{\*\shpinst\shpleft0{\sp{\sn pib}{\sv ${picture}}}{\sp{\sn fillBlip}{\sv ${picture}}}}} more\par`);
		expect(html.match(/<img /g)?.length).toBe(1);
		expect(html.replace(/<img [^>]*>/, '[img]')).toBe('<p>Text [img] more</p>');
	});

	it('an embedded object shows what it carries to be shown, not its data', () => {
		expect(read(R`Total {\object\objemb{\*\objclass Excel.Sheet.12}{\*\objdata 0105000002000000}{\result 42 cases}} seen\par`)).toBe('<p>Total 42 cases seen</p>');
	});
});

describe('binary picture data (issue 21, item 12)', () => {
	it('a brace in binary data does not end the document', () => {
		expect(read('Before {\\pict\\wmetafile8\\bin5 ab}cd} After\\par Next\\par')).toBe('<p>Before  After</p>\n<p>Next</p>');
	});

	it('a count past the end of the file, or of zero, does not throw', () => {
		expect(read('a{\\pict\\bin999999 xyz')).toBe('<p>a</p>');
		expect(read('a{\\pict\\bin0 }b\\par')).toBe('<p>ab</p>');
	});
});

describe('line and paragraph separators (issue 21, item 13)', () => {
	it('U+2028, which TextEdit writes for Shift-Return, is a line break', () => {
		expect(read(`Line one${u(8232)}Line two\\par`)).toBe('<p>Line one<br>Line two</p>');
		expect(read(`\\uc0 Line one${u(8232, '')} Line two${String.fromCharCode(0x2028)}Line three\\par`)).toBe('<p>Line one<br>Line two<br>Line three</p>');
	});

	it('U+2029 ends the paragraph', () => {
		expect(read(`\\qc One${u(8233)}Two\\par`)).toBe('<p style="text-align:center">One</p>\n<p style="text-align:center">Two</p>');
	});

	it('what was read is written back as a line break', () => {
		const html = read(`a${u(8232)}b\\par`);
		expect(htmlToRtf(el(html))).toContain('a\\line b\\par');
	});
});

describe('alignment (issue 21, item 16)', () => {
	it('holds for every paragraph until \\pard, as Word and TextEdit state it once', () => {
		expect(read(R`\qc One\par Two\par Three\par\pard Four\par`)).toBe(
			'<p style="text-align:center">One</p>\n<p style="text-align:center">Two</p>\n<p style="text-align:center">Three</p>\n<p>Four</p>'
		);
	});

	it('set inside a group, it ends with the group, like an indent', () => {
		expect(read(R`{\qr One\par}Two\par`)).toBe('<p style="text-align:right">One</p>\n<p>Two</p>');
	});

	it('set in a group that closes before the paragraph mark, it is still that paragraph\'s, and no other\'s', () => {
		// As Apple's reader shows it, and as this one did while alignment was not kept with the group.
		expect(read(R`{\qc Title}\par Next\par`)).toBe('<p style="text-align:center">Title</p>\n<p>Next</p>');
		expect(read(R`\trowd\cellx3000\cellx6000\intbl{\qr 1.0}\cell x\cell\row`)).toBe(
			`${TABLE}<tr>${cell('1.0', '50.0', ';text-align:right')}${cell('x', '50.0')}</tr></table>`
		);
	});

	it('every cell of a row written with one \\pard\\qr is right-aligned', () => {
		const right = ';text-align:right';
		expect(read(R`\trowd\cellx2000\cellx4000\cellx6000\pard\qr\intbl 1.0\cell 2.0\cell 3.0\cell\row\pard after\par`)).toBe(
			`${TABLE}<tr>${cell('1.0', '33.33', right)}${cell('2.0', '33.34', right)}${cell('3.0', '33.33', right)}</tr></table>\n<p>after</p>`
		);
	});

	it('a row leaves its alignment behind: the paragraph after a table with no \\pard is not the cell\'s', () => {
		expect(read(R`\trowd\cellx6000\qc\intbl mid\cell\row after\par`)).toBe(
			`${TABLE}<tr>${cell('mid', '100.0', ';text-align:center')}</tr></table>\n<p>after</p>`
		);
	});

	it('a cell as this writer wrote it up to 1.9.0, its paragraph ended inside a group, keeps its alignment', () => {
		const old = R`{\trowd\trgaph120\cellx4320\cellx8640\trkeep\intbl{{\pard\intbl\qr \f0 \sa0 \li0 \fi0 1.0\par}\cell{\pard\intbl \f0 \sa0 \li0 \fi0 x\par}\cell}\intbl\row}`;
		expect(read(old)).toBe(`${TABLE}<tr>${cell('1.0', '50.0', ';text-align:right')}${cell('x', '50.0')}</tr></table>`);
	});
});

describe('tables that follow each other (issue 21, item 17)', () => {
	it('\\lastrow ends a table: the rows after it are another table, with its own columns', () => {
		const html = read(R`\trowd\cellx3000\cellx6000\intbl a\cell b\cell\lastrow\row\trowd\cellx2000\cellx4000\cellx6000\intbl c\cell d\cell e\cell\row\pard after\par`);
		expect(html).toBe(
			`${TABLE}<tr>${cell('a', '50.0')}${cell('b', '50.0')}</tr></table>\n` +
				`${TABLE}<tr>${cell('c', '33.33')}${cell('d', '33.34')}${cell('e', '33.33')}</tr></table>\n<p>after</p>`
		);
	});

	it('Word states \\lastrow in the row definition, before the cells and again before \\row', () => {
		const row = (def: string, cells: string) => `\\trowd${def}\\pard\\intbl ${cells}\\pard\\intbl{\\trowd${def}\\row}`;
		const html = read(row(R`\cellx3000\cellx6000`, R`a\cell b\cell `) + row(R`\lastrow\cellx3000\cellx6000`, R`c\cell d\cell `) + row(R`\lastrow\cellx6000`, R`wide\cell `));
		expect(html.match(/<table/g)?.length).toBe(2);
		expect(html).not.toContain('colspan');
	});

	it('this writer says where each of its tables ends, so two of them come back as two', () => {
		const html = rtfToHtml(htmlToRtf(el('<table><tr><td>a</td></tr><tr><td>b</td></tr></table><table><tr><td>c</td><td>d</td></tr></table>')));
		expect(html).toBe(
			`${TABLE}<tr>${cell('a', '100.0')}</tr><tr>${cell('b', '100.0')}</tr></table>\n${TABLE}<tr>${cell('c', '50.0')}${cell('d', '50.0')}</tr></table>`
		);
	});
});

describe('a rule under a cell (issue 21, item 18)', () => {
	const header = (text: string) => `<th style="border-bottom:1px solid;padding:2px 6px;text-align:left;width:100.0%">${text}</th>`;

	it('a bottom border with a width or a color is a line someone drew, not a header cell', () => {
		// A signature line, as Word and as TextEdit write the border.
		expect(read(R`\trowd\clbrdrb\brdrs\brdrw10\cellx6000\pard\intbl Jane Roe, MD\cell\row`)).toBe(`${TABLE}<tr>${cell('Jane Roe, MD', '100.0')}</tr></table>`);
		expect(read(R`\trowd\clbrdrb\brdrs\brdrw20\brdrcf1\cellx6000\pard\intbl Jane Roe, MD\cell\row`)).toBe(`${TABLE}<tr>${cell('Jane Roe, MD', '100.0')}</tr></table>`);
		expect(read(R`\trowd\clbrdrb\brdrdb\cellx6000\pard\intbl Total\cell\row`)).toBe(`${TABLE}<tr>${cell('Total', '100.0')}</tr></table>`);
	});

	it('the bare border this writer marks a header cell with is still a header cell', () => {
		expect(read(R`\trowd\clbrdrb\brdrs\cellx6000\pard\intbl Marker\cell\row`)).toBe(`${TABLE}<tr>${header('Marker')}</tr></table>`);
		// A width on another cell's border, or on the side before it, is not this cell's.
		expect(read(R`\trowd\clbrdrt\brdrnone\brdrw10\clbrdrb\brdrs\cellx6000\pard\intbl Marker\cell\row`)).toBe(`${TABLE}<tr>${header('Marker')}</tr></table>`);
	});
});

describe('characters in the file itself (issue 21, items 19 and 29)', () => {
	it('a tab character is a tab, as \\tab is: TextEdit writes every tab that way', () => {
		expect(read('Name:\tValue\\par')).toBe(read(R`Name:\tab Value\par`));
		expect(read('Name:\tValue\\par')).toBe('<p>Name:<span style="white-space:pre">\t</span>Value</p>');
	});

	it('a tab character after a list number opens a list item, as \\tab does', () => {
		expect(read('\\pard\\fi-360\\li720 1.\tfirst\\par')).toBe('<ol><li>first</li></ol>');
	});

	it('other control characters are not text', () => {
		expect(read('a\x00b\x0bc\x1cd\x7fe\\par')).toBe('<p>abcde</p>');
	});

	it('a byte-order mark or blank lines before the document do not hide its color and font tables', () => {
		const doc = R`{\rtf1\ansi\deff0{\fonttbl{\f0\fswiss Arial;}{\f1\fmodern Courier New;}}{\colortbl;\red255\green0\blue0;}\cf1 red\cf0  {\f1 code}\par}`;
		const expected = '<p><span style="color:rgb(255,0,0)">red</span> <code>code</code></p>';
		expect(rtfToHtml(doc)).toBe(expected);
		expect(rtfToHtml(`${String.fromCharCode(0xfeff)}${doc}`)).toBe(expected);
		expect(rtfToHtml(`\r\n\r\n \t${doc}`)).toBe(expected);
		// The three bytes of a UTF-8 mark, read as Windows-1252.
		expect(rtfToHtml(`${String.fromCharCode(0xef, 0xbb, 0xbf)}${doc}`)).toBe(expected);
	});

	it('text before the first group is still text', () => {
		expect(rtfToHtml(R`loose {\b bold}\par`)).toBe('<p>loose <strong>bold</strong></p>');
	});
});

describe('pictures and captions (issue 21, items 10 and 28)', () => {
	it('two pictures in one paragraph stay a paragraph of two pictures, through a save', () => {
		const html = read(`${picture}${picture}\\par`);
		expect(html.startsWith('<p><img ')).toBe(true);
		expect(html.match(/<img /g)?.length).toBe(2);
		const again = rtfToHtml(htmlToRtf(el(html)));
		expect(again.match(/<img /g)?.length).toBe(2);
		expect(again).toBe(html);
	});

	it('one picture alone is still a figure', () => {
		expect(read(`${picture}\\par`).startsWith('<figure><img ')).toBe(true);
	});

	it('a "$" in a caption is text', () => {
		const html = read(`${picture}\\par{\\*\\inkcap}\\pard\\i Cells $<5, $& and $1 and $' and $\`\\i0\\par`);
		expect(html.replace(/<img [^>]*>/, '[img]')).toBe("<figure>[img]<figcaption>Cells $&lt;5, $&amp; and $1 and $' and $`</figcaption></figure>");
	});

	it('a caption italic in two places keeps both: only one pair of italics around all of it is the caption\'s own', () => {
		const html = read(`${picture}\\par{\\*\\inkcap}\\pard{\\i a} b {\\i c}\\par`);
		expect(html).toContain('<figcaption><em>a</em> b <em>c</em></figcaption>');
		expect(read(`${picture}\\par{\\*\\inkcap}\\pard\\i whole\\i0\\par`)).toContain('<figcaption>whole</figcaption>');
	});

	it('a picture someone dragged to half size is shown at half its placed size', () => {
		const html = read(R`{\pict\pngblip\picw200\pich100\picwgoal3000\pichgoal1500\picscalex50\picscaley50 ${PNG}}\par`);
		expect(html).toContain('style="width:100px;height:auto"');
		// With no scale, or a scale of nothing, the placed size is the size.
		expect(read(R`{\pict\pngblip\picw200\pich100\picwgoal3000\pichgoal1500\picscalex0 ${PNG}}\par`)).toContain('style="width:200px;height:auto"');
	});
});

describe('smaller things Word writes', () => {
	it('a space before the line of dashes does not stop it being a rule', () => {
		// What a pasted document gives: a space between two wrappers, written in front of the rule.
		// (Two spaces here: the first only ends the control word before it.)
		const dashes = '\\emdash'.repeat(20);
		expect(read(`\\trowd\\cellx6000\\intbl a\\cell\\row  \\pard\\qc ${dashes}  \\par`)).toBe(`${TABLE}<tr>${cell('a', '100.0')}</tr></table>\n<hr>`);
		expect(read(`x\\par  \\pard\\qc ${dashes}\\par`)).toBe('<p>x</p>\n<hr>');
		// A document that had one settles in one reload.
		const html = '<b style="font-weight:normal"><p>a</p></b>\n<b style="font-weight:normal"><hr><p>b</p></b>';
		const second = htmlToRtf(el(rtfToHtml(htmlToRtf(el(html)))));
		expect(htmlToRtf(el(rtfToHtml(second)))).toBe(second);
		expect(rtfToHtml(htmlToRtf(el(html)))).toBe('<p>a</p>\n<hr>\n<p>b</p>');
	});

	it('a column break is a line break, and a quarter-em space is a space of that width', () => {
		expect(read(R`a\column b\qmspace c\par`)).toBe(`<p>a<br>b${String.fromCharCode(0x2005)}c</p>`);
	});
});

describe('found by a second reader of this change', () => {
	it('a footnote in hidden or deleted text is not shown, whatever \\plain inside it resets, and takes no number', () => {
		const html = read(
			R`Text{\v{\super\chftn}{\footnote\pard\plain{\super\chftn} Hidden note}} more{\deleted{\super\chftn}{\footnote\pard\plain{\super\chftn} Deleted note}}{\super\chftn}{\footnote\pard\plain{\super\chftn} Real note}\par`
		);
		expect(html).toBe('<p>Text more<sup>1</sup></p>\n<p><sup>1</sup> Real note</p>');
	});

	it('a table in a footnote or a text box leaves the paragraph around it as it was', () => {
		const note = read(R`\qc Centered{\footnote \pard\plain \trowd\cellx1000\intbl A\cell\row\pard note\par} more\par`);
		expect(note.startsWith('<p style="text-align:center">Centered more</p>\n<table')).toBe(true);
		const box = read(R`\pard\li720\fi-360 \bullet\tab Item{\shp{\*\shpinst{\shptxt \trowd\cellx1000\intbl A\cell\row}}} more\par`);
		expect(box.startsWith('<ul><li>Item more</li></ul>')).toBe(true);
	});

	it('a control character written as an escape is not text either; an escaped tab is a tab', () => {
		const tab = '<span style="white-space:pre">\t</span>';
		expect(read(R`A\'1c\'0b\'07\'7fB` + `${u(11)}${u(28)}${u(127)}C\\'09D${u(9)}E\\par`)).toBe(`<p>ABC${tab}D${tab}E</p>`);
	});

	it('a tab between the words of a link field does not lose the link', () => {
		expect(read('{\\field{\\*\\fldinst HYPERLINK\t"https://x.test/"}{\\fldrslt link}}\\par')).toBe(
			'<p><a href="https://x.test/" target="_blank" rel="noopener noreferrer">link</a></p>'
		);
	});

	it('a Unicode character in the Symbol font is itself; only a byte, or Word\'s U+F0xx, is a place in the font', () => {
		// The micro sign, then the letter m: Apple's reader shows the first as it is too.
		expect(read(`{\\f2 ${u(181)}m}\\par`)).toBe('<p>µμ</p>');
	});

	it('a font size no reader accepts is kept within what one does', () => {
		expect(read(R`\fs999999999999999999999999 x\par`)).toBe('<p><span style="font-size:1638pt">x</span></p>');
	});
});

describe('files built to freeze or exhaust the page (issue 21, items 25 to 27)', () => {
	const timed = (run: () => void) => {
		const start = performance.now();
		run();
		return performance.now() - start;
	};

	it('400,000 spaces in a paragraph read in well under a second', () => {
		let html = '';
		const ms = timed(() => (html = read(`a${' '.repeat(400_000)}b\\par`)));
		expect(html.length).toBe('<p>a</p>'.length + 400_001);
		expect(ms).toBeLessThan(1000);
	});

	it('100,000 tabs in a paragraph read in well under two seconds, each of them a tab', () => {
		let html = '';
		const ms = timed(() => (html = read(`${'\t'.repeat(100_000)}b\\par`)));
		expect(html.match(/white-space:pre/g)?.length).toBe(100_000);
		expect(ms).toBeLessThan(2000);
	});

	it('a row of 50,000 cells merged down takes about as long to read as the same row not merged', () => {
		// Timed against the same two rows without the merge, not against the clock: a build
		// machine can be several times slower than a desk, and both readings slow down together.
		// Through 1.9.0 the merged rows took 17 to 80 times as long; now about the same.
		const n = 50_000;
		const definition = (flag: string) => Array.from({ length: n }, (_, i) => `${flag}\\cellx${(i + 1) * 100}`).join('');
		const rows = (first: string, second: string) =>
			`\\trowd${definition(first)}\\intbl ${'x\\cell '.repeat(n)}\\row\\trowd${definition(second)}\\intbl ${'\\cell '.repeat(n)}\\row`;
		let html = '';
		// The faster of two readings each, so that one pause of the machine does not decide it.
		const fastest = (rtf: string) => Math.min(timed(() => (html = read(rtf))), timed(() => (html = read(rtf))));
		const plain = fastest(rows('', ''));
		const merged = fastest(rows('\\clvmgf', '\\clvmrg'));
		expect(html.match(/rowspan="2"/g)?.length).toBe(n);
		expect(merged).toBeLessThan(plain * 5);
	}, 60_000);

	it('a file of more than five million parts is refused, not read until memory runs out', () => {
		// (Read once: it is the largest file here, and a slow machine has five seconds for a test.)
		let thrown: unknown;
		try {
			rtfToHtml(`{\\rtf1 ${'{}'.repeat(5_000_001)}}`);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(RangeError);
		expect((thrown as Error).message).toMatch(/too complex to show/);
	}, 60_000);

	it('picture data is one part for each line of it: a large picture is not refused', () => {
		const html = rtfToHtml(`{\\rtf1 {\\pict\\pngblip\\picw1\\pich1 ${PNG.repeat(20_000)}}\\par}`);
		expect(html.startsWith('<figure><img ')).toBe(true);
	});
});
