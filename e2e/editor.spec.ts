import { test, expect, type Page } from '@playwright/test';

type Editor = { getHTML(): string; getRTF(): string; getMarkdown(): string; setHTML(html: string): void; focus(): void };
declare global {
	interface Window {
		ed: Editor;
		lib: typeof import('../src/lib/index.js');
		setViewer(rtf: string): void;
		changes: number;
		__ran?: string;
	}
}

async function open(page: Page, query: Record<string, string> = {}): Promise<void> {
	await page.goto(`/e2e?${new URLSearchParams(query)}`);
	await page.waitForFunction(() => !!window.ed && !!window.lib);
}
const html = (page: Page) => page.evaluate(() => window.ed.getHTML());
const body = (rtf: string) => rtf.slice(rtf.indexOf('\\fs24 ') + 6);
const content = '.ink-content';

test.describe('a new document', () => {
	test('the first words typed are a paragraph, and two lines typed are two paragraphs in the RTF', async ({ page }) => {
		await open(page);
		await page.click(content);
		await page.keyboard.type('line one');
		await page.keyboard.press('Enter');
		await page.keyboard.type('line two');
		expect(await html(page)).toBe('<p>line one</p><p>line two</p>');
		expect(body(await page.evaluate(() => window.ed.getRTF()))).toBe('\\pard line one\\par \\pard line two\\par }');
	});

	test('the same when the editor is given the keyboard by focus()', async ({ page }) => {
		await open(page);
		await page.evaluate(() => window.ed.focus());
		await page.keyboard.type('line one');
		await page.keyboard.press('Enter');
		await page.keyboard.type('line two');
		expect(await html(page)).toBe('<p>line one</p><p>line two</p>');
	});

	test('everything selected and typed over leaves a paragraph, not loose text', async ({ page }) => {
		await open(page, { content: '<p>one</p><p>two</p>' });
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('new');
		await page.keyboard.press('Enter');
		await page.keyboard.type('next');
		expect(body(await page.evaluate(() => window.ed.getRTF()))).toBe('\\pard new\\par \\pard next\\par }');
	});
});

test.describe('the link dialog', () => {
	const two = { content: '<p>alpha beta gamma</p><p>second paragraph</p>' };
	async function selectBeta(page: Page): Promise<void> {
		await page.evaluate(() => {
			const text = document.querySelector('.ink-content p')!.firstChild!;
			const range = document.createRange();
			range.setStart(text, 6);
			range.setEnd(text, 10);
			const selection = getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			(document.querySelector('.ink-content') as HTMLElement).focus();
		});
	}

	test('takes the keyboard: an address typed after Ctrl+K goes in the dialog, and Enter makes the link', async ({ page }) => {
		await open(page, two);
		await selectBeta(page);
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.getByRole('dialog', { name: 'Insert Link' })).toBeVisible();
		await page.keyboard.type('https://example.com/');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(await html(page)).toBe('<p>alpha <a href="https://example.com/">beta</a> gamma</p><p>second paragraph</p>');
	});

	test('an address that is refused keeps the dialog open and the document as it was', async ({ page }) => {
		await open(page, two);
		await selectBeta(page);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.type('javascript:alert(1)');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('alert')).toContainText('Enter a web address');
		expect(await html(page)).toBe(two.content);
	});

	test('Escape closes it, hands the keyboard back, and the selection is still there to type over', async ({ page }) => {
		await open(page, two);
		await selectBeta(page);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(await page.evaluate(() => document.activeElement?.className)).toContain('ink-content');
		expect(await html(page)).toBe(two.content);
	});

	test('Tab stays in the dialog', async ({ page }) => {
		await open(page, two);
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+k');
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Tab');
			expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
		}
	});
});

