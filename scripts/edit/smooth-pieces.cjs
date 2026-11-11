// 간판 추적값을 끊기는 프레임(원본이 덜컥 움직이는 곳)마다 나눠, 조각별로 매끄러운 곡선을 맞춘다. 마지막 조각은 기준 프레임에서 정확히 기준 위치가 되게 당겨 맞춘다.
// 사용: node smooth-pieces.cjs <원본 json> <조각 경계들 예: 640,648,672,696> <차수> <내보낼 첫 프레임> <기준 프레임> <출력 json>
const fs = require('fs');
const [inp, cutsArg, degArg, o1Arg, anchorArg, out] = process.argv.slice(2);
const cuts = cutsArg.split(',').map(Number), DEG = +degArg, O1 = +o1Arg, ANCHOR = +anchorArg;
const raw = JSON.parse(fs.readFileSync(inp, 'utf8'));
function polyfit(pts, key, deg) {
  const A = pts[0].n, B = pts[pts.length - 1].n, norm = (n) => (B === A ? 0 : (2 * (n - A)) / (B - A) - 1);
  const m = Math.min(deg, pts.length - 2) + 1;
  const M = Array.from({ length: m }, () => new Array(m).fill(0)), v = new Array(m).fill(0);
  for (const p of pts) { const x = norm(p.n); for (let i = 0; i < m; i++) { v[i] += x ** i * p[key]; for (let j = 0; j < m; j++) M[i][j] += x ** (i + j); } }
  for (let i = 0; i < m; i++) { for (let r = i + 1; r < m; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < m; c++) M[r][c] -= f * M[i][c]; v[r] -= f * v[i]; } }
  const c = new Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) { let s = v[i]; for (let j = i + 1; j < m; j++) s -= M[i][j] * c[j]; c[i] = s / M[i][i]; }
  return (n) => c.reduce((acc, ci, i) => acc + ci * norm(n) ** i, 0);
}
const pieces = [];
for (let i = 0; i < cuts.length - 1; i++) {
  const a = cuts[i], b = i === cuts.length - 2 ? cuts[i + 1] : cuts[i + 1] - 1;
  const pts = raw.filter((p) => p.n >= a && p.n <= b);
  pieces.push({ a, b, f: { cx: polyfit(pts, 'cx', DEG), cy: polyfit(pts, 'cy', DEG), s: polyfit(pts, 's', DEG) } });
}
const target = { cx: 103.75, cy: 224.5, s: 1 };
const last = pieces[pieces.length - 1];
const res = [];
for (let n = O1; n <= ANCHOR; n++) {
  let p = pieces.find((q) => n >= q.a && n <= q.b);
  const r = { n };
  for (const k of ['cx', 'cy', 's']) {
    let val;
    if (!p) { const q = pieces[0]; val = q.f[k](q.a) + (q.f[k](q.a + 1) - q.f[k](q.a)) * (n - q.a); } // 첫 조각 앞은 곧게 이어 감
    else val = p.f[k](n);
    if (p === last) { const off = target[k] - last.f[k](ANCHOR); val += off * Math.max(0, 1 - (ANCHOR - n) / 20); }
    r[k] = +val.toFixed(4);
  }
  res.push(r);
}
// 남은 어긋남
const m = new Map(res.map((r) => [r.n, r]));
const d = raw.filter((p) => m.has(p.n) && p.n >= cuts[0]).map((p) => Math.hypot(p.cx - m.get(p.n).cx, p.cy - m.get(p.n).cy));
console.log('pieces', pieces.map((q) => `${q.a}-${q.b}`).join(' '), '| resid max', Math.max(...d).toFixed(2), 'mean', (d.reduce((a, b) => a + b, 0) / d.length).toFixed(2));
fs.writeFileSync(out, JSON.stringify(res, null, 1));
