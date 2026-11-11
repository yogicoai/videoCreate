// 사용자가 보는 Edge 창을 Claude가 천천히 움직이는 도구. 생성 호출은 넣지 않는다.
//
// 창 띄우기(Git Bash, 백그라운드로):
//   "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --remote-debugging-port=9333 \
//     --user-data-dir="$(cygpath -w "$PWD/data/.edge-demo")" --no-first-run --no-default-browser-check \
//     --window-position=60,30 --window-size=1560,960 "http://127.0.0.1:6800/"
//
// 쓰는 법: 시연 스크립트에서 connect()로 붙고, caption()으로 자막을 띄우며 clickOn()으로 누른다.
// 끝낼 때 browser.close()를 불러도 창은 닫히지 않고 연결만 끊긴다.
// 사용자가 그 창을 직접 쓰는 중이면 가로채지 않는다.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${ROOT}/`);
const { chromium } = require('playwright-core');

export const BASE = 'http://127.0.0.1:6800';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = { x: 700, y: 400 };

export async function connect() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const context = browser.contexts()[0];
  const page = context.pages().find((p) => p.url().startsWith(BASE)) ?? context.pages()[0];
  await page.bringToFront();
  await install(page);
  return { browser, page };
}

/** 노란 마우스 표시와 자막을 넣는다. 앱 화면과 헷갈리지 않게 자막은 "시연 ·"으로 시작한다 */
export async function install(page) {
  await page.evaluate(() => {
    document.getElementById('demo-cursor')?.remove();
    document.getElementById('demo-caption')?.remove();
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.style.cssText =
      'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#fbbf24;border:2px solid #000;box-shadow:0 0 0 3px rgba(251,191,36,.35);z-index:2147483647;pointer-events:none;transition:transform .08s;';
    document.documentElement.appendChild(cursor);
    window.addEventListener(
      'mousemove',
      (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      },
      true,
    );
    window.addEventListener('mousedown', () => (cursor.style.transform = 'scale(.65)'), true);
    window.addEventListener('mouseup', () => (cursor.style.transform = 'scale(1)'), true);
    const box = document.createElement('div');
    box.id = 'demo-caption';
    box.style.cssText =
      'position:fixed;right:16px;top:84px;max-width:420px;padding:10px 14px;border-radius:10px;background:#fbbf24;color:#111;font:600 14px/1.5 Pretendard,"Malgun Gothic",sans-serif;z-index:2147483646;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.5);';
    box.textContent = '';
    box.style.display = 'none';
    document.documentElement.appendChild(box);
  });
}

export async function caption(page, text, wait = 1600) {
  const ready = await page.evaluate(() => !!document.getElementById('demo-caption'));
  if (!ready) await install(page);
  await page.evaluate((value) => {
    const box = document.getElementById('demo-caption');
    box.textContent = `시연 · ${value}`;
    box.style.display = 'block';
  }, text);
  await sleep(wait);
}

export async function moveTo(page, x, y) {
  const steps = Math.max(10, Math.round(Math.hypot(x - last.x, y - last.y) / 24));
  await page.mouse.move(x, y, { steps });
  last = { x, y };
  await sleep(180);
}

async function centerOf(locator) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) throw new Error('화면에서 찾지 못했어요');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function clickOn(page, locator, pause = 500) {
  const at = await centerOf(locator);
  await moveTo(page, at.x, at.y);
  await sleep(pause);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(400);
}

/** 사람이 치듯 한 글자씩 넣는다 */
export async function typeIn(page, locator, text, delay = 28) {
  await clickOn(page, locator, 200);
  for (const ch of text) {
    await page.keyboard.insertText(ch);
    await sleep(delay);
  }
  await sleep(300);
}

export async function dragTo(page, from, to) {
  await moveTo(page, from.x, from.y);
  await sleep(200);
  await page.mouse.down();
  const steps = Math.max(14, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 14));
  await page.mouse.move(to.x, to.y, { steps });
  last = to;
  await sleep(200);
  await page.mouse.up();
  await sleep(400);
}

export async function open(page, route) {
  await page.goto(BASE + route, { waitUntil: 'load' });
  await sleep(1000);
  await install(page);
}

export async function capture(page, name) {
  const file = path.join(ROOT, 'tests', '.tmp', 'shots', `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
