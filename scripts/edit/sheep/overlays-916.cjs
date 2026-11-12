// 양 편집본의 로고 오버레이(1920×1080)를 세로 숏츠용(1080×1920)으로 옮긴다(무료).
// 로고와 둘레의 흰 빛은 원본 오버레이에서 그대로 떼어 와 크기와 자리만 바꾼다.
//   처음 작은 로고: 왼쪽 위(숏츠 상단 메뉴 아래)
//   끝 큰 로고: 가운데, 위쪽 하늘(세로 화면 높이의 약 25%)
// 실행: 프로젝트 폴더에서 node ../../../scripts/edit/sheep/overlays-916.cjs
const path = require('path');
const sharp = require(path.join(__dirname, '../../../node_modules/sharp'));

const W = 1080, H = 1920;

async function crop(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 2) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  return { buf: await sharp(file).extract({ left: x0, top: y0, width, height }).png().toBuffer(), width, height };
}

async function place(srcFile, outFile, scale, left, top) {
  const c = await crop(srcFile);
  const w = Math.round(c.width * scale), h = Math.round(c.height * scale);
  const img = await sharp(c.buf).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  const x = left === 'center' ? Math.round((W - w) / 2) : left;
  const y = typeof top === 'number' && top < 1 ? Math.round(H * top - h / 2) : top;
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: img, left: x, top: y }])
    .png().toFile(outFile);
  console.log(`${outFile}  로고 ${w}x${h} @ ${x},${y}`);
}

(async () => {
  // 원본 1920 폭에서 294px(15%) → 세로 1080 폭에서 250px(23%)
  await place('edit/overlay-front-1080.png', 'shorts/overlay-front-916.png', 0.85, 40, 120);
  // 원본 556px(29%) → 세로 화면 폭의 약 51%(556px 그대로), 화면 높이 25% 자리 가운데
  await place('edit/overlay-end-logo-1080.png', 'shorts/overlay-end-logo-916.png', 1.0, 'center', 0.25);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