test.describe('HTML from outside', () => {
	const EVIL = '<p>Body</p><img src="x" onerror="window.__ran = \'handler\'"><a href="javascript:window.__ran = \'link\'">l</a>';

	test('the content prop and setHTML run nothing', async ({ page }) => {
		await open(page, { content: EVIL });
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		await page.evaluate((evil) => window.ed.setHTML(evil), EVIL);
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		expect(await html(page)).not.toMatch(/onerror|javascript:/);
	});

	test('a draft in localStorage is not shown unless autosave is on, and runs nothing when it is', async ({ page }) => {
		await open(page);
		await page.evaluate((evil) => {
			localStorage.setItem('ink-editor-content', evil);
			localStorage.setItem('report-7', evil);
		}, EVIL);
		await open(page, { content: '<p>From the host</p>' });
		expect(await html(page)).toBe('<p>From the host</p>');
		await open(page, { autosave: '1', key: 'report-7', content: '<p>From the host</p>' });
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		expect(await html(page)).toContain('<p>Body</p>');
	});

	test('marks the application named stay on what it sets and on a paste, and nothing else does', async ({ page }) => {
		const MARKED = '<p data-section="A" data-other="x" class="summary wide" onclick="window.__ran = 1">Marked</p>';
		await open(page, { content: MARKED, keepAttributes: 'data-section,onclick', keepClasses: 'summary' });
		expect(await html(page)).toBe('<p data-section="A" class="summary">Marked</p>');
		await page.evaluate(async (pasted) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted.replace('Marked', 'Pasted')], { type: 'text/html' }) })]);
		}, MARKED);
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(`${content} [data-section="A"]`)).toHaveText('Pasted');
		expect(await html(page)).not.toMatch(/data-other|onclick|wide/);
		await page.locator(`${content} [data-section="A"]`).click();
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		// And with nothing named, the same paste keeps neither.
		await open(page);
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(content)).toContainText('Pasted');
		expect(await html(page)).not.toMatch(/data-section|class=/);
	});

	test('a paste cannot cover the page, and brings no form, frame or script', async ({ page }) => {
		await open(page);
		await page.evaluate(async () => {
			const pasted =
				'<p onclick="window.__ran = 1">para</p><iframe src="https://example.com/"></iframe><form action="https://example.com/"><input name="q"><button>b</button></form>' +
				'<svg onload="window.__ran = 2"></svg><div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;color:red">overlay</div><a href="https://example.com/">ok</a>';
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted], { type: 'text/html' }) })]);
		});
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(`${content} a`)).toHaveCount(1);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		expect(await page.locator(`${content} :is(iframe, input, button, svg, script)`).count()).toBe(0);
		const overlay = page.locator(content).getByText('overlay');
		expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe('static');
		expect(await overlay.evaluate((el) => (el as HTMLElement).style.color)).toBe('red');
	});

	test('a hostile RTF file shows as text in the viewer', async ({ page }) => {
		await open(page);
		await page.evaluate(() =>
			window.setViewer(
				String.raw`{\rtf1\ansi{\field{\*\fldinst HYPERLINK "javascript:window.__ran=6"}{\fldrslt click}} <img src=x onerror=window.__ran=7> \u60?script\u62?window.__ran=8\u60?/script\u62?\par}`
			)
		);
		await expect(page.locator('.rtf-viewer')).toContainText('click');
		expect(await page.locator('.rtf-viewer :is(a, img, script)').count()).toBe(0);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
	});
});

