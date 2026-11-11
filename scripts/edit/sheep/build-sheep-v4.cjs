// 예시: 양 프로젝트 폴더(data/projects/p_1bcbca7edc18678a)에서 실행한다. 로고·음악·외침 시점은 예전 양 편집본과 같다.
// 양 영상 새 편집본(무료): 새 15초 영상(맥스 크기·색 고침, 뒤쪽 양 떼와 개) + 예전 편집본과 같은 구성
// 시작 작은 로고 0.3~3.6초, 끝 큰 로고 11.7초~, 음악(일본 원곡 0~11.7 + 25~29.45, 0.25초 교차, 시험용), 「요기보!」 14.3초 +8dB,
// 마지막 화면 0.5초 멈춤, 1080p 무료 업스케일(lanczos + unsharp), 전체 −15 LUFS.
// 실행: 프로젝트 폴더(data/projects/p_1bcbca7edc18678a)에서 node edit/build-sheep-v4.cjs
const { execFileSync } = require('child_process');
const SRC = 'files/r_j_2a5ed84c3ccbb3e9.mp4', OUT = 'edit/sheep-edit-v4.mp4', HOLD = 0.5;
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', SRC], { encoding: 'utf8' }).trim());
const T = (dur + HOLD).toFixed(3);
const g = [
  `[0:v]scale=1920:1080:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,tpad=stop_mode=clone:stop_duration=${HOLD},format=rgba[v0]`,
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
  '-loop', '1', '-framerate', '24', '-t', T, '-i', 'edit/overlay-front-1080.png',
  '-loop', '1', '-framerate', '24', '-t', T, '-i', 'edit/overlay-end-logo-1080.png',
  '-filter_complex', g, '-map', '[v]', '-map', '[a]', '-t', T,
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '24',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log('편집본', OUT, T + '초');
