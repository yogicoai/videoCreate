// 상자 좌표는 가족 요기보 3탄 4장면(책 읽어 주기) 첫 화면(2752×1536) 기준이다.
// 그림책 속 작은 회색 글씨를 종이 색으로 덮는다(무료). 상자 안에서 종이보다 어두운 무채색 픽셀만 바꾼다.
const sharp = require('sharp');
const [inp, out, crop] = process.argv.slice(2);
const boxes = [[1166, 1082, 110, 38], [1352, 1138, 96, 38], [1456, 966, 30, 108]];
(async () => {
  const { data, info } = await sharp(inp).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  let n = 0;
  for (const [x0, y0, w, h] of boxes) {
    const vals = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 3; vals.push([data[i], data[i + 1], data[i + 2]]); }
    vals.sort((a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]));
    const paper = vals[Math.floor(vals.length * 0.2)];
    const pb = paper[0] + paper[1] + paper[2];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * W + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      if (r + g + b < pb - 18 && sat < 0.3) { data[i] = paper[0]; data[i + 1] = paper[1]; data[i + 2] = paper[2]; n++; }
    }
  }
  await sharp(data, { raw: { width: W, height: info.height, channels: 3 } }).png().toFile(out);
  await sharp(out).extract({ left: 1000, top: 650, width: 900, height: 700 }).resize(700).jpeg({ quality: 90 }).toFile(crop);
  console.log('바꾼 픽셀', n);
})();
