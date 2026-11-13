/**
 * 전체 흐름 시험. 크레딧과 돈을 쓰지 않는다.
 *
 * - 임시 데이터 폴더, 별도 포트(6801), 가짜 엔진으로 돌린다. 키는 비워서 넘긴다.
 * - 끌기는 사람 손처럼 누르자마자 움직인다. 시간 조건으로 맞추지 않는다.
 * - 운영 모드: npx next build 뒤 npm run test:e2e
 * - 개발 모드: E2E_DEV=1 npm run test:e2e (사용자가 보는 모드에서만 나는 오류를 잡는다)
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 6801;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = path.join(ROOT, 'tests', '.tmp');
const DATA = path.join(TMP, `data-${Date.now()}`);
const SHOTS = path.join(TMP, 'shots');
const FIXTURES = path.join(TMP, 'fixtures');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });

const ENV = {
  ...process.env,
  VIDEOCREATE_DATA_DIR: DATA,
  VIDEOCREATE_FAKE_ENGINE: '1',
  VIDEOCREATE_FAKE_DELAY_MS: '1200',
  // 열어 둔 개발 서버의 .next 를 건드리지 않는다. 운영 모드도 VIDEOCREATE_DIST_DIR=.next-e2e 로 빌드해서 돌린다
  VIDEOCREATE_DIST_DIR: process.env.VIDEOCREATE_DIST_DIR || (process.env.E2E_DEV ? '.next-e2e' : '.next'),
  GEMINI_API_KEY: '',
  OPENAI_API_KEY: '',
  TYPECAST_API_KEY: '',
};

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  통과  ${name}`);
  else {
    failures++;
    console.log(`  실패  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const step = (title) => console.log(`\n■ ${title}`);

function queueCli(...args) {
  return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/queue.ts', ...args], {
    cwd: ROOT,
    env: ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function queueCliFails(...args) {
  try {
    queueCli(...args);
    return '';
  } catch (e) {
    return String(e.stderr || e.message);
  }
}

// ── 가짜 파일 ───────────────────────────────────────────
async function makeFixtures() {
  const png = (name, width, height, color) =>
    sharp({ create: { width, height, channels: 3, background: color } })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 3}" ry="${height / 3.4}" fill="#ffffff" opacity="0.55"/></svg>`,
          ),
        },
      ])
      .png()
      .toFile(path.join(FIXTURES, name));
  await png('ref-product.png', 1200, 1600, '#E7A97F');
  await png('ref-person.png', 1600, 1000, '#9DB7D6');
  await png('result-scene.png', 1152, 2048, '#BFD8C2');
  await png('result-scene-2.png', 1152, 2048, '#D8C7BF');
  fs.writeFileSync(path.join(FIXTURES, 'not-image.png'), 'this is not an image file at all');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=540x960:rate=24:duration=2',
    '-pix_fmt', 'yuv420p', path.join(FIXTURES, 'result-video.mp4'),
  ]);
}

// ── 서버 ─────────────────────────────────────────────────
// next dev 는 시작할 때 tsconfig 와 next-env 를 고친다. 시험 뒤 원래대로 돌린다
const KEEP = ['tsconfig.json', 'next-env.d.ts'].map((name) => [path.join(ROOT, name), fs.readFileSync(path.join(ROOT, name))]);
process.on('exit', () => {
  if (process.env.E2E_DEV) for (const [file, bytes] of KEEP) fs.writeFileSync(file, bytes);
});
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.env.E2E_DEV ? 'dev' : 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
  cwd: ROOT,
  env: ENV,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

function stopServer() {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill('SIGKILL');
  } catch {
    // 이미 꺼졌다
  }
}
process.on('exit', stopServer);

async function waitForServer() {
  for (let i = 0; i < 240; i++) {
    try {
      const res = await fetch(`${BASE}/api/projects`);
      if (res.ok) return;
    } catch {
      // 아직 뜨는 중
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`시험 서버가 뜨지 않았어요.\n${serverLog}`);
}

// ── 시작 ─────────────────────────────────────────────────
await makeFixtures();
await waitForServer();

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await context.newPage();

const pageErrors = [];
const outsideRequests = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // 일부러 낸 실패 응답은 서버 상태 코드로 찍힌다
  if (/Failed to load resource/.test(text)) return;
  pageErrors.push(text);
});
await context.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  outsideRequests.push(url);
  return route.abort();
});

const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const titleSpan = (title) => page.locator('span[title="두 번 눌러 이름 바꾸기"]', { hasText: new RegExp(`^${title}$`) });
const cell = (title) => page.locator('.react-flow__node', { has: titleSpan(title) });
const frameOf = (title) => cell(title).locator('.cell-frame');
const handle = (title, side) => cell(title).locator(`.react-flow__handle-${side}`);
const statusOf = (title) => cell(title).locator('[data-cell-status]').getAttribute('data-cell-status');
const panel = () => page.locator('[data-prompt-panel]');
const toast = () => page.locator('[role="status"]');

async function centerOf(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('화면에서 찾지 못했어요');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 사람 손처럼: 누르자마자 움직여서 놓는다 */
async function drag(from, to, button = 'left') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up({ button });
}

/** 바로바로 저장하지 않는다. 저장 버튼을 누른다 */
async function saved() {
  await sleep(120);
  const button = page.getByRole('button', { name: '변경내용 저장' });
  if (await button.isEnabled()) await button.click();
  await page.waitForSelector('[data-save-state="saved"]', { timeout: 8000 });
}

const moneyStat = (name) => page.locator(`[data-stat="${name}"]`).textContent();

async function clickBlank() {
  // 왼쪽 가장자리는 칸이 잘 안 오는 자리다. 칸이 있으면 빈자리를 찾는다
  for (const [x, y] of [[14, 500], [14, 300], [14, 700], [1425, 500], [700, 80]]) {
    const onPane = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'),
      { x, y },
    );
    if (onPane) {
      await page.mouse.click(x, y);
      return;
    }
  }
  throw new Error('빈자리를 찾지 못했어요');
}

async function fitAll() {
  await clickBlank();
  await page.getByRole('button', { name: '전체 보기' }).click();
  await sleep(350);
}

/** 전체 보기로 맞춘 뒤 칸을 눌러 창을 연다. 창이 들어오도록 캔버스가 움직이는 시간도 기다린다 */
async function select(title) {
  await fitAll();
  // 영상 칸 한가운데는 재생 버튼이라 모서리를 누른다
  await frameOf(title).click({ position: { x: 24, y: 30 } });
  await panel().waitFor();
  await sleep(320);
}

async function dropFile(fileName, x, y) {
  const b64 = fs.readFileSync(path.join(FIXTURES, fileName)).toString('base64');
  await page.evaluate(
    ({ b64, fileName, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], fileName, { type: 'image/png' }));
      const target = document.elementFromPoint(x, y);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      }
    },
    { b64, fileName, x, y },
  );
}

async function setPrompt(text) {
  const area = panel().getByLabel('프롬프트');
  await area.click();
  await area.fill(text);
}

/** 프로젝트 파일을 직접 읽어 저장 상태를 본다 */
function projectDirs() {
  const root = path.join(DATA, 'projects');
  return fs.existsSync(root) ? fs.readdirSync(root) : [];
}
async function getJobs(projectId) {
  return (await (await fetch(`${BASE}/api/projects/${projectId}/jobs`)).json()).jobs;
}
const jobOf = async (projectId, title) => (await getJobs(projectId)).filter((j) => j.title === title).at(-1);

