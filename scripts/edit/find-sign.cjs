// 기계 위 간판의 안쪽 흰 판 네 모서리를 찾는다(480×854 기준). 가장 밝은 덩어리를 판으로 본다.
// 사용: node find-sign.cjs <프레임 png> [x0 y0 x1 y1]
const sharp = require('sharp');
const [file, ...box] = process.argv.slice(2);
const [bx0, by0, bx1, by1] = box.length ? box.map(Number) : [30, 160, 190, 290];
(async () => {
  const { data, info } = await sharp(file).resize(480, 854, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  // 판은 채도가 낮고 밝다(흰 분홍). 배경(살구)과 테두리(베이지)는 채도가 더 높다
  const isPanel = (x, y) => {
    const [r, g, b] = px(x, y);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx > 215 && (mx - mn) / mx < 0.12;
  };
  const mask = new Uint8Array(W * 854);
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) if (isPanel(x, y)) mask[y * W + x] = 1;
  // 가장 큰 연결 덩어리
  const seen = new Uint8Array(W * 854);
  let best = [];
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    const k = y * W + x;
    if (!mask[k] || seen[k]) continue;
    const comp = [], stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < bx0 || nx >= bx1 || ny < by0 || ny >= by1) continue;
        const nk = ny * W + nx;
        if (mask[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const pts = best.map((c) => [c % W, (c / W) | 0]);
  const pick = (f) => pts.reduce((a, p) => (f(p) > f(a) ? p : a));
  const tl = pick(([x, y]) => -(x + y)), br = pick(([x, y]) => x + y), tr = pick(([x, y]) => x - y), bl = pick(([x, y]) => y - x);
  console.log(JSON.stringify({ area: pts.length, tl, tr, br, bl }));
})();
