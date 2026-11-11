/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 시트에서 제품 색만 참조 사진 색으로 맞춘다. 크레딧이 들지 않는다. 원본은 지우지 않는다.
 * 생성이 청록 쪽으로 틀어진 시트를 파란 계열로 되돌릴 때 썼다(2026-11-05). 다른 색이면 weightOf 범위를 먼저 고친다.
 *
 *   node scripts/recolor-sheet.cjs <프로젝트> <스토리보드 칸 id> <시트 job id> <참조 사진 파일 이름>
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const sharp = require('sharp');
const [PROJECT, BOARD, JOB, REFERENCE] = process.argv.slice(2);
if (!REFERENCE) {
  console.error('사용: node scripts/recolor-sheet.cjs <프로젝트> <스토리보드 칸 id> <시트 job id> <참조 사진 파일 이름>');
  process.exit(1);
}

const projectDir = `${ROOT}/data/projects/${PROJECT}`;
const filesDir = `${projectDir}/files`;
const stem = JOB.replace(/[^a-z0-9]/g, '_');

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 무엇이 빈백인지 가른다: 청록 범위이고 채도가 높은 곳 */
const weightOf = (h, s, l) => smooth(158, 170, h) * (1 - smooth(198, 206, h)) * smooth(0.28, 0.42, s) * smooth(0.08, 0.16, l) * (1 - smooth(0.88, 0.95, l));

async function raw(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

/** 사진 가운데의 제품 색 */
async function referenceColor(file) {
  const { data, info } = await raw(file);
  const hs = [];
  const ss = [];
  const ls = [];
  for (let y = Math.floor(info.height * 0.35); y < info.height * 0.55; y += 2) {
    for (let x = Math.floor(info.width * 0.3); x < info.width * 0.7; x += 2) {
      const i = (y * info.width + x) * 3;
      const [h, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2]);
      hs.push(h); ss.push(s); ls.push(l);
    }
  }
  const mid = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
  return { h: mid(hs), s: mid(ss), l: mid(ls) };
}

async function sourceColor(file) {
  const { data, info } = await raw(file);
  const hs = [];
  const ss = [];
  const ls = [];
  for (let i = 0; i < data.length; i += 3) {
    const [h, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2]);
    if (weightOf(h, s, l) > 0.9) { hs.push(h); ss.push(s); ls.push(l); }
  }
  const mid = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
  return { h: mid(hs), s: mid(ss), l: mid(ls), share: hs.length / (info.width * info.height) };
}

async function recolor(input, output, from, to, kind) {
  const { data, info } = await raw(input);
  const out = Buffer.from(data);
  const dh = to.h - from.h;
  const ks = to.s / from.s;
  const kl = to.l / from.l;
  for (let i = 0; i < data.length; i += 3) {
    const [h, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2]);
    const w = weightOf(h, s, l);
    if (!w) continue;
    const [r, g, b] = hsl2rgb((h + dh + 360) % 360, Math.min(1, s * ks), Math.min(1, l * kl));
    out[i] = Math.round(data[i] + (r - data[i]) * w);
    out[i + 1] = Math.round(data[i + 1] + (g - data[i + 1]) * w);
    out[i + 2] = Math.round(data[i + 2] + (b - data[i + 2]) * w);
  }
  const image = sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } });
  if (kind === 'png') await image.png().toFile(output);
  else await image.jpeg({ quality: 93 }).toFile(output);
  return { width: info.width, height: info.height, bytes: fs.statSync(output).size };
}

(async () => {
  const ref = await referenceColor(`${filesDir}/${REFERENCE}`);
  const sheetFile = `${filesDir}/r_${stem}.png`;
  const src = await sourceColor(sheetFile);
  console.log('참조 색', JSON.stringify(ref));
  console.log('시트 색', JSON.stringify(src));

  const boardsPath = `${projectDir}/boards.json`;
  const boards = JSON.parse(fs.readFileSync(boardsPath, 'utf8'));
  const board = boards[BOARD];
  const filesPath = `${projectDir}/files.json`;
  const files = JSON.parse(fs.readFileSync(filesPath, 'utf8'));
  const now = new Date().toISOString();

  // 시트
  const newSheet = `r_${stem}_blue.png`;
  const sheetInfo = await recolor(sheetFile, `${filesDir}/${newSheet}`, src, ref, 'png');
  files.push({ name: newSheet, originalName: '스토리보드 (색 맞춤)', kind: 'result', mediaKind: 'image', mime: 'image/png', ...sheetInfo, createdAt: now });

  // 칸
  const panels = [];
  for (const [index, panel] of board.panels.entries()) {
    const name = `p_${stem}_blue_${index + 1}.jpg`;
    const info = await recolor(`${filesDir}/${panel}`, `${filesDir}/${name}`, src, ref, 'jpg');
    files.push({ name, originalName: `스토리보드 ${index + 1}번 칸 (색 맞춤)`, kind: 'panel', mediaKind: 'image', mime: 'image/jpeg', ...info, createdAt: now });
    panels.push(name);
  }
  fs.writeFileSync(filesPath, JSON.stringify(files, null, 2));
  board.panels = panels;
  board.sheetFile = newSheet;
  board.updatedAt = now;
  fs.writeFileSync(boardsPath, JSON.stringify(boards, null, 2));

  const jobsPath = `${projectDir}/jobs.json`;
  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const job = jobs.find((j) => j.id === JOB);
  job.result.file = newSheet;
  job.result.bytes = sheetInfo.bytes;
  job.result.mime = 'image/png';
  fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2));

  console.log('완료', newSheet, panels.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