test.describe('what a review of these changes found', () => {
	test('a block cannot be drawn over the toolbar with styles a document may have', async ({ page }) => {
		// A margin below zero pulled it up over the toolbar; a width of thousands ran it out
		// over the page beside the editor.
		await open(page, { content: '<p>Report body</p>' });
		await page.evaluate(() =>
			window.ed.setHTML(
				'<p>Report body</p><div style="margin-top:-600px;margin-left:-300px;width:3000px;height:3000px;background-color:red">COVER</div>' +
					'<a href="https://example.com/" style="display:block;margin:-2000px;padding:4000px">all of the page</a>'
			)
		);
		const over = await page.evaluate(() => {
			const bar = document.querySelector('.toolbar')!.getBoundingClientRect();
			const hit = document.elementFromPoint(bar.left + 20, bar.top + 10);
			return hit ? !!hit.closest('.ink-content') : false;
		});
		expect(over).toBe(false);
		expect(await html(page)).not.toMatch(/margin|padding|width|height/);
		// Whatever its styles, nothing in the document is drawn outside the editing area.
		const outside = await page.evaluate(() => {
			window.ed.setHTML('<table style="width:2000px"><tbody><tr><td style="background-color:red">wide</td></tr></tbody></table>');
			const area = document.querySelector('.ink-content')!.getBoundingClientRect();
			const hit = document.elementFromPoint(Math.min(area.right + 30, window.innerWidth - 5), area.top + 60);
			return hit ? !!hit.closest('.ink-content') : false;
		});
		expect(outside).toBe(false);
	});

	test('style text the browser did not read is not passed on', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() =>
			window.lib.sanitizeHtml('<div style="background:url(javascript:alert(1))">a</div><div style="width:expression(alert(1))">b</div><p style="color:red;margin-left:max(10px,5000px)">c</p>')
		);
		expect(out).not.toMatch(/expression|javascript|url\(|max\(/);
		expect(out).toContain('color: red');
	});

	test('what Word hid is hidden on screen as it is in the RTF', async ({ page }) => {
		await open(page, { content: '<p>a<span style="mso-hide:all">SECRET</span>b</p>' });
		expect(await page.locator(content).innerText()).not.toContain('SECRET');
		expect(await page.evaluate(() => window.ed.getRTF())).not.toContain('SECRET');
	});

	test('an empty document counts no characters', async ({ page }) => {
		await open(page);
		await expect(page.getByText('0 words · 0 characters')).toBeVisible();
		await page.click(content);
		await page.keyboard.type('ab');
		await expect(page.getByText('1 word · 2 characters')).toBeVisible();
	});

	test('lists nested 6000 deep, one straight in the next, are written', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() => {
			const root = document.createElement('div');
			let at: HTMLElement = root;
			for (let i = 0; i < 6000; i++) {
				const next = document.createElement(i % 2 ? 'ol' : 'ul');
				at.appendChild(next);
				at = next;
			}
			at.innerHTML = '<li>deep</li>';
			return [window.lib.htmlToRtf(root), window.lib.htmlToMarkdown(root)] as const;
		});
		expect(out[0]).toContain('deep');
		expect(out[1]).toContain('deep');
	});

	test('a button that does something once is not announced as a toggle', async ({ page }) => {
		await open(page);
		await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).not.toHaveAttribute('aria-pressed', /.*/);
		await expect(page.getByRole('button', { name: 'Bold (Ctrl+B)' })).toHaveAttribute('aria-pressed', 'false');
	});

	test('the words in a formula and a text box stay when the element goes', async ({ page }) => {
		await open(page, { content: '<p>Ki-67 <math><mn>30</mn><mo>%</mo></math>, note <textarea>margins clear</textarea></p>' });
		expect(await html(page)).toBe('<p>Ki-67 30%, note margins clear</p>');
	});
});

