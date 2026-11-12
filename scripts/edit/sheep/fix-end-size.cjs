// 끝 화면에서 「제품 + 그 위에 잠든 양」만 떼어 크기와 자리를 첫 화면에 맞춘 배치 목업을 만든다(무료).
// 생성 모델이 끝 화면을 그리며 제품을 키워 버렸을 때 쓴다. 결과는 영상에 직접 쓰지 않고
// 「1번 그림은 배치 참고용이다」 프롬프트로 다시 그리게 하는 참고 그림이다.
//
// 실행: node fix-end-size.cjs <첫 화면> <끝 화면> <출력 png> [길이 배율=1.05] [가로 이동 비율=-0.019] [바닥 이동 비율=0.007]
//   길이 배율: 끝 화면 제품 길이 / 첫 화면 제품 길이 (16:9 판은 1.05였다. 양 무게로 조금 퍼진다)
//   가로 이동: 화면 폭 대비 제품 가운데가 움직일 양(16:9 판은 왼쪽으로 1.9%)
//   바닥 이동: 화면 높이 대비 제품 바닥이 내려올 양
// 제품은 파란 픽셀, 양은 따뜻한 밝은 털빛으로 찾는다. 빈 자리는 주변 색으로 흐리게 메운다(모델이 다시 그린다).
const path = require('path');
const sharp = require(path.join(__dirname, '../../../node_modules/sharp'));

const [, , firstFile, endFile, outFile, lenRatioArg, dxArg, dyArg] = process.argv;
if (!firstFile || !endFile || !outFile) {
  console.error('사용: node fix-end-size.cjs <첫 화면> <끝 화면> <출력 png> [길이 배율] [가로 이동] [바닥 이동]');
  process.exit(1);
}
const LEN = Number(lenRatioArg ?? 1.05), DX = Number(dxArg ?? -0.019), DY = Number(dyArg ?? 0.007);

const isBlue = (r, g, b) => b > 140 && r < 90 && b - g > 40;
// 지울 자리를 찾을 때는 그늘진 파랑까지 넓게 잡는다(풀은 초록이 파랑보다 크다)
const isBlueLoose = (r, g, b) => b > 60 && b - r > 40 && b - g > 8;
const isWool = (r, g, b) => r > 135 && g > 120 && b > 90 && r - b > 12 && r >= g - 6;

async function load(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

function blueBox({ data, W, H }) {
  const cols = new Array(W).fill(0), rows = new Array(H).fill(0);
  for (let y = Math.floor(H * 0.3); y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (isBlue(data[i], data[i + 1], data[i + 2])) { cols[x]++; rows[y]++; }
    }
  }
  const span = (a) => {
    const m = Math.max(...a) * 0.08;
    return [a.findIndex((v) => v > m), a.length - 1 - [...a].reverse().findIndex((v) => v > m)];
  };
  const [x0, x1] = span(cols), [y0, y1] = span(rows);
  return { x0, x1, y0, y1 };
}

// 제품 + 양 실루엣: 제품 상자 주변에서 파란색·털빛을 찾고, 기둥마다 위아래 사이를 채우고, 조금 넓힌다
// xPad: 제품 상자 좌우로 얼마나 넓혀 찾을지(첫 화면은 양이 제품 옆에 있어 가로 전체를 본다)
function subjectMask(img, box, xPad = 40) {
  const { data, W, H } = img;
  const m = new Uint8Array(W * H);
  const X0 = Math.max(0, box.x0 - xPad), X1 = Math.min(W - 1, box.x1 + xPad);
  const Y0 = Math.max(0, box.y0 - Math.round((box.y1 - box.y0) * 1.6)), Y1 = Math.min(H - 1, box.y1 + 45);
  // 파랑은 제품 높이 안에서만 찾는다(위로 가면 하늘·먼 산도 푸르다). 털빛은 제품 위쪽까지 찾는다
  const BY0 = Math.max(0, box.y0 - 30);
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      const i = (y * W + x) * 3;
      const blue = y >= BY0 && isBlueLoose(data[i], data[i + 1], data[i + 2]);
      if (blue || isWool(data[i], data[i + 1], data[i + 2])) m[y * W + x] = 1;
    }
  }
  for (let x = X0; x <= X1; x++) {
    let top = -1, bot = -1;
    for (let y = Y0; y <= Y1; y++) if (m[y * W + x]) { if (top < 0) top = y; bot = y; }
    if (top >= 0 && bot - top > 4) for (let y = top; y <= bot; y++) m[y * W + x] = 1;
  }
  // 넓히기(그림자와 닿은 자리까지)
  const R = 14, out = new Uint8Array(W * H);
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      if (!m[y * W + x]) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W) out[yy * W + xx] = 1;
      }
    }
  }
  return out;
}

// 구멍(mask=1)을 피라미드로 주변 색을 끌어와 메운다
function pushPull(data, W, H, mask) {
  const levels = [];
  let cur = { w: W, h: H, c: new Float32Array(W * H * 3), a: new Float32Array(W * H) };
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) { cur.a[i] = 1; for (let k = 0; k < 3; k++) cur.c[i * 3 + k] = data[i * 3 + k]; }
  }
  levels.push(cur);
  while (cur.w > 2 && cur.h > 2) {
    const w = Math.ceil(cur.w / 2), h = Math.ceil(cur.h / 2);
    const nx = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0; const c = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const yy = Math.min(cur.h - 1, y * 2 + dy), xx = Math.min(cur.w - 1, x * 2 + dx), j = yy * cur.w + xx;
        a += cur.a[j]; for (let k = 0; k < 3; k++) c[k] += cur.c[j * 3 + k];
      }
      const j = y * w + x;
      nx.a[j] = Math.min(1, a);
      if (a > 0) for (let k = 0; k < 3; k++) nx.c[j * 3 + k] = c[k] / a * Math.min(1, a);
    }
    levels.push(nx); cur = nx;
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const j = y * L.w + x, u = Math.min(U.h - 1, y >> 1) * U.w + Math.min(U.w - 1, x >> 1);
      const a = L.a[j];
      for (let k = 0; k < 3; k++) {
        const own = a > 0 ? L.c[j * 3 + k] / a : 0, up = U.a[u] > 0 ? U.c[u * 3 + k] / U.a[u] : 0;
        L.c[j * 3 + k] = (own * a + up * (1 - a));
      }
      L.a[j] = 1;
    }
  }
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) out[i] = Math.max(0, Math.min(255, Math.round(levels[0].c[i])));
  return out;
}

