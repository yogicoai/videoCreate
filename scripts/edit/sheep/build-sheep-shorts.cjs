// 양 세로 숏츠 편집본(무료): 세로 15초 영상 + 편집본 v4와 같은 구성.
// 시작 작은 로고 0.3~3.6초, 끝 큰 로고 11.7초~, 음악(일본 원곡 0~11.7 + 25~29.45, 0.25초 교차, 시험용), 「요기보!」 14.3초 +8dB,
// 마지막 화면 0.5초 멈춤, 1080×1920 무료 업스케일(lanczos + unsharp), 전체 −15 LUFS.
// 로고 오버레이는 overlays-916.cjs가 만든 shorts/overlay-*-916.png를 쓴다.
// 실행: 프로젝트 폴더(data/projects/p_1bcbca7edc18678a)에서
//   node ../../../scripts/edit/sheep/build-sheep-shorts.cjs <세로 영상> [출력 mp4]
// 음악은 일본 원곡이라 시험용이다. 공개하려면 음악을 바꾸거나 사용 확인을 먼저 받는다.
const { execFileSync } = require('child_process');
const SRC = process.argv[2];
const OUT = process.argv[3] || 'shorts/sheep-shorts-v1.mp4';
const HOLD = 0.5;
if (!SRC) {
  console.error('사용: node build-sheep-shorts.cjs <세로 영상> [출력 mp4]');
  process.exit(1);
}
const probe = (args) => execFileSync('ffprobe', ['-v', 'error', ...args, SRC], { encoding: 'utf8' }).trim();
const dur = Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0']));
const [sw, sh] = probe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0']).split(',').map(Number);
if (Math.abs(sw / sh - 9 / 16) > 0.02) console.log(`주의: 영상 비율이 9:16이 아니에요 (${sw}x${sh}). 1080×1920에 맞춰 늘어납니다.`);
const T = (dur + HOLD).toFixed(3);
const g = [
  `[0:v]scale=1080:1920:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1,tpad=stop_mode=clone:stop_duration=${HOLD},format=rgba[v0]`,
  `[3:v]format=rgba,fade=t=in:st=0.3:d=0.3:alpha=1,fade=t=out:st=3.3:d=0.3:alpha=1[fr]`,
  `[4:v]format=rgba,fade=t=in:st=11.7:d=0.3:alpha=1[en]`,
  `[v0][fr]overlay=0:0:shortest=1[v1]`,
  `[v1][en]overlay=0:0:shortest=1,format=yuv420p[v]`,
  `[1:a]aresample=48000,asplit=2[ma][mb]`,
  `[ma]atrim=0:11.7,asetpts=PTS-STARTPTS[m1]`,
  `[mb]atrim=25:29.45,asetpts=PTS-STARTPTS[m2]`,
  `[m1][m2]acrossfade=d=0.25:c1=tri:c2=tri[m]`,
  `[0:a]aresample=48000,apad[fx]`,
  `[2:a]aresample=48000,volume=8dB,adelay=14300:all=1,apad[vo]`,
  `[m][fx][vo]amix=inputs=3:normalize=0:duration=longest,atrim=0:${T},loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[a]`,
].join(';');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-i', SRC, '-i', 'edit/yogibo-jp-original.mp4', '-i', 'edit/yogibo-voice.wav',
  '-loop', '1', '-framerate', '24', '-t', T, '-i', 'shorts/overlay-front-916.png',
  '-loop', '1', '-framerate', '24', '-t', T, '-i', 'shorts/overlay-end-logo-916.png',
  '-filter_complex', g, '-map', '[v]', '-map', '[a]', '-t', T,
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '24',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log('세로 편집본', OUT, T + '초');