try {
  step('프로젝트 목록과 만들기');
  await page.goto(BASE);
  await page.getByText('전체 프로젝트').waitFor();
  check(
    '메뉴에 프로젝트·자산·갤러리·CF 레퍼런스·숏츠 가져오기·영상 가져오기가 있다',
    (await page.getByRole('navigation').getByRole('link').allTextContents()).join() === '프로젝트,자산,갤러리,CF 레퍼런스,숏츠 가져오기,영상 가져오기',
  );
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check('글꼴이 프리텐다드다', /pretendard/i.test(font), font);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('바탕이 어두운 색이다', bg === 'rgb(8, 8, 11)', bg);
  const brand = await page.evaluate(() => getComputedStyle(document.querySelector('.btn-primary')).backgroundColor);
  check('버튼 색이 인디고다', brand === 'rgb(99, 102, 241)', brand);
  check('메인 그림이 뜬다', await page.evaluate(async () => {
    const img = document.querySelector('img[src="/home/hero.jpg"]');
    if (!img) return false;
    if (!img.complete) await new Promise((r) => (img.onload = r));
    return img.naturalWidth > 1000;
  }));
  check('고른 작업이 없으면 띠가 없다', (await page.getByRole('region', { name: '고른 작업' }).count()) === 0);
  await shot('01-projects-empty');

  await page.getByRole('button', { name: '제작 시작' }).click();
  await page.waitForURL(/\/p\/p_/, { timeout: 120000 }); // 개발 모드는 첫 화면을 컴파일하느라 오래 걸린다
  await page.getByRole('button', { name: '장면 그림', exact: true }).waitFor();
  const projectId = page.url().match(/\/p\/(p_[a-z0-9]+)/)[1];
  check('새 프로젝트로 들어왔다', projectDirs().includes(projectId));
  check('시험 모드가 표시된다', await page.getByText('시험 모드').isVisible());
  check('첫 안내가 보인다', await page.getByText('시나리오부터 시작해 보세요').isVisible());
  check('7단계 막대가 보인다', (await page.getByRole('list', { name: '7단계 제작 흐름' }).getByRole('button').count()) === 7);
  check('처음에는 저장됨이다', (await page.locator('[data-save-state]').getAttribute('data-save-state')) === 'saved');
  await shot('02-canvas-empty');

  step('프로젝트 이름 바꾸기');
  await page.getByRole('button', { name: /프로젝트 이름: 제목 없음/ }).click();
  await page.getByLabel('프로젝트 이름').fill('맥스 숏츠 시험');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /프로젝트 이름: 맥스 숏츠 시험/ }).waitFor();
  const renamed = await (await fetch(`${BASE}/api/projects/${projectId}`)).json();
  check('이름이 저장됐다', renamed.project.name === '맥스 숏츠 시험', renamed.project.name);

  step('참조 사진 넣기');
  await dropFile('ref-product.png', 620, 300);
  await cell('참조 사진 1').waitFor();
  check('끌어다 놓으면 참조 칸이 생긴다', (await cell('참조 사진 1').textContent()).includes('1200 × 1600'));
  await page.getByRole('button', { name: '참조 사진', exact: true }).click();
  await cell('참조 사진 2').waitFor();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), cell('참조 사진 2').getByRole('button', { name: '사진 올리기' }).click()]);
  await chooser.setFiles(path.join(FIXTURES, 'ref-person.png'));
  await cell('참조 사진 2').getByText('1600 × 1000').waitFor();
  check('파일을 골라 올릴 수 있다', true);
  await saved();

  step('이상한 파일 거르기');
  const wrong = new FormData();
  wrong.append('file', new File(['not an image at all, sorry'], 'x.png', { type: 'image/png' }));
  const wrongRes = await fetch(`${BASE}/api/projects/${projectId}/files`, { method: 'POST', body: wrong });
  check('확장자만 그림인 파일을 막는다', wrongRes.status === 400, String(wrongRes.status));
  const traversal = await fetch(`${BASE}/api/projects/${projectId}/files/..%2F..%2Fproject.json`);
  check('다른 경로의 파일을 못 읽는다', traversal.status === 404, String(traversal.status));
  const plainText = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  check('다른 사이트가 보낼 수 있는 형식의 요청을 막는다', plainText.status === 415, String(plainText.status));

  step('칸 만들기와 선 잇기');
  await page.getByRole('button', { name: '장면 그림', exact: true }).click();
  await cell('장면 1').waitFor();
  await fitAll();
  await shot('03-three-cells');
  await drag(await centerOf(handle('참조 사진 1', 'right')), await centerOf(handle('장면 1', 'left')));
  await sleep(150);
  check('연결점끼리 이어진다', (await page.locator('.react-flow__edge').count()) === 1, String(await page.locator('.react-flow__edge').count()));
  await drag(await centerOf(handle('참조 사진 2', 'right')), await centerOf(frameOf('장면 1')));
  await sleep(150);
  check('칸 위에 놓아도 이어진다', (await page.locator('.react-flow__edge').count()) === 2, String(await page.locator('.react-flow__edge').count()));
  await drag(await centerOf(handle('참조 사진 2', 'right')), await centerOf(frameOf('장면 1')));
  await toast().filter({ hasText: '이미 이어져' }).waitFor();
  check('같은 선을 두 번 잇지 않는다', (await page.locator('.react-flow__edge').count()) === 2);

  await frameOf('장면 1').click();
  await panel().waitFor();
  check('칸을 누르면 프롬프트 창이 뜬다', await panel().getByLabel('프롬프트').isVisible());
  check('참조가 번호와 함께 보인다', (await panel().locator('[data-ref-thumb]').count()) === 2);
  await shot('04-prompt-panel');

  step('한글 입력(조합 중 끊기지 않는지)');
  const area = panel().getByLabel('프롬프트');
  await area.click();
  const cdp = await context.newCDPSession(page);
  for (const syllable of [['ㅎ', '하', '한'], ['ㄱ', '그', '글']]) {
    for (const text of syllable) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await sleep(40);
    }
    await cdp.send('Input.insertText', { text: syllable[2] });
    await sleep(40);
  }
  check('조합한 글자가 그대로 남는다', (await area.inputValue()) === '한글', await area.inputValue());
  await page.keyboard.type(' 프롬프트 space 입력');
  check('입력 중 스페이스가 먹힌다', (await area.inputValue()) === '한글 프롬프트 space 입력', await area.inputValue());
  await page.keyboard.press('Backspace');
  check('글자를 지워도 칸이 안 지워진다', (await cell('장면 1').count()) === 1 && (await area.inputValue()).endsWith('입'));
  await page.keyboard.press('Home');
  await page.keyboard.type('맨앞');
  check('중간에 써도 글자 자리가 튀지 않는다', (await area.inputValue()).startsWith('맨앞한글'), await area.inputValue());

  step('참조 순서 바꾸기');
  const firstBefore = await panel().locator('[data-ref-thumb="1"]').getAttribute('title');
  await panel().locator('[data-ref-thumb="2"]').dragTo(panel().locator('[data-ref-thumb="1"]'));
  await sleep(150);
  const firstAfter = await panel().locator('[data-ref-thumb="1"]').getAttribute('title');
  check('끌어서 1번과 2번을 바꾼다', firstBefore !== firstAfter, `${firstBefore} → ${firstAfter}`);

  step('다음 칸 만들기');
  await clickBlank();
  await handle('장면 1', 'right').click();
  await page.getByRole('menu', { name: '다음 칸 만들기' }).waitFor();
  check('+ 를 누르면 메뉴가 뜬다', true);
  await page.keyboard.press('Escape');
  await page.getByRole('menu', { name: '다음 칸 만들기' }).waitFor({ state: 'hidden' });
  check('Esc 로 닫힌다', true);

  const scene1 = await frameOf('장면 1').boundingBox();
  await drag(await centerOf(handle('장면 1', 'right')), { x: Math.min(scene1.x + scene1.width + 200, 1380), y: Math.max(scene1.y, 120) });
  await page.getByRole('menu', { name: '다음 칸 만들기' }).waitFor();
  await page.getByRole('menuitem', { name: '영상 클립' }).click();
  await cell('영상 1').waitFor();
  await sleep(200);
  check('빈 곳에 놓으면 다음 칸이 이어진다', (await page.locator('.react-flow__edge').count()) === 3);
  check('새 칸이 바로 선택된다', await panel().getByLabel('길이(초)').isVisible());
  await shot('05-video-panel');

  await fitAll();
  await handle('장면 1', 'right').click();
  await page.getByRole('menuitem', { name: '장면 그림' }).click();
  await cell('장면 2').waitFor();
  await fitAll();

  step('잇지 못하는 경우');
  await drag(await centerOf(handle('장면 2', 'right')), await centerOf(frameOf('장면 1')));
  await toast().filter({ hasText: '되돌아가게' }).waitFor();
  check('되돌아가는 선을 막는다', true);
  await drag(await centerOf(handle('참조 사진 1', 'right')), await centerOf(frameOf('참조 사진 2')));
  await toast().filter({ hasText: '참조 사진 칸에는' }).waitFor();
  check('참조 칸으로 들어가는 선을 막는다', true);
  check('영상 칸에는 나가는 연결점이 없다', (await handle('영상 1', 'right').count()) === 0);
  check('참조 칸에는 들어오는 연결점이 없다', (await handle('참조 사진 1', 'left').count()) === 0);

  step('손동작: 옮기기, 살짝 누르기, 범위 선택');
  // 화면 좌표는 캔버스가 움직이면 함께 바뀌므로 칸 자체의 캔버스 좌표를 읽는다
  const movePos = (title) =>
    cell(title).evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { x: m.e, y: m.f };
    });
  const before = await movePos('참조 사진 1');
  const grab = await centerOf(frameOf('참조 사진 1'));
  await drag(grab, { x: grab.x - 18, y: grab.y + 46 });
  await sleep(120);
  const after = await movePos('참조 사진 1');
  check('누르자마자 끌면 칸이 움직인다', after.y - before.y > 20 && before.x - after.x > 5, JSON.stringify({ before, after }));
  check('그냥 끌어서는 창이 뜨지 않는다', (await panel().count()) === 0);

  await clickBlank();
  const tap = await centerOf(frameOf('장면 2'));
  const tapBefore = await movePos('장면 2');
  await page.mouse.move(tap.x, tap.y);
  await page.mouse.down();
  await page.mouse.move(tap.x + 2, tap.y + 1);
  await page.mouse.up();
  await sleep(150);
  const tapAfter = await movePos('장면 2');
  check('손이 살짝 떨려도 눌림으로 친다', (await panel().count()) === 1 && Math.abs(tapAfter.x - tapBefore.x) < 1);
  await fitAll();

  const startBox = await frameOf('참조 사진 1').boundingBox();
  const endBox = await frameOf('참조 사진 2').boundingBox();
  const left = Math.min(startBox.x, endBox.x) - 12;
  const top = Math.min(startBox.y, endBox.y) - 34;
  const right = Math.max(startBox.x + startBox.width, endBox.x + endBox.width) + 4;
  const bottom = Math.max(startBox.y + startBox.height, endBox.y + endBox.height) + 30;
  const blankStart = await page.evaluate(
    ({ left, top }) => document.elementFromPoint(left, top)?.classList.contains('react-flow__pane'),
    { left, top },
  );
  check('범위 시작 자리가 비어 있다', !!blankStart, `${left},${top}`);
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 12 });
  await shot('06-range-select');
  await page.mouse.up();
  await page.getByText('2칸 선택').waitFor();
  check('빈 곳을 끌면 범위 안의 칸이 선택된다', true);
  await clickBlank();

  step('확대와 이동');
  const zoomText = () => page.locator('[data-bar="dock"]').getByText(/^\d+%$/).textContent();
  const vp = () =>
    page.evaluate(() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
      return { x: m.e, y: m.f, zoom: m.a };
    });
  const z1 = await vp();
  await page.mouse.move(14, 500);
  await page.mouse.wheel(0, -300);
  await sleep(250);
  const z2 = await vp();
  check('휠로 확대된다', z2.zoom > z1.zoom, `${z1.zoom} → ${z2.zoom} (${await zoomText()})`);
  await page.mouse.wheel(0, 300);
  await sleep(250);

  const p1 = await vp();
  await page.keyboard.down('Space');
  await sleep(40);
  await drag({ x: 14, y: 500 }, { x: 114, y: 560 });
  await page.keyboard.up('Space');
  await sleep(120);
  const p2 = await vp();
  check('스페이스를 누른 채 끌면 화면이 움직인다', Math.abs(p2.x - p1.x) > 40, JSON.stringify({ p1, p2 }));
  await page.getByText('칸 선택').waitFor({ state: 'hidden', timeout: 500 }).catch(() => undefined);

  const p3 = await vp();
  await drag({ x: 14, y: 500 }, { x: 74, y: 440 }, 'right');
  await sleep(120);
  const p4 = await vp();
  check('오른쪽 버튼으로 끌어도 화면이 움직인다', Math.abs(p4.x - p3.x) > 20, JSON.stringify({ p3, p4 }));

  await page.getByRole('button', { name: '화면 이동 도구' }).click();
  const p5 = await vp();
  await drag({ x: 14, y: 500 }, { x: 94, y: 500 });
  await sleep(120);
  const p6 = await vp();
  check('손 도구로 끌면 화면이 움직인다', Math.abs(p6.x - p5.x) > 40, JSON.stringify({ p5, p6 }));
  await page.getByRole('button', { name: '범위 선택 도구' }).click();
  await fitAll();

  step('되돌리기');
  await saved();
  await clickBlank();
  const undoBefore = await movePos('장면 2');
  const undoGrab = await centerOf(frameOf('장면 2'));
  await drag(undoGrab, { x: undoGrab.x + 60, y: undoGrab.y + 40 });
  await sleep(500);
  const undoMoved = await movePos('장면 2');
  check('옮기면 칸이 움직인다', Math.abs(undoMoved.x - undoBefore.x) > 20, JSON.stringify({ undoBefore, undoMoved }));
  check('옮기면 저장 안 됨이 뜬다', (await page.locator('[data-save-state]').getAttribute('data-save-state')) === 'dirty');
  const onDisk = () => {
    const dir = path.join(DATA, 'projects', projectId, 'canvases');
    return JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  };
  const storedScene = () => onDisk().nodes.find((n) => n.data.title === '장면 2').position;
  check('저장을 누르기 전에는 파일이 그대로다', Math.abs(storedScene().x - undoBefore.x) < 2, JSON.stringify(storedScene()));
  await clickBlank();
  await page.keyboard.press('Control+KeyZ');
  await sleep(200);
  const undoBack = await movePos('장면 2');
  check('Ctrl+Z 로 옮기기 전 자리로 돌아간다', Math.abs(undoBack.x - undoBefore.x) < 2 && Math.abs(undoBack.y - undoBefore.y) < 2, JSON.stringify({ undoBefore, undoBack }));
  check('되돌리면 다시 저장됨이다', (await page.locator('[data-save-state]').getAttribute('data-save-state')) === 'saved');
  await page.keyboard.press('Control+KeyY');
  await sleep(200);
  const undoRedo = await movePos('장면 2');
  check('Ctrl+Y 로 다시 옮겨진다', Math.abs(undoRedo.x - undoMoved.x) < 2, JSON.stringify({ undoMoved, undoRedo }));
  await page.getByRole('button', { name: '되돌리기' }).click();
  await sleep(200);
  check('막대의 되돌리기 버튼도 된다', Math.abs((await movePos('장면 2')).x - undoBefore.x) < 2);
  const countBeforeAdd = await page.locator('.react-flow__node').count();
  await page.locator('[data-bar="dock"]').getByRole('button', { name: '시나리오', exact: true }).click();
  await sleep(500);
  await clickBlank();
  await page.keyboard.press('Control+KeyZ');
  await sleep(200);
  check('새로 만든 칸도 되돌리면 사라진다', (await page.locator('.react-flow__node').count()) === countBeforeAdd);
  await page.keyboard.press('Control+KeyY');
  await sleep(200);
  check('다시 하면 칸이 돌아온다', (await page.locator('.react-flow__node').count()) === countBeforeAdd + 1);
  await page.keyboard.press('Control+KeyZ');
  await sleep(200);

  step('저장 버튼과 나갈 때 묻기');
  await select('장면 1');
  const promptSaved = await panel().getByLabel('프롬프트').inputValue();
  await setPrompt('1번 제품에 2번 사람이 앉아 있는 장면, 맥스 170 × 70cm, 사람 키 170cm');
  await page.keyboard.press('Control+z');
  await sleep(60);
  check('글을 치다가 누른 Ctrl+Z 는 칸을 되돌리지 않는다', (await page.locator('.react-flow__node').count()) === countBeforeAdd);
  await setPrompt('1번 제품에 2번 사람이 앉아 있는 장면, 맥스 170 × 70cm, 사람 키 170cm');
  await sleep(120);
  check('글을 고치면 저장 안 됨이 뜬다', (await page.locator('[data-save-state]').getAttribute('data-save-state')) === 'dirty');
  await page.getByRole('link', { name: '전체 프로젝트로' }).click();
  const leaveBox = page.getByRole('alertdialog', { name: '저장하지 않은 변경이 있어요' });
  await leaveBox.waitFor();
  check('나가려 하면 저장할지 묻는다', (await leaveBox.textContent()).includes('저장하고 넘어가기') && (await leaveBox.textContent()).includes('저장 안 함'), await leaveBox.textContent());
  await shot('06a-leave-confirm');
  await page.keyboard.press('Escape');
  await leaveBox.waitFor({ state: 'hidden' });
  check('Esc 로 닫으면 그 자리에 남는다', page.url().includes('/p/'));
  await page.getByRole('link', { name: '전체 프로젝트로' }).click();
  await leaveBox.waitFor();
  await leaveBox.getByRole('button', { name: '저장 안 함' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/p/${projectId}`);
  await cell('장면 1').waitFor();
  await select('장면 1');
  check('저장 안 함을 고르면 고친 글이 사라진다', (await panel().getByLabel('프롬프트').inputValue()) === promptSaved, await panel().getByLabel('프롬프트').inputValue());
  await setPrompt('1번 제품에 2번 사람이 앉아 있는 장면, 맥스 170 × 70cm, 사람 키 170cm');
  await sleep(120);
  await page.getByRole('link', { name: '전체 프로젝트로' }).click();
  await leaveBox.waitFor();
  await leaveBox.getByRole('button', { name: '저장하고 넘어가기' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/p/${projectId}`);
  await cell('장면 1').waitFor();
  await select('장면 1');
  check('저장하고 넘어가면 글이 남는다', (await panel().getByLabel('프롬프트').inputValue()).startsWith('1번 제품에'));
  await page.keyboard.press('Control+KeyS').catch(() => undefined);
  await saved();
  const positionBeforeReload = await movePos('장면 2');
  await page.reload();
  await cell('장면 1').waitFor();
  check('새로고침해도 칸이 그대로다', (await page.locator('.react-flow__node').count()) === 5, String(await page.locator('.react-flow__node').count()));
  check('새로고침해도 선이 그대로다', (await page.locator('.react-flow__edge').count()) === 4, String(await page.locator('.react-flow__edge').count()));
  const positionAfterReload = await movePos('장면 2');
  check('화면 위치까지 돌아온다', Math.abs(positionAfterReload.x - positionBeforeReload.x) < 3, JSON.stringify({ positionBeforeReload, positionAfterReload }));
  await select('장면 1');
  check('프롬프트가 남아 있다', (await panel().getByLabel('프롬프트').inputValue()).startsWith('1번 제품에'));

  const canvasFile = () => {
    const dir = path.join(DATA, 'projects', projectId, 'canvases');
    return path.join(dir, fs.readdirSync(dir)[0]);
  };
  const doc = JSON.parse(fs.readFileSync(canvasFile(), 'utf8'));
  const stale = await fetch(`${BASE}/api/projects/${projectId}/canvases/${doc.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport, revision: doc.revision - 1 }),
  });
  check('옛 창이 최신 내용을 덮어쓰지 못한다', stale.status === 409, String(stale.status));
  check('캔버스 파일에 생성 상태를 넣지 않는다', !JSON.stringify(doc.nodes).includes('"status"'));

  step('대기열: 그림 → 영상');
  check('기본 엔진이 힉스필드 대기열이다', (await panel().getByRole('button', { name: '힉스필드 대기열' }).getAttribute('aria-pressed')) === 'true');
  check('예상 크레딧이 보인다', (await panel().textContent()).includes('예상 2크레딧'));
  await panel().getByRole('button', { name: '생성 대기열' }).click();
  await cell('장면 1').locator('[data-cell-status="queued"]').waitFor();
  check('누르면 대기 상태가 된다', (await cell('장면 1').textContent()).includes('대기'));
  check('대기 중에는 프롬프트를 못 고친다', await panel().getByLabel('프롬프트').isDisabled());
  await shot('07-queued');

  // 영상은 프롬프트 없이 넣으려 하면 버튼이 막힌다
  await select('영상 1');
  check('프롬프트가 없으면 대기열 버튼이 막힌다', await panel().getByRole('button', { name: '생성 대기열' }).isDisabled());
  await setPrompt('천천히 앉으며 편안하게 기대는 움직임');
  await panel().getByRole('button', { name: '1초 늘리기' }).click();
  await panel().getByRole('button', { name: '1초 늘리기' }).click();
  await panel().getByRole('button', { name: '1초 늘리기' }).click();
  check('길이를 바꾸면 예상 크레딧이 바뀐다', (await panel().textContent()).includes('예상 24크레딧'), await panel().textContent());
  await panel().getByRole('button', { name: '생성 대기열' }).click();
  await cell('영상 1').locator('[data-cell-status="queued"]').waitFor();

  const listed = queueCli('list');
  check('스크립트가 대기 목록을 읽는다', listed.includes('그림 1장') && listed.includes('영상 1개') && listed.includes('예상 26크레딧'), listed);
  check('앞 칸이 먼저 나온다', listed.indexOf('장면 1') < listed.indexOf('영상 1'), listed);
  check('뒤 칸에 앞 칸 대기 표시가 붙는다', /앞 칸 대기.*영상 1/.test(listed), listed);

  const sceneJob = await jobOf(projectId, '장면 1');
  const videoJob = await jobOf(projectId, '영상 1');
  const sceneCall = JSON.parse(queueCli('show', sceneJob.id)).call;
  check('호출 값에 모델과 비율이 있다', sceneCall.params.model === 'nano_banana_pro' && sceneCall.params.aspect_ratio === '9:16' && sceneCall.params.resolution === '2k');
  check('올릴 참조 2장이 순서대로 나온다', sceneCall.uploads.length === 2 && sceneCall.params.medias[0].value === 'UPLOAD_1' && sceneCall.params.medias[0].role === 'image_references');
  check('번호를 바꾼 순서가 그대로다', sceneCall.uploads[0].title === '참조 사진 2', sceneCall.uploads.map((u) => u.title).join());
  check('참조 파일이 실제로 있다', sceneCall.uploads.every((u) => fs.existsSync(u.path)));
  check('최종 프롬프트에 로고 금지 규칙이 붙는다', sceneCall.params.prompt.includes('NO LOGO'));
  check('최종 프롬프트에 원문이 들어 있다', sceneCall.params.prompt.startsWith('1번 제품에'));
  const videoCallBefore = JSON.parse(queueCli('show', videoJob.id)).call;
  check('앞 칸이 안 끝나면 기다린다고 나온다', videoCallBefore.waitingFor.includes('장면 1'));
  check('앞 칸보다 먼저 시작할 수 없다', queueCliFails('start', videoJob.id).includes('앞 칸'), queueCliFails('start', videoJob.id));

  queueCli('start', sceneJob.id);
  await cell('장면 1').locator('[data-cell-status="running"]').waitFor({ timeout: 8000 });
  check('스크립트가 시작하면 화면이 생성 중으로 바뀐다', true);

  // 결과를 넣는 사이에 화면에서 글을 쓰고 있어도 덮어쓰지 않아야 한다
  await select('장면 2');
  await setPrompt('옆에서 본 장면');
  const doneOut = queueCli('done', sceneJob.id, '--file', path.join(FIXTURES, 'result-scene.png'), '--higgs-job', '11111111-2222-3333-4444-555555555555', '--credits', '2');
  check('결과를 넣으면 크기와 실제 크레딧을 알려 준다', doneOut.includes('1152×2048') && doneOut.includes('실제 2크레딧'), doneOut);
  await cell('장면 1').locator('[data-cell-status="done"]').waitFor({ timeout: 8000 });
  await saved();
  check('결과가 칸에 들어온다', await cell('장면 1').locator('img.cell-media').isVisible());
  check('칸 크기 표시가 실제 픽셀이 된다', (await cell('장면 1').textContent()).includes('1152 × 2048'));
  check('칸에 실제 크레딧이 보인다', (await cell('장면 1').textContent()).includes('실제 2크레딧'));
  check('상단에 쓴 크레딧과 예상이 나뉘어 보인다', (await moneyStat('credits-actual')) === '2' && (await moneyStat('credits-estimated')) === '24', `${await moneyStat('credits-actual')} / ${await moneyStat('credits-estimated')}`);
  await page.reload();
  await cell('장면 1').locator('[data-cell-status="done"]').waitFor();
  check('자동 저장이 결과를 덮어쓰지 않는다', true);
  await shot('08-scene-done');

  const videoCall = JSON.parse(queueCli('show', videoJob.id)).call;
  check('앞 칸이 힉스필드 결과면 job id 로 넘긴다', videoCall.params.medias[0].value === '11111111-2222-3333-4444-555555555555' && videoCall.params.medias[0].role === 'start_image', JSON.stringify(videoCall.params.medias));
  check('영상 호출 값이 인계 문서와 같다', videoCall.params.mode === 'omni_reference' && videoCall.params.draft === true && videoCall.params.duration === 8);
  check('영상 칸에 그림 파일을 넣지 못한다', queueCliFails('done', videoJob.id, '--file', path.join(FIXTURES, 'result-scene.png'), '--higgs-job', 'x', '--credits', '24').includes('영상 파일'));
  queueCli('start', videoJob.id);
  queueCli('done', videoJob.id, '--file', path.join(FIXTURES, 'result-video.mp4'), '--higgs-job', '66666666-7777-8888-9999-000000000000', '--credits', '24');
  await cell('영상 1').locator('[data-cell-status="done"]').waitFor({ timeout: 8000 });
  await cell('영상 1').getByRole('button', { name: '영상 1 재생' }).waitFor();
  check('상단 합계가 실제 26이 된다', (await moneyStat('credits-actual')) === '26', await moneyStat('credits-actual'));
  await sleep(600);
  await shot('09-video-done');

  step('크게 보기와 재생');
  await fitAll();
  await cell('장면 1').hover();
  await cell('장면 1').getByRole('button', { name: '장면 1 크게 보기' }).click();
  const largeImage = page.getByRole('dialog').locator('img');
  await largeImage.waitFor();
  await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth > 0);
  check('그림을 원본 크기로 연다', (await largeImage.evaluate((el) => el.naturalWidth)) === 1152);
  await shot('10-lightbox-image');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  await cell('영상 1').getByRole('button', { name: '영상 1 재생' }).click();
  const player = page.getByRole('dialog').locator('video');
  await player.waitFor();
  await page.waitForFunction(() => document.querySelector('[role=dialog] video')?.readyState >= 2, undefined, { timeout: 8000 });
  check('영상이 재생된다', (await player.evaluate((el) => el.videoWidth)) === 540);
  await player.evaluate((el) => {
    el.currentTime = 1.5;
  });
  await page.waitForFunction(() => document.querySelector('[role=dialog] video')?.currentTime >= 1.4, undefined, { timeout: 8000 });
  check('영상을 앞뒤로 옮길 수 있다', true);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  step('앱에서 바로 생성(가짜 응답)');
  await select('장면 2');
  const directGuard = await fetch(`${BASE}/api/projects/${projectId}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ canvasId: doc.id, nodeIds: ['없는칸'], allowDirect: false }),
  });
  check('없는 칸은 오류로 돌아온다', (await directGuard.json()).errors.length === 1);

  await panel().getByRole('button', { name: '제미나이' }).click();
  await saved();
  const blocked = await (
    await fetch(`${BASE}/api/projects/${projectId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvasId: doc.id, nodeIds: [JSON.parse(fs.readFileSync(canvasFile(), 'utf8')).nodes.find((n) => n.data.title === '장면 2').id] }),
    })
  ).json();
  check('비용 확인 표시 없이는 결제 엔진이 안 돈다', blocked.created.length === 0 && blocked.errors[0].message.includes('비용 확인'), JSON.stringify(blocked.errors));

  const generateButton = panel().getByRole('button', { name: /바로 생성/ });
  check('버튼을 누르기 전에 금액이 보인다', (await generateButton.textContent()).includes('약 ₩270'), await generateButton.textContent());
  // 넓은 버튼의 가운데는 확인 단계의 「취소」 자리, 오른쪽 끝은 「생성」 자리다. 어느 쪽도 결제되면 안 된다
  await generateButton.dblclick();
  await sleep(300);
  check('가운데를 두 번 빠르게 눌러도 결제되지 않는다', (await statusOf('장면 2')) === 'draft' && (await jobOf(projectId, '장면 2')) === undefined);
  const cancelIfOpen = panel().getByRole('button', { name: '취소', exact: true });
  if (await cancelIfOpen.count()) await cancelIfOpen.click();
  const wideBox = await generateButton.boundingBox();
  await generateButton.dblclick({ position: { x: wideBox.width - 8, y: wideBox.height / 2 } });
  await sleep(300);
  check('오른쪽 끝을 두 번 빠르게 눌러도 결제되지 않는다', (await statusOf('장면 2')) === 'draft' && (await jobOf(projectId, '장면 2')) === undefined);
  await sleep(300);
  check('한 번 더 확인한다', (await panel().textContent()).includes('약 ₩230~₩314이 바로 결제돼요'), await panel().textContent());
  check('확인 전에는 시작하지 않는다', (await statusOf('장면 2')) === 'draft');
  await shot('11-direct-confirm');
  await panel().getByRole('button', { name: '취소' }).click();
  check('취소하면 그대로다', (await statusOf('장면 2')) === 'draft');
  await generateButton.click();
  await sleep(550);
  await panel().getByRole('button', { name: '생성', exact: true }).click();
  await cell('장면 2').locator('[data-cell-status="running"]').waitFor({ timeout: 8000 });
  check('확인하면 생성 중이 된다', true);
  await cell('장면 2').locator('[data-cell-status="done"]').waitFor({ timeout: 15000 });
  check('끝나면 결과가 들어온다', await cell('장면 2').locator('img.cell-media').isVisible());
  check('칸에 원화 비용이 보인다', (await cell('장면 2').textContent()).includes('실제 ₩271'), await cell('장면 2').textContent());
  check('상단에 돈과 크레딧이 따로 합산된다', (await moneyStat('credits-actual')) === '26' && (await moneyStat('krw')) === '₩271', `${await moneyStat('credits-actual')} / ${await moneyStat('krw')}`);
  const directJob = await jobOf(projectId, '장면 2');
  check('대기열 스크립트에는 안 나온다', !queueCli('list').includes(directJob.id));
  check('바로 생성 칸을 스크립트로 처리하지 못한다', queueCliFails('done', directJob.id, '--file', path.join(FIXTURES, 'result-scene.png'), '--higgs-job', 'x', '--credits', '1').includes('바로 뽑는'));

  step('실패 원문 보여 주기');
  await panel().getByLabel('프롬프트').fill('[가짜402] 시험');
  await panel().getByRole('button', { name: /다시 바로 생성/ }).click();
  await sleep(550);
  await panel().getByRole('button', { name: '생성', exact: true }).click();
  await cell('장면 2').locator('[data-cell-status="failed"]').waitFor({ timeout: 15000 });
  const failText = await panel().textContent();
  check('구글 원문을 그대로 보여 준다', failText.includes('구글 응답 402') && failText.includes('prepaid credits are depleted'), failText);
  check('402의 뜻을 알려 준다', failText.includes('선불 잔액'));
  check('실패해도 이전 결과가 남는다', await cell('장면 2').locator('img.cell-media').isVisible());
  await sleep(350);
  const retryBox = await panel().getByRole('button', { name: /다시 바로 생성/ }).boundingBox();
  const dockBox = await page.locator('[data-bar="dock"]').boundingBox();
  check('실패 안내가 길어져도 다시 생성 버튼이 보인다', !!retryBox && retryBox.y + retryBox.height <= dockBox.y, JSON.stringify({ retryBox, dockBox }));
  await shot('12-failed');
  await panel().getByLabel('프롬프트').fill('[가짜429] 시험');
  await panel().getByRole('button', { name: /다시 바로 생성/ }).click();
  await sleep(550);
  await panel().getByRole('button', { name: '생성', exact: true }).click();
  await panel().getByText('구글 응답 429').waitFor({ timeout: 15000 });
  check('429의 뜻을 알려 준다', (await panel().textContent()).includes('월 지출 한도'));
  const stats = (await (await fetch(`${BASE}/api/projects/${projectId}/jobs`)).json()).stats;
  check('실패한 생성은 비용에 안 들어간다', stats.krw.actual === 271 && stats.krw.estimated === 0, JSON.stringify(stats));

  step('GPT 경고');
  await panel().getByRole('button', { name: 'GPT' }).click();
  check('얼굴·제품 경고가 뜬다', (await panel().textContent()).includes('맥스·라운저'));
  check('GPT는 받을 수 있는 크기만 고르게 한다', (await panel().getByLabel('비율').locator('option').count()) === 3);
  check('크기를 실제 픽셀로 보여 준다', (await panel().textContent()).includes('1024 × 1536'));
  await shot('13-gpt-warning');
  await panel().getByRole('button', { name: '힉스필드 대기열' }).click();
  await panel().getByLabel('프롬프트').fill('옆에서 본 장면');

  step('+참고: 자산에서 고르기');
  await panel().getByRole('button', { name: '참고' }).click();
  const pickerDialog = page.getByRole('dialog', { name: '참조 고르기' });
  await pickerDialog.waitFor();
  await pickerDialog.getByRole('button', { name: 'ref-person.png 고르기' }).waitFor();
  await shot('14-ref-picker');
  const edgesBefore = await page.locator('.react-flow__edge').count();
  await pickerDialog.getByRole('button', { name: 'ref-person.png 고르기' }).click();
  await cell('ref-person.png').waitFor();
  await sleep(150);
  check('고른 자산이 참조로 이어진다', (await page.locator('.react-flow__edge').count()) === edgesBefore + 1);

  step('여러 칸 한꺼번에 넣기');
  await fitAll();
  const addAndPrompt = async (name, text) => {
    await page.getByRole('button', { name: '장면 그림', exact: true }).click();
    await cell(name).waitFor();
    await panel().waitFor();
    await setPrompt(text);
  };
  await addAndPrompt('장면 3', '세 번째 장면');
  await addAndPrompt('장면 4', '네 번째 장면');
  await panel().getByRole('button', { name: '제미나이' }).click();
  await saved();
  await fitAll();
  const box3 = await cell('장면 3').boundingBox();
  const box4 = await cell('장면 4').boundingBox();
  const sx = Math.min(box3.x, box4.x) - 8;
  const sy = Math.min(box3.y, box4.y) - 8;
  const isBlank = await page.evaluate(({ sx, sy }) => document.elementFromPoint(sx, sy)?.classList.contains('react-flow__pane'), { sx, sy });
  check('두 칸 둘레에 빈자리가 있다', !!isBlank);
  await drag({ x: sx, y: sy }, { x: Math.max(box3.x + box3.width, box4.x + box4.width) + 4, y: Math.max(box3.y + box3.height, box4.y + box4.height) + 4 });
  await page.getByText('2칸 선택').waitFor();
  const selectionBar = page.locator('[data-bar="selection"]');
  check('합계가 크레딧과 돈으로 나뉜다', (await selectionBar.textContent()).includes('예상 2크레딧') && (await selectionBar.textContent()).includes('약 ₩270'), await selectionBar.textContent());
  await shot('15-selection-bar');
  await selectionBar.getByRole('button', { name: '생성' }).click();
  const confirmBox = page.getByRole('alertdialog');
  await confirmBox.waitFor();
  check('돈이 나가는 칸이 있으면 먼저 묻는다', (await confirmBox.textContent()).includes('바로 결제') && (await confirmBox.textContent()).includes('대화에서 승인'), await confirmBox.textContent());
  await shot('16-confirm-direct');
  await confirmBox.getByRole('button', { name: '생성' }).click();
  await cell('장면 3').locator('[data-cell-status="queued"]').waitFor({ timeout: 5000 });
  await cell('장면 4').locator('[data-cell-status="done"]').waitFor({ timeout: 15000 });
  check('제미나이 칸은 바로, 힉스필드 칸은 대기로 나뉜다', (await statusOf('장면 3')) === 'queued');

  step('대기열 창과 취소');
  await clickBlank();
  await page.getByRole('button', { name: /대기열/ }).first().click();
  const drawer = page.getByRole('complementary', { name: '대기열' });
  await drawer.waitFor();
  check('대기 중인 칸이 보인다', (await drawer.textContent()).includes('장면 3'));
  check('실패한 칸에 비용이 없다고 단정하지 않는다', !(await drawer.textContent()).includes('비용 없음'));
  await shot('17-queue-drawer');
  await drawer.getByRole('button', { name: '취소' }).first().click();
  await cell('장면 3').locator('[data-cell-status="draft"]').waitFor({ timeout: 5000 });
  check('취소하면 초안으로 돌아간다', true);
  await drawer.getByRole('button', { name: '대기열 닫기' }).click();

  step('앞 칸을 취소하면 뒤 칸도 함께 취소');
  // 장면 3 → 장면 4 를 잇고 둘 다 대기열에 넣은 뒤 앞을 취소한다
  await fitAll();
  await drag(await centerOf(handle('장면 3', 'right')), await centerOf(frameOf('장면 1')));
  await sleep(150);
  await select('장면 3');
  await panel().getByRole('button', { name: '생성 대기열' }).click();
  await cell('장면 3').locator('[data-cell-status="queued"]').waitFor();
  await select('장면 1');
  await panel().getByLabel('프롬프트').fill('다시 뽑는 첫 장면');
  await panel().getByRole('button', { name: /다시 생성 대기열/ }).click();
  await cell('장면 1').locator('[data-cell-status="queued"]').waitFor();
  check('결과가 있는 칸도 다시 넣을 수 있다', await cell('장면 1').locator('img.cell-media').isVisible());
  const later = await jobOf(projectId, '장면 1');
  check('뒤 칸이 앞 칸 작업을 가리킨다', later.refs.some((r) => r.sourceTitle === '장면 3' && r.sourceJobId));
  await select('장면 3');
  await panel().getByRole('button', { name: '대기 취소' }).click();
  await cell('장면 3').locator('[data-cell-status="draft"]').waitFor();
  await cell('장면 1').locator('[data-cell-status="done"]').waitFor({ timeout: 5000 });
  check('뒤 칸 대기도 함께 풀리고 이전 결과가 돌아온다', true);

  step('프로젝트 안의 여러 캔버스');
  await saved();
  await clickBlank();
  await page.getByRole('button', { name: '캔버스 1' }).click();
  await page.getByRole('menuitem', { name: '새 캔버스' }).click();
  await page.getByRole('button', { name: '캔버스 2' }).waitFor();
  check('새 캔버스는 비어 있다', (await page.locator('.react-flow__node').count()) === 0);
  check('주소에 캔버스가 남는다', page.url().includes('?c=c_'));
  await page.getByRole('button', { name: '영상 클립', exact: true }).click();
  await cell('영상 1').waitFor();
  await saved();
  await page.getByRole('button', { name: '캔버스 2' }).click();
  await page.getByRole('menuitem', { name: '캔버스 1' }).click();
  await cell('장면 1').waitFor();
  check('캔버스 1로 돌아오면 칸이 그대로다', (await page.locator('.react-flow__node').count()) >= 7, String(await page.locator('.react-flow__node').count()));
  check('결과도 그대로다', (await statusOf('장면 1')) === 'done');
  await page.getByRole('button', { name: '캔버스 1' }).click();
  await page.getByRole('button', { name: '캔버스 2 이름 바꾸기' }).click({ force: true });
  await page.getByLabel('캔버스 이름').fill('엔딩 컷');
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '엔딩 컷' }).waitFor();
  check('캔버스 이름을 바꿀 수 있다', true);
  await page.keyboard.press('Escape');
  await clickBlank();

  step('지우기');
  await frameOf('장면 2').click();
  await panel().waitFor();
  await page.keyboard.press('Escape').catch(() => undefined);
  await frameOf('장면 2').click();
  const selectedFocus = cell('장면 2');
  await selectedFocus.focus();
  await page.keyboard.press('Delete');
  const deleteBox = page.getByRole('alertdialog');
  await deleteBox.waitFor();
  check('결과가 있는 칸은 먼저 묻는다', (await deleteBox.textContent()).includes('갤러리에 남아요'), await deleteBox.textContent());
  await shot('18-confirm-delete');
  await deleteBox.getByRole('button', { name: '취소' }).click();
  check('취소하면 안 지워진다', (await cell('장면 2').count()) === 1);
  await selectedFocus.focus();
  await page.keyboard.press('Delete');
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await cell('장면 2').waitFor({ state: 'detached' });
  check('확인하면 지워진다', true);
  await saved();
  const statsAfterDelete = (await (await fetch(`${BASE}/api/projects/${projectId}/jobs`)).json()).stats;
  check('지워도 쓴 비용은 남는다', statsAfterDelete.krw.actual >= 271, JSON.stringify(statsAfterDelete));
  await fitAll();
  await shot('19-canvas-full');

  step('목록·자산·갤러리');
  await page.getByRole('link', { name: '전체 프로젝트로' }).click();
  await page.waitForURL(`${BASE}/`);
  const projectCard = page.locator('article', { hasText: '맥스 숏츠 시험' });
  await projectCard.waitFor();
  await page.waitForFunction(() => document.querySelector('article img')?.naturalWidth > 0, undefined, { timeout: 10000 });
  check('목록에 썸네일이 보인다', true);
  check('목록에 쓴 크레딧이 보인다', (await projectCard.textContent()).includes('크레딧'), await projectCard.textContent());
  await shot('20-projects');
  await projectCard.hover();
  await projectCard.getByRole('button', { name: /이름 바꾸기/ }).click();
  await page.getByLabel('프로젝트 이름').fill('맥스 숏츠 본편');
  await page.keyboard.press('Enter');
  await page.locator('article', { hasText: '맥스 숏츠 본편' }).waitFor();
  check('목록에서 이름을 바꾼다', true);

  await page.getByRole('navigation').getByRole('link', { name: '자산' }).click();
  await page.getByRole('heading', { name: '자산' }).waitFor();
  await page.getByText('ref-product.png').first().waitFor();
  check('올린 사진이 자산에 모인다', (await page.getByRole('button', { name: /크게 보기/ }).count()) === 2, String(await page.getByRole('button', { name: /크게 보기/ }).count()));
  await sleep(500);
  await shot('21-assets');

  await page.getByRole('navigation').getByRole('link', { name: '갤러리' }).click();
  await page.getByRole('heading', { name: '갤러리' }).waitFor();
  const folderLink = page.getByRole('link', { name: /맥스 숏츠 본편 열기/ });
  await folderLink.waitFor();
  check('프로젝트가 제작물 폴더로 보인다', (await page.getByRole('region', { name: '내 프로젝트' }).count()) === 1);
  await shot('22-gallery');
  await folderLink.click();
  await page.getByRole('button', { name: '영상 1 재생' }).waitFor();
  check('폴더 안에서 프로젝트로 돌아갈 수 있다', await page.getByRole('link', { name: '프로젝트 열기' }).isVisible());
  check('지운 칸의 결과도 갤러리에 남는다', (await page.getByRole('button', { name: '장면 2 크게 보기' }).count()) >= 1);
  await shot('22a-gallery-folder');
  await page.getByRole('button', { name: '영상 1 재생' }).click();
  await page.getByRole('dialog').locator('video').waitFor();
  check('갤러리에서 영상을 재생한다', true);
  await page.keyboard.press('Escape');

  step('메인에 걸기');
  await page.getByRole('figure').first().hover();
  await page.getByRole('button', { name: '영상 1 메인에 걸기' }).click({ force: true });
  await page.getByRole('button', { name: '영상 1 메인에서 내리기' }).waitFor();
  await sleep(200);
  await page.goto(BASE);
  await page.getByRole('region', { name: '고른 작업' }).waitFor();
  check('별을 누른 작업만 메인에 걸린다', (await page.getByRole('region', { name: '고른 작업' }).getByRole('button').count()) === 1);
  await shot('22b-home-showcase');
  const showcaseRes = await fetch(`${BASE}/api/showcase`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: '../../x', on: true }) });
  check('이상한 값은 걸지 않는다', showcaseRes.status === 400, String(showcaseRes.status));

  step('CF 레퍼런스');
  fs.mkdirSync(path.join(DATA, 'library'), { recursive: true });
  fs.writeFileSync(
    path.join(DATA, 'library', 'cf-refs.json'),
    JSON.stringify({
      refs: [
        { refId: 'testcf1', brand: '시험브랜드', title: 'Test Film', titleKo: '시험 영화', country: 'KR', year: 2026, format: '숏폼', lengthSec: 20, checked: true, concept: '시험 콘셉트 원작 브랜드 이야기', adapt: '퇴근하고 맥스에 앉는 이야기', why: '쉬는 이야기라 맞다', technique: ['고정 카메라'], fit: 5, themes: ['시험 주제'], trend: '요즘 통한다' },
        { refId: 'testcf2', brand: '다른브랜드', title: 'Low Fit', country: 'US', year: 2020, fit: 2, themes: ['다른 주제'], checked: false },
      ],
      concepts: [],
    }),
  );
  await page.getByRole('navigation').getByRole('link', { name: 'CF 레퍼런스' }).click();
  await page.getByRole('heading', { name: 'CF 레퍼런스' }).waitFor();
  await page.getByText('Test Film').waitFor();
  check('적합도 5가 기본으로 보인다', (await page.getByText('Low Fit').count()) === 0);
  await page.getByLabel('요기보 적합도').selectOption('0');
  await page.getByText('Low Fit').waitFor();
  check('적합도를 넓히면 나머지가 보인다', true);
  await shot('24-cf-refs');
  await page.getByRole('button', { name: '글로 시작' }).first().click();
  await page.waitForURL(/\/p\/p_/);
  await cell('시나리오').waitFor();
  const cfProject = page.url().match(/\/p\/(p_[a-z0-9]+)/)[1];
  const cfCanvasDir = path.join(DATA, 'projects', cfProject, 'canvases');
  const cfDoc = JSON.parse(fs.readFileSync(path.join(cfCanvasDir, fs.readdirSync(cfCanvasDir)[0]), 'utf8'));
  const cfScenario = cfDoc.nodes.find((n) => n.type === 'scenario').data;
  check('CF로 시작하면 우리로 푼 줄이 로그라인이 된다', cfScenario.logline === '퇴근하고 맥스에 앉는 이야기', JSON.stringify(cfScenario));
  check('원작 브랜드와 설명은 시나리오로 넘어오지 않는다', !`${cfScenario.logline}${cfScenario.scenario}`.includes('시험브랜드') && !cfScenario.scenario.includes('원작 브랜드'));

  step('숏츠 가져오기');
  await page.goto(`${BASE}/analyze`);
  await page.getByRole('heading', { name: '숏츠 가져오기' }).waitFor();
  const badUrl = await fetch(`${BASE}/api/analyses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'file:///c:/windows' }) });
  check('http(s) 주소만 받는다', badUrl.status === 400, String(badUrl.status));
  const badFile = await fetch(`${BASE}/api/analyses/a_aaaaaaaa/files/..%2F..%2Fsettings.json`);
  check('분석 폴더 밖 파일을 못 읽는다', badFile.status === 404, String(badFile.status));

  step('영상 가져오기');
  // 실제로 받지 않고 끝난 분석을 하나 넣어 둔다(12초, 3컷, 9초짜리 컷 안쪽 장면 1장)
  const videoId = 'a_e2evideo0001';
  const videoDir = path.join(DATA, 'library', 'analyses', videoId);
  fs.mkdirSync(path.join(videoDir, 'frames'), { recursive: true });
  for (const [name, color] of [['frame_001.jpg', '#335577'], ['frame_002.jpg', '#775533'], ['frame_002_004.jpg', '#886644'], ['frame_003.jpg', '#557733']]) {
    await sharp({ create: { width: 480, height: 270, channels: 3, background: color } }).jpeg().toFile(path.join(videoDir, 'frames', name));
  }
  await sharp({ create: { width: 100, height: 60, channels: 3, background: '#111111' } }).jpeg().toFile(path.join(videoDir, 'grid.jpg'));
  const cutOf = (no, start, end, extra) => ({ no, start, end, seconds: end - start, frame: `frame_00${no}.jpg`, loudness: -20, tension: 50, speech: '', ...(extra ? { extra } : {}) });
  fs.writeFileSync(
    path.join(videoDir, 'analysis.json'),
    JSON.stringify({
      id: videoId,
      url: 'https://example.com/film',
      title: '시험 단편',
      kind: 'video',
      status: 'done',
      step: '',
      error: '',
      width: 1280,
      height: 720,
      duration: 12,
      cuts: [cutOf(1, 0, 2), cutOf(2, 2, 11, [{ at: 6, frame: 'frame_002_004.jpg' }]), cutOf(3, 11, 12)],
      sound: [-30, -28, -25, -20, -18, null, -40, -35, -22, -15, -12, -30],
      grids: [{ file: 'grid.jpg', from: 0, to: 12 }],
      createdAt: new Date().toISOString(),
    }),
  );
  const shortsList = (await (await fetch(`${BASE}/api/analyses`)).json()).analyses;
  const videoList = (await (await fetch(`${BASE}/api/analyses?kind=video`)).json()).analyses;
  check('영상 가져오기 분석은 숏츠 가져오기 목록에 섞이지 않는다', !shortsList.some((a) => a.id === videoId) && videoList.some((a) => a.id === videoId));
  const videoProject = await fetch(`${BASE}/api/analyses/${videoId}/project`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'rhythm' }) });
  check('영상 가져오기로는 프로젝트를 만들지 않는다', videoProject.status === 400, String(videoProject.status));
  const extraFile = await fetch(`${BASE}/api/analyses/${videoId}/files/frame_002_004.jpg`);
  check('긴 컷 안쪽 장면 그림을 읽는다', extraFile.status === 200, String(extraFile.status));
  await page.goto(`${BASE}/video-import`);
  await page.getByRole('heading', { name: '영상 가져오기' }).waitFor();
  await page.getByRole('img', { name: /12초 동안 3컷/ }).waitFor();
  check('흐름 그래프에 길이와 컷 수를 적는다', true);
  check('컷 칸과 긴 컷 안쪽 장면이 함께 보인다', (await page.locator('[data-cut]').count()) === 3 && (await page.getByRole('button', { name: '2번 컷 4초 뒤 크게 보기' }).count()) === 1);
  const flow = await page.getByRole('img', { name: /12초 동안 3컷/ }).boundingBox();
  await page.mouse.move(flow.x + flow.width * 0.55, flow.y + 40);
  check('그래프에 손을 올리면 시간과 컷을 보여 준다', await page.getByText(/0:06 · 2번 컷 9\.0초/).isVisible());
  await shot('26-video-import');
  const badVideo = await fetch(`${BASE}/api/analyses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'file:///c:/windows', kind: 'video' }) });
  check('영상 가져오기도 http(s) 주소만 받는다', badVideo.status === 400, String(badVideo.status));

  step('새 모델: 한 장 시트를 칸별로 자른다');
  await page.goto(`${BASE}/assets`);
  await page.getByRole('button', { name: '새 모델 만들기' }).click();
  await page.getByPlaceholder('여성 H').fill('시험 모델');
  const [refChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '사진 넣기' }).click()]);
  await refChooser.setFiles(path.join(FIXTURES, 'ref-person.png'));
  await page.getByRole('group', { name: '닮은 정도' }).waitFor();
  await page.getByRole('group', { name: '닮은 정도' }).getByRole('button', { name: '50%' }).click();
  check('닮은 정도의 뜻을 보여 준다', await page.getByText('전체 인상과 분위기만 닮게').isVisible());
  await shot('25-model-form');
  await page.getByRole('button', { name: '모델 프로젝트 만들기' }).click();
  await page.waitForURL(/\/p\/p_/);
  await cell('모델 시트').waitFor();
  const modelProject = page.url().match(/\/p\/(p_[a-z0-9]+)/)[1];
  check('참고 사진이 이어져 있다', (await page.locator('.react-flow__edge').count()) === 1);
  await select('모델 시트');
  check('시트 프롬프트에 닮은 정도가 들어간다', (await panel().getByLabel('프롬프트').inputValue()).includes('50% 정도 닮은'));
  check('4K 한 장 4크레딧이다', (await panel().textContent()).includes('예상 4크레딧'), await panel().textContent());
  await panel().getByRole('button', { name: '생성 대기열' }).click();
  await cell('모델 시트').locator('[data-cell-status="queued"]').waitFor();
  const sheetJob = await jobOf(modelProject, '모델 시트');
  check('시트 작업에 격자가 적힌다', sheetJob.preset === 'sheet' && sheetJob.options.rows === 2 && sheetJob.options.cols === 5, JSON.stringify(sheetJob.options));
  const sheetFile = path.join(FIXTURES, 'model-sheet.png');
  await sharp({ create: { width: 1000, height: 660, channels: 3, background: '#ffffff' } })
    .composite(Array.from({ length: 10 }, (_, i) => ({ input: { create: { width: 192, height: 324, channels: 3, background: i < 5 ? '#6688aa' : '#aa8866' } }, left: (i % 5) * 202, top: Math.floor(i / 5) * 336 })))
    .png()
    .toFile(sheetFile);
  queueCli('start', sheetJob.id);
  queueCli('done', sheetJob.id, '--file', sheetFile, '--higgs-job', '22222222-3333-4444-5555-666666666666', '--credits', '4');
  await cell('모델 시트').locator('[data-cell-status="done"]').waitFor({ timeout: 8000 });
  const sheetBoards = (await (await fetch(`${BASE}/api/projects/${modelProject}/jobs`)).json()).boards;
  check('시트가 10칸으로 잘린다', Object.values(sheetBoards)[0].panels.length === 10, JSON.stringify(Object.values(sheetBoards)[0]));
  await page.locator('[data-bar="model-draft"]').getByRole('button', { name: '모델로 저장' }).click();
  await toast().filter({ hasText: '내 모델로 저장' }).waitFor();
  const savedModels = (await (await fetch(`${BASE}/api/library`)).json()).models;
  check('자른 칸으로 내 모델이 된다', savedModels.length === 1 && !!savedModels[0].rep && !!savedModels[0].sheets.face && !!savedModels[0].sheets.body && !!savedModels[0].sheets.expr, JSON.stringify(savedModels[0]));
  await saved();

  step('프로젝트 지우기');
  await page.goto(BASE);
  const trashCard = page.locator('article', { hasText: '참고' });
  await trashCard.waitFor();
  await trashCard.hover();
  await trashCard.getByRole('button', { name: /지우기/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await trashCard.waitFor({ state: 'detached' });
  check('목록에서 프로젝트를 지운다', !projectDirs().includes(cfProject));
  check('지운 프로젝트는 휴지통으로 간다', fs.readdirSync(path.join(DATA, 'trash')).some((name) => name.startsWith(cfProject)));

  step('편집과 완성 단계');
  await page.goto(`${BASE}/p/${projectId}`);
  await cell('장면 1').waitFor();
  const stepDone = (name) => page.getByRole('list', { name: '7단계 제작 흐름' }).getByRole('button', { name, exact: true }).getAttribute('data-step-done');
  check('편집본이 없으면 06이 끝나지 않는다', (await stepDone('편집')) === null);
  const stageDir = path.join(DATA, 'projects', projectId, 'canvases');
  // 캔버스가 여럿일 수 있다. 지금 열린 칸이 들어 있는 파일을 고른다
  const stageFile = fs.readdirSync(stageDir).find((name) => JSON.parse(fs.readFileSync(path.join(stageDir, name), 'utf8')).nodes.some((n) => n.data.title === '장면 1'));
  const stageCanvasId = stageFile.replace('.json', '');
  const stageUrl = `${BASE}/api/projects/${projectId}/canvases/${stageCanvasId}`;
  const stageDoc = (await (await fetch(stageUrl)).json()).canvas;
  stageDoc.nodes.push({ id: 'n_edittest01', type: 'video', position: { x: 2400, y: 0 }, data: { title: '편집본 시험', prompt: '편집본', model: 'seedance_2_5', aspect: '9:16', duration: 5, quality: 'draft', shot: {}, stage: 'edit' } });
  await fetch(stageUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodes: stageDoc.nodes, edges: stageDoc.edges, viewport: stageDoc.viewport, revision: stageDoc.revision }) });
  const editJob = (await (await fetch(`${BASE}/api/projects/${projectId}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canvasId: stageCanvasId, nodeIds: ['n_edittest01'] }) })).json()).created[0];
  queueCli('start', editJob.id);
  queueCli('done', editJob.id, '--file', path.join(FIXTURES, 'result-video.mp4'), '--higgs-job', 'edit-test', '--credits', '0');
  await cell('편집본 시험').locator('[data-cell-status="done"]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[aria-label="편집"]')?.dataset.stepDone === 'true', undefined, { timeout: 8000 });
  check('편집본이 들어오면 06이 끝난다', true);
  check('편집본 칸에 영상 모델 이름을 적지 않는다', !(await cell('편집본 시험').innerText()).includes('Seedance'));
  await page.getByRole('list', { name: '7단계 제작 흐름' }).getByRole('button', { name: '완성', exact: true }).click();
  await panel().getByRole('button', { name: '완성으로 등록' }).waitFor();
  check('07을 누르면 편집본으로 옮겨 창이 뜬다', true);
  check('편집본 창에서는 다시 생성할 수 없다', (await panel().getByRole('button', { name: /대기열/ }).count()) === 0);
  await panel().getByRole('button', { name: '완성으로 등록' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="완성"]')?.dataset.stepDone === 'true', undefined, { timeout: 8000 });
  await page.waitForSelector('[data-save-state="saved"]', { timeout: 8000 });
  check('완성으로 등록하면 07이 끝나고 저장된다', JSON.parse(fs.readFileSync(path.join(stageDir, stageFile), 'utf8')).nodes.find((n) => n.id === 'n_edittest01').data.stage === 'final');
  await shot('27-final-step');
  await page.goto(`${BASE}/gallery`);
  await page.getByRole('link', { name: /맥스 숏츠 본편 열기/ }).click();
  await page.getByRole('region', { name: '완성본' }).waitFor();
  check('갤러리 폴더 맨 위에 완성본이 보인다', (await page.getByRole('region').first().getAttribute('aria-label')) === '완성본');
  check('완성본에 엔진 이름을 적지 않는다', !(await page.getByRole('region', { name: '완성본' }).innerText()).includes('힉스필드'));
  const finalFile = JSON.parse(fs.readFileSync(path.join(DATA, 'projects', projectId, 'jobs.json'), 'utf8')).find((j) => j.id === editJob.id)?.result?.file;
  check('완성 파일을 찾았다', !!finalFile);
  await page.goto(`${BASE}/`);
  await page.locator(`video[src*="${finalFile}"]`).first().waitFor({ state: 'attached', timeout: 15000 });
  check('프로젝트 카드 표지가 완성본으로 바뀐다', true);

  step('좁은 화면');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/', '/gallery', '/cf-refs', '/analyze', '/video-import', '/assets']) {
    await page.goto(BASE + route);
    await sleep(500);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main');
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    check(`폰에서 ${route} 이 옆으로 넘치지 않는다`, overflow <= 1, String(overflow));
  }
  await page.goto(`${BASE}/p/${projectId}`);
  await page.getByText('캔버스는 태블릿 이상에서 열어 주세요').waitFor();
  check('폰에서 캔버스는 안내만 보인다', true);
  await page.setViewportSize({ width: 820, height: 1100 });
  await sleep(300);
  check('태블릿에서는 캔버스가 열린다', !(await page.getByText('캔버스는 태블릿 이상에서 열어 주세요').isVisible()));
  await shot('26-tablet');
  await page.setViewportSize({ width: 1440, height: 900 });

  step('잔액 표시');
  queueCli('balance', '1051.33');
  await page.goto(`${BASE}/p/${projectId}`);
  await page.locator('[data-stat="balance"]', { hasText: '1,051.33' }).waitFor();
  check('기록한 잔액이 캔버스에 보인다', true);

  step('프롬프트 창이 화면 안에 들어오는지');
  await select('영상 1');
  await sleep(200);
  const panelBox = await panel().boundingBox();
  check('창이 화면 아래로 벗어나지 않는다', panelBox.y + panelBox.height <= 900, JSON.stringify(panelBox));
  check('창이 화면 오른쪽으로 벗어나지 않는다', panelBox.x + panelBox.width <= 1440, JSON.stringify(panelBox));
  await panel().getByRole('button', { name: '창 크게 펼치기' }).click();
  await sleep(450);
  const bigBox = await panel().boundingBox();
  check('크게 펼치면 넓어진다', bigBox.width > panelBox.width);
  check('크게 펼쳐도 화면 안이다', bigBox.y + bigBox.height <= 900 && bigBox.y >= 0, JSON.stringify(bigBox));
  await shot('23-panel-expanded');

  step('뒷정리 확인');
  check('화면 오류가 없다', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
  check('바깥으로 나간 요청이 없다', outsideRequests.length === 0, outsideRequests.slice(0, 5).join(' | '));
  check('서버 오류 기록이 없다', !/⨯|Error:/.test(serverLog), serverLog.slice(-800));
} catch (e) {
  failures++;
  console.error('\n시험이 중간에 멈췄어요:', e);
  await shot('zz-stopped').catch(() => undefined);
} finally {
  await browser.close();
  stopServer();
}

fs.rmSync(DATA, { recursive: true, force: true });
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
