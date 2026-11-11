// 간판 추적값(cx,cy,s)을 다항식 곡선으로 매끄럽게 맞추고, 기준 프레임에서 정확히 (103.75,224.5,1)이 되게 조금씩 당겨 맞춘다.
// 맞춘 구간 밖은 곡선 끝의 기울기로 곧게 이어 간다.
// 사용: node smooth-track.cjs <원본 json> <맞출 첫 프레임> <맞출 끝 프레임> <차수> <내보낼 첫 프레임> <내보낼 끝 프레임> <기준 프레임> <출력 json>
const fs = require('fs');
const [inp, aArg, bArg, degArg, o1Arg, o2Arg, anchorArg, out] = process.argv.slice(2);
const A = +aArg, B = +bArg, DEG = +degArg, O1 = +o1Arg, O2 = +o2Arg, ANCHOR = +anchorArg;
const raw = JSON.parse(fs.readFileSync(inp, 'utf8')).filter((p) => p.n >= A && p.n <= B);
const norm = (n) => (2 * (n - A)) / (B - A) - 1;
function fit(key) {
  // 최소제곱 다항식(정규방정식 + 가우스 소거)
  const m = DEG + 1;
  const M = Array.from({ length: m }, () => new Array(m).fill(0)), v = new Array(m).fill(0);
  for (const p of raw) {
    const x = norm(p.n), pw = Array.from({ length: m }, (_, i) => x ** i);
    for (let i = 0; i < m; i++) { v[i] += pw[i] * p[key]; for (let j = 0; j < m; j++) M[i][j] += pw[i] * pw[j]; }
  }
  for (let i = 0; i < m; i++) {
    let piv = i; for (let r = i + 1; r < m; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]]; [v[i], v[piv]] = [v[piv], v[i]];
    for (let r = i + 1; r < m; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < m; c++) M[r][c] -= f * M[i][c]; v[r] -= f * v[i]; }
  }
  const c = new Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) { let s = v[i]; for (let j = i + 1; j < m; j++) s -= M[i][j] * c[j]; c[i] = s / M[i][i]; }
  const f = (n) => c.reduce((acc, ci, i) => acc + ci * norm(n) ** i, 0);
  const val = (n) => {
    if (n < A) return f(A) + (f(A + 1) - f(A)) * (n - A);
    if (n > B) return f(B) + (f(B) - f(B - 1)) * (n - B);
    return f(n);
  };
  const resid = raw.map((p) => Math.abs(p[key] - f(p.n)));
  return { val, maxResid: Math.max(...resid), meanResid: resid.reduce((a, b) => a + b, 0) / resid.length };
}
const target = { cx: 103.75, cy: 224.5, s: 1 };
const res = [];
const fits = { cx: fit('cx'), cy: fit('cy'), s: fit('s') };
for (const k of Object.keys(fits)) console.log(k, 'max resid', fits[k].maxResid.toFixed(3), 'mean', fits[k].meanResid.toFixed(3));
for (let n = O1; n <= O2; n++) {
  const r = { n };
  for (const k of ['cx', 'cy', 's']) {
    // 기준 프레임과의 어긋남을 기준 프레임 둘레 20프레임에 걸쳐 0으로 맞춘다
    const off = target[k] - fits[k].val(ANCHOR);
    const w = Math.max(0, 1 - Math.abs(n - ANCHOR) / 20);
    r[k] = +(fits[k].val(n) + off * w).toFixed(4);
  }
  res.push(r);
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log('frames', res.length, 'first', JSON.stringify(res[0]), 'last', JSON.stringify(res[res.length - 1]));
