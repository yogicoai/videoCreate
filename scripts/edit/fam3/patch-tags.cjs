// 상자 좌표는 가족 요기보 3탄 3장면 첫 화면(2752×1536) 기준이다. 다른 그림은 상자만 바꾼다.
// 3장면 새 첫 화면의 옆면 흰 태그 2개를 오른쪽 배경 조각으로 덮는다(가장자리 부드럽게). 크레딧 0.
const sharp = require('sharp');
const [inp, out] = process.argv.slice(2);
const boxes = [[1514, 945, 42, 104], [1524, 1418, 64, 96]]; // x, y, w, h
(async () => {
  const comps = [];
  for (const [x, y, w, h] of boxes) {
    const pad = 10, W = w + pad * 2, H = h + pad * 2;
    const src = await sharp(inp).extract({ left: x + w + 6 - pad, top: y - pad, width: W, height: H }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 부드러운 사각 마스크(가장자리 pad 픽셀에 걸쳐 0→255)
    const m = Buffer.alloc(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const d = Math.min(i, j, W - 1 - i, H - 1 - j); m[j * W + i] = Math.max(0, Math.min(255, Math.round((d / pad) * 255))); }
    const d = src.data; for (let k = 0; k < W * H; k++) d[k * 4 + 3] = m[k];
    comps.push({ input: await sharp(d, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(), left: x - pad, top: y - pad });
  }
  await sharp(inp).composite(comps).png().toFile(out);
  await sharp(out).extract({ left: 1250, top: 450, width: 600, height: 1086 }).resize(400).jpeg({ quality: 90 }).toFile(process.argv[4]);
  console.log('ok', out);
})();