(async () => {
  const first = await load(firstFile), end = await load(endFile);
  if (first.W !== end.W || first.H !== end.H) throw new Error('두 그림 크기가 달라요');
  const { W, H } = end;
  const fb = blueBox(first), eb = blueBox(end);
  const mask = subjectMask(end, eb);

  // 배경판: 끝 화면에서 제품과 양을 지운 자리를 메운다.
  //  1) 첫 화면에서 그 자리가 배경이면 첫 화면 픽셀을 쓴다(하늘·언덕·울타리가 같은 그림이다)
  //  2) 첫 화면에서도 양·제품이 있던 자리는 같은 줄 왼쪽(모자라면 오른쪽) 배경 140px을 되풀이해 이어 붙인다
  //  3) 그래도 남는 곳은 주변 색으로 흐리게 메운다
  const maskF = subjectMask(first, fb, W);
  const plate = Buffer.from(end.data);
  const hole = new Uint8Array(W * H);
  const P = 140;
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!mask[y * W + x]) { x++; continue; }
      let xr = x; while (xr < W && mask[y * W + xr]) xr++;
      for (let xx = x; xx < xr; xx++) {
        const i = y * W + xx;
        if (!maskF[i]) { for (let k = 0; k < 3; k++) plate[i * 3 + k] = first.data[i * 3 + k]; continue; }
        let src = -1;
        if (x >= P) src = x - 1 - ((xx - x) % P);
        else if (W - xr >= P) src = xr + ((xx - x) % P);
        if (src >= 0 && !mask[y * W + src]) for (let k = 0; k < 3; k++) plate[i * 3 + k] = end.data[(y * W + src) * 3 + k];
        else hole[i] = 1;
      }
      x = xr;
    }
  }
  if (hole.some(Boolean)) {
    const filled = pushPull(plate, W, H, hole);
    const soft = await sharp(filled, { raw: { width: W, height: H, channels: 3 } }).blur(10).raw().toBuffer();
    for (let i = 0; i < W * H; i++) if (hole[i]) for (let k = 0; k < 3; k++) plate[i * 3 + k] = soft[i * 3 + k];
  }
  // 메운 자리와 원래 자리의 경계를 살짝 섞는다
  const blurred = await sharp(plate, { raw: { width: W, height: H, channels: 3 } }).blur(2).raw().toBuffer();
  for (let i = 0; i < W * H; i++) if (mask[i]) for (let k = 0; k < 3; k++) plate[i * 3 + k] = blurred[i * 3 + k];

  // 떼어 낸 제품 + 양(테두리 3px 부드럽게)
  let mx0 = W, my0 = H, mx1 = 0, my1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y;
  }
  const cw = mx1 - mx0 + 1, ch = my1 - my0 + 1;
  const cut = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = ((my0 + y) * W + (mx0 + x)), di = (y * cw + x) * 4;
    for (let k = 0; k < 3; k++) cut[di + k] = end.data[si * 3 + k];
    cut[di + 3] = mask[si] ? 255 : 0;
  }
  const scale = (LEN * (fb.x1 - fb.x0)) / (eb.x1 - eb.x0);
  const sw = Math.round(cw * scale), sh = Math.round(ch * scale);
  const small = await sharp(cut, { raw: { width: cw, height: ch, channels: 4 } }).resize(sw, sh).raw().toBuffer();
  // 알파만 3×3으로 두 번 흐려 테두리를 부드럽게 한다
  for (let pass = 0; pass < 2; pass++) {
    const a = new Uint8Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) a[i] = small[i * 4 + 3];
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < sh && xx >= 0 && xx < sw) { s += a[yy * sw + xx]; n++; }
      }
      small[(y * sw + x) * 4 + 3] = Math.round(s / n);
    }
  }
  const subject = await sharp(small, { raw: { width: sw, height: sh, channels: 4 } }).png().toBuffer();

  // 자리: 제품 가운데와 바닥을 첫 화면 기준으로 맞춘다
  const fcx = (fb.x0 + fb.x1) / 2 + DX * W, fbot = fb.y1 + DY * H;
  const ecxInCut = ((eb.x0 + eb.x1) / 2 - mx0) * scale, ebotInCut = (eb.y1 - my0) * scale;
  const left = Math.round(fcx - ecxInCut), top = Math.round(fbot - ebotInCut);

  await sharp(plate, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: subject, left, top }])
    .png().toFile(outFile);
  console.log(`첫 화면 제품 ${fb.x1 - fb.x0}px, 끝 화면 제품 ${eb.x1 - eb.x0}px → ${(scale * 100).toFixed(1)}%로 줄여 ${Math.round(scale * (eb.x1 - eb.x0))}px (첫 화면의 ${(LEN * 100).toFixed(0)}%)`);
  console.log(`${outFile}  제품+양 ${sw}x${sh} @ ${left},${top}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