test.describe('what a second review found', () => {
	// What only a real browser shows of the fixes in sanitize.ts: where text is drawn, what a
	// paste brings, an id as a name on `window`. Invented text.
	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
	const rtfBody = (page: Page) => page.evaluate(() => window.ed.getRTF()).then(body);
	async function paste(page: Page, pasted: string, typedFirst = ''): Promise<void> {
		await open(page);
		await page.evaluate(async (pasted) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted], { type: 'text/html' }) })]);
		}, pasted);
		await page.click(content);
		if (typedFirst) await page.keyboard.type(typedFirst);
		await page.keyboard.press('ControlOrMeta+v');
	}

	test('words hidden in a button or a text box are not shown and not written', async ({ page }) => {
		await open(page);
		await page.evaluate(() =>
			window.ed.setHTML(
				'<p>Press <button>Sign<span style="display:none">SECRET</span></button></p><p>a<input hidden value="HIDDENINPUT">b</p>' +
					'<p>c<textarea style="display:none">HIDDENTEXT</textarea>d</p><p>e<math style="display:none"><mn>42</mn></math>f</p>'
			)
		);
		expect(await html(page)).toBe('<p>Press Sign</p><p>ab</p><p>cd</p><p>ef</p>');
		expect(await rtfBody(page)).toBe('\\pard Press Sign\\par \\pard ab\\par \\pard cd\\par \\pard ef\\par }');
	});

	test('a list read from RTF is written back at the indent it had', async ({ page }) => {
		await open(page);
		const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 \pard\li720\fi-360\bullet\tab a\par \pard\li1080\fi-360\bullet\tab b\par \pard\li360\fi-360\bullet\tab c\par }`;
		const read = await page.evaluate((rtf) => {
			const parsed = window.lib.rtfToHtml(rtf);
			window.ed.setHTML(parsed);
			return parsed;
		}, rtf);
		expect(await html(page)).toBe(read);
		expect(await rtfBody(page)).toBe('\\pard\\li720\\fi-360\\bullet\\tab a\\par \\pard\\li1080\\fi-360\\bullet\\tab b\\par \\pard\\li360\\fi-360\\bullet\\tab c\\par }');
	});

	test('a table border written in one word stays as it was written', async ({ page }) => {
		await open(page);
		const kept = await page.evaluate(() =>
			[
				'<table><tbody><tr><td style="border: 1px solid black">x</td></tr></tbody></table>',
				'<blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;">q</blockquote>',
				'<p style="border-bottom: 2px dotted red; border-top: none">x</p>'
			].map((html) => [html, window.lib.sanitizeHtml(html)])
		);
		for (const [given, got] of kept) expect(got).toBe(given);
		// A border picture is drawn outside its element, and a document has none.
		const picture = await page.evaluate(() => window.lib.sanitizeHtml('<p style="border: 1px solid; border-image: linear-gradient(red, blue) 1 / 1 / 5000px">x</p>'));
		expect(picture).not.toMatch(/gradient|5000|border-image/);
		expect(picture).toMatch(/border-style: solid/);
	});

	test('a document shown again keeps its ids, and an id still cannot stand in for a name of the page', async ({ page }) => {
		await open(page, { content: '<p id="dx-1">first</p>' });
		expect(await page.evaluate(() => 'dx-1' in window)).toBe(true);
		await page.evaluate(() => window.ed.setHTML('<p id="dx-1">again</p><p id="dx-2">new</p>'));
		expect(await html(page)).toBe('<p id="dx-1">again</p><p id="dx-2">new</p>');
		await page.evaluate(() => window.ed.setHTML(window.ed.getHTML()));
		expect(await html(page)).toBe('<p id="dx-1">again</p><p id="dx-2">new</p>');
		await page.evaluate(() => window.ed.setHTML('<a id="appConfig" href="https://evil.test/api">c</a><p id="location">x</p><p id="dx-3">y</p>'));
		expect(await html(page)).toBe('<a href="https://evil.test/api">c</a><p>x</p><p id="dx-3">y</p>');
		expect(await page.evaluate(() => String((window as unknown as Record<string, unknown>).appConfig))).toBe('undefined');
	});

	test('no first line is drawn outside the editing area, and no text has no size', async ({ page }) => {
		await open(page);
		for (const style of ['text-indent:-100%', 'text-indent:-2200px', 'margin-left: 20px; text-indent: -600px']) {
			await page.evaluate((style) => window.ed.setHTML(`<p style="${style}">FIRST LINE</p><p>second</p>`), style);
			const [text, area] = await page.evaluate(() => {
				const editing = document.querySelector('.ink-content')!;
				const range = document.createRange();
				range.selectNodeContents(editing.querySelector('p')!);
				return [range.getBoundingClientRect().left, editing.getBoundingClientRect().left];
			});
			expect(text, style).toBeGreaterThanOrEqual(area);
			expect(await rtfBody(page), style).toContain('FIRST LINE\\par');
			expect(await rtfBody(page), style).not.toContain('\\fi-');
		}
		// A hanging indent is drawn inside, and written.
		await page.evaluate(() => window.ed.setHTML('<p style="margin-left:48px;text-indent:-24px">hang</p>'));
		expect(await rtfBody(page)).toBe('\\pard\\li720\\fi-360 hang\\par }');
		await page.evaluate(() => window.ed.setHTML('<p><span style="font-size:0">INVISIBLE</span>seen</p>'));
		const box = await page.locator(`${content} span`).boundingBox();
		expect(box!.width).toBeGreaterThan(20);
		expect(box!.height).toBeGreaterThan(8);
	});

	test('a pasted span that only Word hid is not pasted as words', async ({ page }) => {
		await paste(page, '<p>one <span style="mso-hide:all">HID ONE</span> two</p><p style="mso-hide:all">whole para</p><p>three</p>');
		await expect(page.locator(content)).toContainText('three');
		expect(await html(page)).toBe('<p>one two</p><p>three</p>');
		// As Word writes a copy: styles in the head, the copied part marked.
		await paste(
			page,
			'<html><head><style>p.MsoNormal{margin:0in;font-size:11pt}</style></head><body><!--StartFragment--><p class=MsoNormal>Shown <span style=\'mso-hide:all\'>hidden words</span>text</p><!--EndFragment--></body></html>'
		);
		await expect(page.locator(content)).toContainText('text');
		expect(await page.locator(content).textContent()).toBe('Shown text');
	});

	test('after such a paste the caret is where the paste ended', async ({ page }) => {
		await paste(page, '<span style="mso-hide:all">all hidden</span>', 'x');
		await page.waitForTimeout(100);
		expect(await html(page)).toBe('<p>x</p>');
		await page.keyboard.type('y');
		expect(await html(page)).toBe('<p>xy</p>');
		// And inside a line, between what was there.
		await paste(page, 'in<span style="mso-hide:all">HIDDEN</span>side', 'ab');
		await expect(page.locator(content)).toContainText('side');
		await page.keyboard.type('!');
		expect(await html(page)).toBe('<p>abinside!</p>');
		// A paste that ends in a hidden paragraph, or is nothing else, leaves an empty line
		// with the caret in it.
		await paste(page, '<p>one</p><p style="mso-hide:all">whole para</p>');
		await expect(page.locator(content)).toContainText('one');
		await expect.poll(() => html(page)).toBe('<p>one</p><p><br></p>');
		await page.keyboard.type('two');
		expect(await html(page)).toBe('<p>one</p><p>two</p>');
		await paste(page, '<p style="mso-hide:all">all hidden</p>');
		await expect.poll(() => html(page)).toBe('<p><br></p>');
		await page.keyboard.type('typed');
		expect(await html(page)).toBe('<p>typed</p>');
	});

	test('a text box pasted last keeps its words', async ({ page }) => {
		await paste(page, '<p>note <textarea>margins clear</textarea></p>');
		await expect(page.locator(content)).toContainText('note');
		expect(await html(page)).toBe('<p>note margins clear</p>');
	});

	test('a link with padding does not cover the lines above it', async ({ page }) => {
		await open(page);
		await page.evaluate(() => window.ed.setHTML('<p>Report body, first paragraph</p><p><a href="https://example.com/" style="padding:2200px">link</a></p><p>last</p>'));
		const first = page.locator(`${content} p`).first();
		const box = (await first.boundingBox())!;
		const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.tagName, [box.x + 40, box.y + box.height / 2]);
		expect(hit).toBe('P');
		await page.evaluate(() => window.ed.setHTML('<table width="100000"><tbody><tr><td>x</td></tr></tbody></table>'));
		expect((await page.locator(`${content} table`).boundingBox())!.width).toBeLessThan(2300);
	});

	test('the frame around a picture is not drawn outside the editing area', async ({ page }) => {
		await open(page);
		await page.evaluate((png) => {
			// Room to the left of the editor, where the frame used to be drawn.
			document.body.style.paddingLeft = '300px';
			window.ed.setHTML(`<table style="width:2000px"><tbody><tr><td><img src="${png}" style="width:200px;height:120px"></td><td>wide</td></tr></tbody></table>`);
		}, PNG);
		await page.click(`${content} img`);
		const frame = page.locator('.ink-img-frame');
		await expect(frame).toBeVisible();
		const area = (await page.locator(content).boundingBox())!;
		expect((await frame.boundingBox())!.width).toBeCloseTo(200, 0);
		// Part of the picture scrolled out: the frame is over the part still in view.
		const pictureLeft = (await page.locator(`${content} img`).boundingBox())!.x - area.x;
		await page.evaluate((by) => (document.querySelector('.ink-content')!.scrollLeft = by), pictureLeft + 80);
		await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(120);
		expect((await frame.boundingBox())!.x).toBeGreaterThanOrEqual(area.x - 0.5);
		// All of it scrolled out: no frame, and no tools.
		await page.evaluate((by) => (document.querySelector('.ink-content')!.scrollLeft = by), pictureLeft + 400);
		await expect(frame).toHaveCount(0);
		// Scrolled back, it is around the whole picture again.
		await page.evaluate(() => (document.querySelector('.ink-content')!.scrollLeft = 0));
		await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBe(200);
	});

	test('style text the browser did not read is not passed on behind a short form and one of its parts', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() =>
			[
				'<p style="margin: 0; margin-left: expr/**/ession(alert(1))">x</p>',
				'<p style="border: expr/**/ession(alert(1)); border-top-color: red">x</p>',
				'<p style="margin: 0 0 0 -9999px junk; margin-top: 1px">x</p>'
			].map((html) => window.lib.sanitizeHtml(html))
		);
		for (const html of out) expect(html).not.toMatch(/expr|ession|junk|9999/);
		expect(out[1]).toContain('border-top-color: red');
		expect(out[2]).toContain('margin-top: 1px');
		// Both read: left as written.
		const both = '<p style="margin: 0; margin-left: 4px">x</p>';
		expect(await page.evaluate((html) => window.lib.sanitizeHtml(html), both)).toBe(both);
	});

	test('a formula written twice is read once, and two boxes side by side are two words', async ({ page }) => {
		await open(page);
		await page.evaluate(() =>
			window.ed.setHTML(
				'<p>Ki-67 <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mn>30</mn><mi mathvariant="normal">%</mi></mrow><annotation encoding="application/x-tex">30\\%</annotation></semantics></math></span>' +
					'<span class="katex-html" aria-hidden="true"><span class="mord">30</span><span class="mord">%</span></span></span> positive</p><p>Size <input value="1"><input value="5"> cm</p>'
			)
		);
		expect(await rtfBody(page)).toBe('\\pard Ki-67 30% positive\\par \\pard Size 1 5 cm\\par }');
	});
});

test.describe('the writers', () => {
	test('numbers stay in range in a real browser', async ({ page }) => {
		await open(page);
		const rtf = await page.evaluate(() => {
			const div = document.createElement('div');
			div.innerHTML =
				'<font color="#abcd">a</font><font color="rgb(999,0,0)">c</font><span style="font-size:99999pt">d</span><p style="margin-left:99999999px">e</p>' +
				'<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="99999999999">';
			return window.lib.htmlToRtf(div);
		});
		expect(rtf).not.toMatch(/NaN|\\[a-z]+\d{6,}/);
		expect(rtf).toContain('\\red255\\green0\\blue0;');
	});

	test('elements nested 6000 deep are written', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() => {
			const root = document.createElement('div');
			let at: HTMLElement = root;
			for (let i = 0; i < 6000; i++) {
				const next = document.createElement(i % 2 ? 'span' : 'b');
				at.appendChild(next);
				at = next;
			}
			at.textContent = 'deep';
			return [window.lib.htmlToRtf(root), window.lib.htmlToMarkdown(root), window.lib.estimateRtfBytes(root)] as const;
		});
		expect(out[0]).toContain('deep');
		expect(out[1]).toContain('deep');
		expect(out[2]).toBeGreaterThanOrEqual(out[0].length);
	});

	test('typing does not read the whole document for a handler that does not ask for it', async ({ page }) => {
		await open(page, { onchange: '1' });
		const ms = await page.evaluate(async () => {
			const canvas = document.createElement('canvas');
			canvas.width = 900;
			canvas.height = 700;
			const g = canvas.getContext('2d')!;
			const data = g.createImageData(900, 700);
			for (let i = 0; i < data.data.length; i++) data.data[i] = i % 4 === 3 ? 255 : Math.random() * 255;
			g.putImageData(data, 0, 0);
			const url = canvas.toDataURL('image/jpeg', 0.92);
			window.ed.setHTML('<p>Body</p>' + `<figure><img src="${url}" style="width:300px"><figcaption>f</figcaption></figure>`.repeat(8));
			const p = document.querySelector('.ink-content p')!;
			const range = document.createRange();
			range.selectNodeContents(p);
			range.collapse(false);
			getSelection()!.removeAllRanges();
			getSelection()!.addRange(range);
			(document.querySelector('.ink-content') as HTMLElement).focus();
			const times: number[] = [];
			for (let i = 0; i < 9; i++) {
				const t = performance.now();
				document.execCommand('insertText', false, 'x');
				times.push(performance.now() - t);
				await new Promise((r) => requestAnimationFrame(r));
			}
			return times.sort((a, b) => a - b)[4];
		});
		expect(await page.evaluate(() => window.changes)).toBeGreaterThan(0);
		// It was 116 ms with these eight pictures; it is a few now. Wide enough for a slow machine.
		expect(ms).toBeLessThan(40);
	});
});
