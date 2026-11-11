// 편집본 v2: v1에 더해 이음새마다 다음 장면 첫머리의 밝기·색(채널별 배율)과 크기(약 3% 확대)를 앞 장면 끝에 맞추고,
// 그 보정을 천천히 풀어 준다. 같은 그림끼리 만나는 이음새는 1프레임만 겹쳐 사실상 바로 붙인다. 크레딧 0.
// 사용: node build-edit-v2.cjs <출력 mp4>
const fs = require('fs');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const F = 'data/projects/p_6eb3a2ed4b20b8a0/files/';
const E = (process.env.EDIT_WORK || 'tests/.tmp/edit') + '/';
const SEG = E + 'seg5/';
const OUT = process.argv[2];
fs.mkdirSync(SEG, { recursive: true });
const FPS = 24;
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2'];
const seams = JSON.parse(fs.readFileSync(E + 'seams.json', 'utf8'));

// xf: 다음 장면과 겹치는 프레임 수. geo: 이 장면 첫머리를 앞 장면 끝 크기에 맞추는 확대(480×854 기준), gain: 채널별 배율
const scenes = [
  { name: 's1', file: 'r_j_65d7f590eb570873.mp4', from: 0, to: 120, xf: 3 },
  { name: 's2', file: 'r_j_36eee8a13ed2da9b.mp4', from: 0, to: 96, xf: 1 },
  { name: 's3', file: 'r_j_0be1c3de3fdde803.mp4', from: 0, to: 90, xf: 3 },
  { name: 's4', file: 'r_j_d4118d4f3b419745.mp4', from: 0, to: 61, xf: 1 },
  { name: 's5', file: 'r_j_25758e7071da3553.mp4', from: 0, to: 67, xf: 4 },
  { name: 's6', file: 'r_j_4923de3d1d0a3edd.mp4', from: 0, to: 96, xf: 3 },
  { name: 's7', file: 'r_j_3a55136547ddd2e5.mp4', from: 22, to: 144, xf: 6 },
];
const HOLD = 48;
for (let i = 2; i < scenes.length; i++) {
  const r = seams.find((x) => x.seam === `${scenes[i - 1].name}->${scenes[i].name}`);
  scenes[i].gain = r.gain;
  scenes[i].geo = { s: r.back.s, x: r.back.x0, y: r.back.y0 };
}

