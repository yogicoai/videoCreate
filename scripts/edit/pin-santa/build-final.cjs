// 한 번에 뽑은 영상 편집 v2: 4.9초는 원본 컷 그대로(줌 없음). 시작 간판 로고(카메라를 따라감) → 본편 → 끝 간판 로고 1초 → 흰 화면 로고 + 「요기보」.
// 무료 1080p 키우기. 음악 파일을 주면 깔아 준다.  사용: node build-one-v2.cjs <출력 mp4> [음악 파일]
const fs = require('fs');
const { execFileSync } = require('child_process');
const SRC = 'data/projects/p_6eb3a2ed4b20b8a0/files/r_j_6c8d29bc49ea8102.mp4';
const LOGO = 'data/library/kits/yogibo-endcard/yogibo-logo.png';
const VOICE = 'data/library/kits/yogibo-endcard/yogibo-voice.wav';
const E = (process.env.EDIT_WORK || 'tests/.tmp/edit') + '/one/';
const SEG = E + 'seg4/';
const [OUT, MUSIC] = process.argv.slice(2);
fs.mkdirSync(SEG, { recursive: true });
const FPS = 24;
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2'];
const SHARP = 'unsharp=5:5:0.6:5:5:0.0,setsar=1,format=yuv420p';
const LOUD = 'volume=4dB,alimiter=limit=0.89:level=false';
const LAST = 696, LOGO_FRAMES = 117, HOLD = 24, CARD = 42;
const parts = [];
// AB) 0~696 전체를 키우고, 0~116에 간판 로고(2160 기준으로 그린 것을 반으로 줄여)를 얹는다
if (!fs.existsSync(SEG + 'ab.mov')) {
  const frames = LAST + 1;
  const graph =
    `[0:v]trim=end_frame=${frames},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos[b];` +
    `[1:v]scale=450:450:flags=lanczos[o];[2:v]format=rgba,scale=450:700:flags=lanczos,tpad=start=630:start_mode=add:color=0x00000000[p];[b][o]overlay=0:250:eof_action=pass[b2];[b2][p]overlay=0:0:eof_action=pass,${SHARP}[v];` +
    `[0:a]asetpts=PTS-STARTPTS,${LOUD},apad,atrim=duration=${(frames / FPS).toFixed(6)}[a]`;
  fs.writeFileSync(SEG + 'ab.graph', graph);
  ff(['-i', SRC, '-framerate', String(FPS), '-i', E + 'ovl-start2/f_%04d.png', '-framerate', String(FPS), '-i', E + 'ovl-pull2/f_%04d.png', '-/filter_complex', SEG + 'ab.graph', '-map', '[v]', '-map', '[a]', '-frames:v', String(frames), ...enc, SEG + 'ab.mov']);
}
parts.push({ file: SEG + 'ab.mov', frames: LAST + 1, xf: 1 });
// C) 마지막 화면 1초 + 간판 로고가 톡 나타나 반짝임
if (!fs.existsSync(SEG + 'c.mov')) {
  ff(['-sseof', '-0.1', '-i', SEG + 'ab.mov', '-frames:v', '1', '-update', '1', SEG + 'last.png']);
  const graph =
    `[0:v]loop=loop=${HOLD - 1}:size=1:start=0,setpts=N/${FPS}/TB,fps=${FPS}[b];[b][1:v]overlay=60:360:shortest=1,format=yuv420p[v];` +
    `anullsrc=r=48000:cl=stereo,atrim=duration=${HOLD / FPS}[a]`;
  fs.writeFileSync(SEG + 'c.graph', graph);
  ff(['-i', SEG + 'last.png', '-framerate', String(FPS), '-i', E + 'ovl-end/f_%04d.png', '-/filter_complex', SEG + 'c.graph', '-map', '[v]', '-map', '[a]', '-frames:v', String(HOLD), ...enc, SEG + 'c.mov']);
}
parts.push({ file: SEG + 'c.mov', frames: HOLD, xf: 6 });
// D) 흰 화면 로고 + 「요기보」
if (!fs.existsSync(SEG + 'd.mov')) {
  const graph =
    `color=c=white:s=1080x1920:r=${FPS}:d=${(CARD / FPS).toFixed(4)}[w];` +
    `[0:v]format=rgba,fade=t=in:st=0:d=0.2:alpha=1[l];[w][l]overlay=(W-w)/2:(H-h)/2:shortest=0,format=yuv420p[v];` +
    `[1:a]aresample=48000,volume=13dB,alimiter=limit=0.89:level=false,adelay=120|120,apad,atrim=duration=${(CARD / FPS).toFixed(6)}[a]`;
  fs.writeFileSync(SEG + 'd.graph', graph);
  ff(['-loop', '1', '-framerate', String(FPS), '-i', LOGO, '-i', VOICE, '-/filter_complex', SEG + 'd.graph', '-map', '[v]', '-map', '[a]', '-frames:v', String(CARD), ...enc, SEG + 'd.mov']);
}
parts.push({ file: SEG + 'd.mov', frames: CARD, xf: 0 });
// 이어 붙이기(+ 음악)
{
  const inputs = parts.flatMap((p) => ['-i', p.file]);
  let graph = '', acc = parts[0].frames, vPrev = '[0:v]', aPrev = '[0:a]';
  for (let i = 1; i < parts.length; i++) {
    const xf = parts[i - 1].xf;
    const vOut = i === parts.length - 1 ? '[v]' : `[v${i}]`, aOut = i === parts.length - 1 ? '[mix]' : `[a${i}]`;
    graph += `${vPrev}[${i}:v]xfade=transition=fade:duration=${(xf / FPS).toFixed(4)}:offset=${((acc - xf) / FPS).toFixed(4)}${vOut};`;
    graph += `${aPrev}[${i}:a]acrossfade=d=${(xf / FPS).toFixed(4)}:c1=tri:c2=tri${aOut};`;
    acc = acc - xf + parts[i].frames;
    vPrev = vOut; aPrev = aOut;
  }
  const total = acc / FPS;
  if (MUSIC) {
    // 음악은 0초부터 깔고, 간판 로고가 뜨는 정지 화면(29초) 뒤 0.8초에 걸쳐 줄인다. 효과음과 「요기보」는 위에 그대로
    const fadeAt = (LAST + 1) / FPS;
    inputs.push('-i', MUSIC);
    graph += `[${parts.length}:a]aresample=48000,volume=${process.env.MUSIC_DB ?? '-6'}dB,afade=t=out:st=${fadeAt.toFixed(3)}:d=0.8,apad,atrim=duration=${total.toFixed(6)}[mus];`;
    graph += `[mix][mus]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[a]`;
  } else {
    graph = graph.replace('[mix];', '[a];');
  }
  fs.writeFileSync(SEG + 'join.graph', graph.replace(/;$/, ''));
  ff([...inputs, '-/filter_complex', SEG + 'join.graph', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT]);
  console.log(JSON.stringify({ out: OUT, frames: acc, seconds: +total.toFixed(2), music: !!MUSIC }));
}
