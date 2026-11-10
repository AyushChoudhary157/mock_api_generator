// Visual QA helper: drives the UI in headless Edge/Chrome and saves screenshots to ./shots.
//   node scripts/screenshots.mjs [baseUrl]      (needs the dev server running)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3000';
const EXE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync('shots', { recursive: true });
const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const problems = [];

async function run(name, viewport, steps) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${name}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const shot = async (label, full = true) => {
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: `shots/${name}-${label}.png`, fullPage: full });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`[${name}] horizontal overflow of ${overflow}px at "${label}"`);
  };
  await steps(page, shot);
  await ctx.close();
}

const clickText = async (page, sel, text) => {
  const handle = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t)), sel, text);
  if (!handle.asElement()) throw new Error(`no ${sel} with text "${text}"`);
  await handle.asElement().click();
};

async function flow(page, shot) {
  await shot('1-wizard-step1');
  await page.type('.wiz-form input', 'Demo Shop');
  await page.click('.wiz-form button[type=submit]');
  await page.waitForSelector('.seg');
  await shot('2-wizard-step2');
  await clickText(page, 'button', 'Create resource');
  await page.waitForSelector('.wiz-done');
  await shot('3-wizard-step3');
  await clickText(page, 'button', 'Go to dashboard');
  await page.waitForSelector('.tabs');
  await shot('4-schema');
  await clickText(page, '.tab', 'Data');
  await page.waitForSelector('.data-table');
  await shot('5-data');
  await clickText(page, '.tab', 'Settings');
  await page.waitForSelector('.sim-form');
  await shot('6-settings');
  await clickText(page, '.tab', 'Test');
  await page.waitForSelector('#tt-url');
  await clickText(page, 'button', 'Send request');
  await page.waitForSelector('.pill');
  await shot('7-test');
}

await run('desktop', { width: 1440, height: 900 }, async (page, shot) => {
  await flow(page, shot);
  await page.evaluate(() => document.getElementById('theme-toggle').click());
  await shot('8-test-dark');
  await clickText(page, '.tab', 'Schema');
  await shot('9-schema-dark');
});
await run('mobile', { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }, async (page, shot) => {
  await flow(page, shot);
  await clickText(page, '.tab', 'Schema');
  await page.click('#sb-toggle');
  await shot('8-sidebar-open');
});
await browser.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'No console errors or horizontal overflow.');