(async () => {
  // 장면 2의 색은 「줌으로 당긴 장면 1 끝 영역」에 맞춘다
  {
    const a = SEG + 's1_last.png', b = SEG + 's2_first.png';
    ff(['-i', F + scenes[0].file, '-vf', `select='eq(n\\,${scenes[0].to})'`, '-frames:v', '1', a]);
    ff(['-i', F + scenes[1].file, '-vf', `select='eq(n\\,${scenes[1].from})'`, '-frames:v', '1', b]);
    const ma = (await sharp(await sharp(a).extract({ left: 155, top: 225, width: 227, height: 404 }).png().toBuffer()).stats()).channels.slice(0, 3).map((c) => c.mean);
    const mb = (await sharp(b).stats()).channels.slice(0, 3).map((c) => c.mean);
    scenes[1].gain = ma.map((v, k) => +(v / mb[k]).toFixed(3));
  }
  console.log(JSON.stringify(scenes.map((s) => ({ n: s.name, gain: s.gain, geo: s.geo }))));

  const fadeExpr = (D) => `pow(max(0\\,1-T/${D})\\,2)`; // 1 → 0 으로 부드럽게
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const frames = s.to - s.from + 1;
    let graph = `[0:v]trim=start_frame=${s.from}:end_frame=${s.to + 1},setpts=PTS-STARTPTS`;
    if (s.gain) {
      const big = Math.max(...s.gain.map((g) => Math.abs(g - 1)));
      const D = Math.min(big > 0.08 ? 2.0 : 1.2, (frames / FPS) * 0.7).toFixed(2);
      const ch = (c, g) => `${c}='clip(${c}(X\\,Y)*(1+(${g}-1)*${fadeExpr(D)})\\,0\\,255)'`;
      graph += `,format=gbrp,geq=${ch('r', s.gain[0])}:${ch('g', s.gain[1])}:${ch('b', s.gain[2])}`;
    }
    graph += `,scale=2160:3840:flags=lanczos`;
    if (i === 0) {
      graph += `[b];[b][1:v]overlay=200:760:shortest=1`;
      const n0 = s.to - 13;
      const e = `st(0,clip((on-${n0 - 1})/14,0,1));st(1,if(lt(ld(0),0.5),2*ld(0)*ld(0),1-2*(1-ld(0))*(1-ld(0))))`;
      graph += `,zoompan=z='${e};2160/(2160-1138.5*ld(1))':x='${e};695.25*ld(1)':y='${e};1010.25*ld(1)':d=1:s=1080x1920:fps=${FPS}`;
    } else if (s.geo) {
      // 첫 프레임은 앞 장면 끝 크기(배율 s, 왼쪽 위 x,y)에서 시작해 18프레임 동안 원래 크기로 풀린다
      const k = 4.5;
      const e = `st(0,clip(on/18,0,1));st(1,1-(1-ld(0))*(1-ld(0)))`;
      const Wc = (2160 / s.geo.s).toFixed(2);
      graph += `,zoompan=z='${e};2160/(${Wc}+(2160-${Wc})*ld(1))':x='${e};${(s.geo.x * k).toFixed(2)}*(1-ld(1))':y='${e};${(s.geo.y * k).toFixed(2)}*(1-ld(1))':d=1:s=1080x1920:fps=${FPS}`;
    } else {
      graph += `,scale=1080:1920:flags=lanczos`;
    }
    graph += `,unsharp=5:5:0.6:5:5:0.0,setsar=1,format=yuv420p[v];`;
    // 원본 소리가 화면보다 짧으면(약 0.07초) 무음으로 채우지 않고 소리를 아주 조금 늘려 빈틈을 없앤다
    const aDur = +execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', F + s.file], { encoding: 'utf8' }).trim();
    const avail = Math.min(aDur, (s.to + 1) / FPS) - s.from / FPS;
    const ratio = avail / (frames / FPS);
    const tempo = ratio < 0.999 ? `,atempo=${ratio.toFixed(5)}` : '';
    console.log(s.name, 'audio', avail.toFixed(3), 'video', (frames / FPS).toFixed(3), 'tempo', ratio.toFixed(4));
    graph += `[0:a]atrim=start=${s.from / FPS}:end=${(s.to + 1) / FPS},asetpts=PTS-STARTPTS${tempo},apad,atrim=duration=${(frames / FPS).toFixed(6)}[a]`;
    fs.writeFileSync(SEG + s.name + '.graph', graph);
    const inputs = ['-i', F + s.file];
    if (i === 0) inputs.push('-framerate', String(FPS), '-i', E + 'ovl-start/f_%04d.png');
    ff([...inputs, '-/filter_complex', SEG + s.name + '.graph', '-map', '[v]', '-map', '[a]', '-frames:v', String(frames), ...enc, SEG + s.name + '.mov']);
  }
  // 끝 정지 화면 + 로고
  {
    ff(['-sseof', '-0.1', '-i', SEG + 's7.mov', '-frames:v', '1', '-update', '1', SEG + 'last.png']);
    const graph =
      `[0:v]loop=loop=${HOLD - 1}:size=1:start=0,setpts=N/${FPS}/TB,fps=${FPS}[b];[b][1:v]overlay=60:360:shortest=1,format=yuv420p[v];` +
      `anullsrc=r=48000:cl=stereo,atrim=duration=${HOLD / FPS}[a]`;
    fs.writeFileSync(SEG + 'hold.graph', graph);
    ff(['-i', SEG + 'last.png', '-framerate', String(FPS), '-i', E + 'ovl-end/f_%04d.png', '-/filter_complex', SEG + 'hold.graph', '-map', '[v]', '-map', '[a]', '-frames:v', String(HOLD), ...enc, SEG + 'hold.mov']);
  }
  // 이어 붙이기
  {
    const parts = [...scenes.map((s) => ({ file: SEG + s.name + '.mov', frames: s.to - s.from + 1, xf: s.xf })), { file: SEG + 'hold.mov', frames: HOLD, xf: 0 }];
    const rms = (file, ss, t) => { const out = execFileSync('ffmpeg', ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', file, '-vn', '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return 0; };
    const level = (file, ss, t) => { const r = require('child_process').spawnSync('ffmpeg', ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', file, '-vn', '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /RMS level dB: (-?[0-9.]+)/.exec(r.stderr); return m ? +m[1] : null; };
    const gains = parts.map(() => 0);
    for (let i = 1; i < parts.length - 1; i++) {
      const prevDur = parts[i - 1].frames / FPS;
      const tail = level(parts[i - 1].file, Math.max(0, prevDur - 0.4), 0.4), head = level(parts[i].file, 0, 0.4);
      if (tail !== null && head !== null) gains[i] = Math.max(-6, Math.min(6, tail - head));
      if (i === 6) gains[i] = 0; // 장면 7 첫머리의 「짠」은 일부러 큰 소리라 줄이지 않는다
      console.log('seam audio', i, 'tail', tail, 'head', head, 'gain dB', gains[i].toFixed(1));
    }
    const inputs = parts.flatMap((p) => ['-i', p.file]);
    let graph = '', acc = parts[0].frames, vPrev = '[0:v]', aPrev = '[0:a]';
    for (let i = 1; i < parts.length; i++) {
      const xf = parts[i - 1].xf;
      const vOut = i === parts.length - 1 ? '[v]' : `[v${i}]`, aOut = i === parts.length - 1 ? '[a]' : `[a${i}]`;
      graph += `${vPrev}[${i}:v]xfade=transition=fade:duration=${(xf / FPS).toFixed(4)}:offset=${((acc - xf) / FPS).toFixed(4)}${vOut};`;
      graph += `[${i}:a]volume='pow(10,${gains[i].toFixed(2)}*max(0,1-t/0.6)/20)':eval=frame[g${i}];`;
      graph += `${aPrev}[g${i}]acrossfade=d=${(xf / FPS).toFixed(4)}:c1=tri:c2=tri${aOut};`;
      acc = acc - xf + parts[i].frames;
      vPrev = vOut; aPrev = aOut;
    }
    fs.writeFileSync(SEG + 'join.graph', graph.replace(/;$/, ''));
    ff([...inputs, '-/filter_complex', SEG + 'join.graph', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT]);
    console.log(JSON.stringify({ out: OUT, frames: acc, seconds: +(acc / FPS).toFixed(2) }));
  }
})();
