import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { FOLLOW_LEVELS } from './models.ts';
import { dataRootDir } from './online.ts';
import { createProject, saveBoardShots, saveCanvas, setProjectReference, StoreError } from './store.ts';
import type { BoardShot, FollowLevel, Project, StoredEdge, StoredNode } from './types.ts';

/**
 * 레퍼런스 영상 분석. 크레딧이 들지 않는다. yt-dlp 와 ffmpeg 만 쓴다.
 *
 * 컷 시간은 ffmpeg scene 값으로 찾고, 소리 크기는 ebur128 로 잰다.
 * 영상은 분석이 끝나면 지운다. 컷 그림은 눈으로 보는 용도로만 남기고 프로젝트로 넘기지 않는다.
 * 구조(컷 수, 길이, 리듬)만 샷 표로 옮긴다. 남의 사람·화면·브랜드·문구는 가져오지 않는다.
 *
 * 두 가지가 있다.
 * - 숏츠 가져오기(kind 없음): 따라 만들기용. 컷 120개까지 세고 샷 표로 옮겨 프로젝트를 만든다.
 * - 영상 가져오기(kind 'video'): 공부용. 30분 이하 긴 영상을 끝까지 나눠 보고 프로젝트는 만들지 않는다.
 *   손그림 애니메이션은 그림이 1초에 12장씩 바뀌어 scene 값으로는 컷과 구별되지 않는다. 그래서 화면을 아주 작게
 *   줄여 색 배치가 앞뒤보다 확 바뀌는 순간만 컷으로 센다(2026-11-12 「그래도, 라이언」 8분 → 139컷, 숏츠 방식은
 *   2분 47초에서 120컷 한도에 닿았다). 격자는 2분씩 나눠 grid.jpg, grid_2.jpg … 로 만든다.
 *
 * data/library/analyses/<id>/
 *   analysis.json  컷 표와 상태
 *   frames/        컷 첫 장면. 영상 가져오기는 긴 컷 안쪽 장면(frame_012_004.jpg = 12번 컷 +4초)도 둔다
 *   grid.jpg       번호와 시간을 적은 격자. 대화에서 Claude가 읽고 샷 표를 쓴다
 */

const SCENE_THRESHOLD = 0.08;
const MIN_CUT_SECONDS = 0.25;
const MAX_CUTS = 120;
const STEP_TIMEOUT_MS = 8 * 60 * 1000;
const STALE_RUN_MS = 20 * 60 * 1000;

/** 영상 가져오기 */
const VIDEO_MAX_SECONDS = 30 * 60;
const VIDEO_MAX_CUTS = 600;
const TINY_FPS = 12;
const TINY_W = 32;
const TINY_H = 18;
/** 컷으로 보는 기준: 화면 차이가 이 값보다 크고, 앞뒤 0.5초 차이의 가운데값보다 이 배수만큼 클 때 */
const TINY_MIN_DIFF = 10;
const TINY_RATIO = 3;
const TINY_WINDOW = 6;
/** 이보다 긴 컷은 안쪽 장면을 EXTRA_EVERY 초마다 더 뽑는다 */
const LONG_TAKE_SECONDS = 8;
const EXTRA_EVERY = 4;
const EXTRA_MAX = 24;
const PAGE_SECONDS = 120;

export type AnalysisKind = 'shorts' | 'video';

export type AnalysisCut = {
  no: number;
  start: number;
  end: number;
  seconds: number;
  frame: string;
  /** 평균 소리 크기(LUFS). 소리가 없으면 null */
  loudness: number | null;
  /** 리듬과 소리로 어림한 긴장도 0~100 */
  tension: number;
  /** 이 컷에 걸친 자막 */
  speech: string;
  /** 영상 가져오기에서 긴 컷 안쪽 장면 */
  extra?: { at: number; frame: string }[];
};

export type Analysis = {
  id: string;
  url: string;
  title: string;
  /** 없으면 숏츠 가져오기 */
  kind?: AnalysisKind;
  status: 'running' | 'done' | 'failed';
  step: string;
  error: string;
  width: number;
  height: number;
  duration: number;
  cuts: AnalysisCut[];
  /** 영상 가져오기: 1초마다 소리 크기(LUFS). 조용하면 null */
  sound?: (number | null)[];
  /** 영상 가져오기: 2분씩 나눈 격자 */
  grids?: { file: string; from: number; to: number }[];
  createdAt: string;
};

export const kindOf = (analysis: Pick<Analysis, 'kind'>): AnalysisKind => analysis.kind ?? 'shorts';

const dataRoot = dataRootDir;
const analysesRoot = () => path.join(dataRoot(), 'library', 'analyses');
const analysisDir = (id: string) => path.join(analysesRoot(), id);
const analysisFile = (id: string) => path.join(analysisDir(id), 'analysis.json');

const ID_RE = /^a_[a-z0-9]{6,40}$/;
const FILE_RE = /^(grid(_\d{1,2})?\.jpg|frame_\d{3}(_\d{3})?\.jpg)$/;

function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new StoreError('분석을 찾지 못했어요.', 404);
}

function write(analysis: Analysis): void {
  fs.mkdirSync(analysisDir(analysis.id), { recursive: true });
  const target = analysisFile(analysis.id);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(analysis, null, 2));
  fs.renameSync(tmp, target);
}

function read(id: string): Analysis {
  assertId(id);
  try {
    return JSON.parse(fs.readFileSync(analysisFile(id), 'utf8')) as Analysis;
  } catch {
    throw new StoreError('분석을 찾지 못했어요.', 404);
  }
}

/** 서버가 꺼지면서 멈춘 분석을 실패로 돌린다 */
function settle(analysis: Analysis): Analysis {
  if (analysis.status !== 'running') return analysis;
  if (Date.now() - new Date(analysis.createdAt).getTime() < STALE_RUN_MS) return analysis;
  const next = { ...analysis, status: 'failed' as const, error: '분석이 끝나지 않아 멈췄어요. 다시 시도해 주세요.' };
  write(next);
  return next;
}

export function getAnalysis(id: string): Analysis {
  return settle(read(id));
}

/** kind 를 주면 숏츠 가져오기와 영상 가져오기 중 하나만 */
export function listAnalyses(kind?: AnalysisKind): Analysis[] {
  if (!fs.existsSync(analysesRoot())) return [];
  return fs
    .readdirSync(analysesRoot())
    .filter((name) => ID_RE.test(name) && fs.existsSync(analysisFile(name)))
    .map((name) => settle(read(name)))
    .filter((a) => !kind || kindOf(a) === kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function analysisFilePath(id: string, name: string): string {
  assertId(id);
  if (!FILE_RE.test(name)) throw new StoreError('파일을 찾지 못했어요.', 404);
  const file = name.startsWith('grid') ? path.join(analysisDir(id), name) : path.join(analysisDir(id), 'frames', name);
  if (!fs.existsSync(file)) throw new StoreError('파일을 찾지 못했어요.', 404);
  return file;
}

function exec(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // 셸을 거치지 않아 주소에 어떤 글자가 있어도 명령으로 해석되지 않는다
    const child = spawn(command, args, { cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), STEP_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? `${command} 프로그램을 찾지 못했어요.` : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const lastLine = (text: string) => text.trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300) ?? '';

function cutTimes(stderr: string, duration: number): number[] {
  const found = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0 && t < duration);
  const times = [0];
  for (const time of found) {
    if (time - times[times.length - 1] >= MIN_CUT_SECONDS && duration - time >= MIN_CUT_SECONDS) times.push(time);
  }
  return times.slice(0, MAX_CUTS);
}

/**
 * 영상 가져오기의 컷 찾기. bytes 는 TINY_W×TINY_H 로 줄인 rgb24 화면을 1초에 TINY_FPS 장 이어 붙인 것이다.
 * 앞 화면과의 차이가 크고(TINY_MIN_DIFF) 앞뒤 0.5초 차이의 가운데값보다 TINY_RATIO 배 넘게 튀는 순간만 컷으로 본다.
 * 그림만 바뀌는 손그림 애니메이션, 빛만 움직이는 긴 컷, 카메라 이동은 앞뒤 차이도 같이 커서 컷으로 세지 않는다.
 */
export function tinyCuts(bytes: Uint8Array, duration: number): number[] {
  const size = TINY_W * TINY_H * 3;
  const count = Math.floor(bytes.length / size);
  const diff = [0];
  for (let i = 1; i < count; i++) {
    let sum = 0;
    for (let k = 0; k < size; k++) sum += Math.abs(bytes[i * size + k] - bytes[(i - 1) * size + k]);
    diff.push(sum / size);
  }
  const times = [0];
  for (let i = 1; i < count; i++) {
    const around = [...diff.slice(Math.max(1, i - TINY_WINDOW), i), ...diff.slice(i + 1, i + 1 + TINY_WINDOW)].sort((a, b) => a - b);
    const middle = around[Math.floor(around.length / 2)] ?? 0;
    const time = i / TINY_FPS;
    if (diff[i] > TINY_MIN_DIFF && diff[i] > TINY_RATIO * middle && time - times[times.length - 1] >= MIN_CUT_SECONDS && duration - time >= MIN_CUT_SECONDS) {
      times.push(time);
    }
  }
  return times.slice(0, VIDEO_MAX_CUTS);
}

async function videoCutTimes(dir: string, duration: number): Promise<number[]> {
  const file = path.join(dir, 'tiny.rgb');
  const run = await exec(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'video.mp4', '-an', '-vf', `fps=${TINY_FPS},scale=${TINY_W}:${TINY_H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'tiny.rgb'],
    dir,
  );
  if (run.code !== 0 || !fs.existsSync(file)) throw new Error(lastLine(run.stderr) || '컷을 찾지 못했어요.');
  const times = tinyCuts(fs.readFileSync(file), duration);
  fs.unlinkSync(file);
  return times;
}

function loudnessOf(stderr: string): { t: number; m: number }[] {
  return [...stderr.matchAll(/t:\s*([\d.]+)\s+TARGET:.*?M:\s*(-?[\d.]+)/g)].map((m) => ({ t: Number(m[1]), m: Number(m[2]) }));
}

function parseVtt(text: string): { start: number; end: number; text: string }[] {
  const seconds = (stamp: string) => {
    const parts = stamp.split(':').map(Number);
    return parts.reduce((sum, part) => sum * 60 + part, 0);
  };
  const lines: { start: number; end: number; text: string }[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const rows = block.split(/\r?\n/);
    const timeIndex = rows.findIndex((row) => row.includes('-->'));
    if (timeIndex < 0) continue;
    const [from, to] = rows[timeIndex].split('-->').map((s) => s.trim().split(' ')[0]);
    const body = rows
      .slice(timeIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!body) continue;
    // 자동 자막은 앞 줄을 되풀이한다. 같은 말이면 합친다
    const previous = lines[lines.length - 1];
    if (previous && (previous.text === body || body.startsWith(previous.text))) {
      previous.text = body;
      previous.end = seconds(to);
    } else {
      lines.push({ start: seconds(from), end: seconds(to), text: body });
    }
  }
  return lines;
}

const timeLabel = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

type GridCell = { frame: string; label: string; extra?: boolean };

const cutLabel = (cut: AnalysisCut) => `#${cut.no}  ${timeLabel(cut.start)}  (${cut.seconds.toFixed(1)}s)`;

/** 컷마다 번호와 시간을 적은 격자. 대화에서 이 한 장을 읽고 샷 표를 쓴다. 긴 컷 안쪽 장면은 연한 남색 글씨로 적는다 */
async function buildGrid(dir: string, cells: GridCell[], file: string): Promise<void> {
  const cols = 6;
  const cell = 300;
  const first = await sharp(path.join(dir, 'frames', cells[0].frame)).metadata();
  const cellHeight = Math.round((cell * (first.height ?? 9)) / (first.width ?? 16));
  const label = 26;
  const gap = 8;
  const rows = Math.ceil(cells.length / cols);
  const composites: OverlayOptions[] = [];
  for (const [index, item] of cells.entries()) {
    const left = gap + (index % cols) * (cell + gap);
    const top = gap + Math.floor(index / cols) * (cellHeight + label + gap);
    composites.push({ input: await sharp(path.join(dir, 'frames', item.frame)).resize(cell, cellHeight, { fit: 'cover' }).toBuffer(), left, top });
    composites.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${label}"><text x="2" y="18" font-family="Arial" font-size="16" fill="${item.extra ? '#a5b4fc' : '#ffffff'}">${item.label}</text></svg>`,
      ),
      left,
      top: top + cellHeight,
    });
  }
  await sharp({
    create: { width: gap + cols * (cell + gap), height: gap + rows * (cellHeight + label + gap), channels: 3, background: '#111111' },
  })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toFile(path.join(dir, file));
}

/** 영상 가져오기: 2분씩 나눈 격자. 긴 컷 안쪽 장면도 그 시간대 격자에 넣는다 */
async function buildPages(dir: string, cuts: AnalysisCut[], duration: number): Promise<NonNullable<Analysis['grids']>> {
  const all = cuts.flatMap((cut) => [
    { at: cut.start, frame: cut.frame, label: cutLabel(cut) },
    ...(cut.extra ?? []).map((x) => ({ at: x.at, frame: x.frame, label: `#${cut.no} +${Math.round(x.at - cut.start)}s  ${timeLabel(x.at)}`, extra: true })),
  ]);
  const grids: NonNullable<Analysis['grids']> = [];
  for (let from = 0; from < duration; from += PAGE_SECONDS) {
    const to = Math.min(duration, from + PAGE_SECONDS);
    const cells = all.filter((c) => c.at >= from && c.at < to);
    if (!cells.length) continue;
    const file = grids.length ? `grid_${grids.length + 1}.jpg` : 'grid.jpg';
    await buildGrid(dir, cells, file);
    grids.push({ file, from, to });
  }
  return grids;
}

/** ebur128 의 0.1초 값을 1초마다 평균 낸다 */
function soundPerSecond(sound: { t: number; m: number }[], duration: number): (number | null)[] {
  return Array.from({ length: Math.ceil(duration) }, (_, second) => {
    const inside = sound.filter((s) => s.t >= second && s.t < second + 1 && s.m > -70);
    return inside.length ? Math.round((inside.reduce((sum, s) => sum + s.m, 0) / inside.length) * 10) / 10 : null;
  });
}

async function runAnalysis(start: Analysis): Promise<void> {
  const dir = analysisDir(start.id);
  const frames = path.join(dir, 'frames');
  fs.mkdirSync(frames, { recursive: true });
  let current = start;
  const update = (patch: Partial<Analysis>) => {
    current = { ...current, ...patch };
    write(current);
  };
  const video = path.join(dir, 'video.mp4');
  const long = kindOf(start) === 'video';
  try {
    update({ step: '영상을 받는 중' });
    if (long) {
      // 받기 전에 길이부터 본다. 영화 한 편을 통째로 받지 않게 한다
      const meta = await exec('yt-dlp', ['--no-playlist', '--skip-download', '--encoding', 'utf-8', '--print', 'duration', start.url], dir);
      const seconds = Number(meta.stdout.trim().split(/\r?\n/)[0]);
      if (seconds > VIDEO_MAX_SECONDS) throw new Error(`${Math.round(seconds / 60)}분짜리 영상이에요. ${VIDEO_MAX_SECONDS / 60}분 이하 영상만 분석해요.`);
    }
    const download = await exec(
      'yt-dlp',
      ['--no-playlist', '--no-simulate', '--encoding', 'utf-8', '--print', 'title', '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b', '--merge-output-format', 'mp4', '-o', 'video.%(ext)s', start.url],
      dir,
    );
    if (download.code !== 0 || !fs.existsSync(video)) throw new Error(lastLine(download.stderr) || '영상을 받지 못했어요.');
    const title = download.stdout.trim().split(/\r?\n/)[0]?.trim() || '제목 없음';

    update({ title, step: '컷을 찾는 중' });
    const probe = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', 'video.mp4'], dir);
    const info = JSON.parse(probe.stdout || '{}') as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const duration = Number(info.format?.duration) || 0;
    const width = info.streams?.[0]?.width ?? 0;
    const height = info.streams?.[0]?.height ?? 0;
    if (!duration) throw new Error('영상 길이를 읽지 못했어요.');
    update({ width, height, duration });
    let times: number[];
    if (long) {
      times = await videoCutTimes(dir, duration);
    } else {
      const scene = await exec('ffmpeg', ['-hide_banner', '-i', 'video.mp4', '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-an', '-f', 'null', '-'], dir);
      times = cutTimes(scene.stderr, duration);
    }

    update({ step: '컷 그림을 뽑는 중' });
    const grab = (at: number, frame: string) =>
      exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(3), '-i', 'video.mp4', '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', path.join('frames', frame)], dir);
    const cuts: AnalysisCut[] = [];
    for (const [index, startTime] of times.entries()) {
      const end = times[index + 1] ?? duration;
      const seconds = end - startTime;
      const name = `frame_${String(index + 1).padStart(3, '0')}`;
      const frame = `${name}.jpg`;
      // 긴 영상은 컷 첫머리의 전환 효과를 피해 조금 더 들어가서 뽑는다
      await grab(startTime + (long ? Math.min(0.4, seconds * 0.3) : Math.min(0.15, seconds / 2)), frame);
      const cut: AnalysisCut = { no: index + 1, start: startTime, end, seconds, frame, loudness: null, tension: 30, speech: '' };
      if (long && seconds > LONG_TAKE_SECONDS) {
        cut.extra = [];
        for (let k = EXTRA_EVERY; k < seconds - 1 && cut.extra.length < EXTRA_MAX; k += EXTRA_EVERY) {
          const extra = `${name}_${String(k).padStart(3, '0')}.jpg`;
          await grab(startTime + k, extra);
          cut.extra.push({ at: startTime + k, frame: extra });
        }
      }
      cuts.push(cut);
    }

    update({ step: '소리 크기를 재는 중' });
    const sound = loudnessOf((await exec('ffmpeg', ['-hide_banner', '-nostats', '-i', 'video.mp4', '-af', 'ebur128', '-f', 'null', '-'], dir)).stderr);
    for (const cut of cuts) {
      const inside = sound.filter((s) => s.t >= cut.start && s.t < cut.end && s.m > -70);
      if (inside.length) cut.loudness = Math.round((inside.reduce((sum, s) => sum + s.m, 0) / inside.length) * 10) / 10;
    }
    // 소리가 클수록, 컷이 짧을수록 긴장도가 높다고 어림한다. 샷 표를 쓸 때 고쳐 쓰는 초안이다
    const levels = cuts.map((c) => c.loudness).filter((v): v is number => v !== null);
    const low = Math.min(...levels);
    const high = Math.max(...levels);
    const averageCut = duration / cuts.length;
    for (const cut of cuts) {
      const loud = cut.loudness !== null && high > low ? (cut.loudness - low) / (high - low) : 0.4;
      const pace = Math.max(0, Math.min(1, 1 - cut.seconds / (averageCut * 2)));
      cut.tension = Math.round(10 + 80 * (0.6 * loud + 0.4 * pace));
    }

    update({ step: '자막을 읽는 중' });
    await exec('yt-dlp', ['--no-playlist', '--skip-download', '--encoding', 'utf-8', '--write-subs', '--write-auto-subs', '--sub-langs', 'ko.*,en.*', '--sub-format', 'vtt', '-o', 'subs.%(ext)s', start.url], dir).catch(() => undefined);
    const subFile = fs.readdirSync(dir).filter((name) => name.startsWith('subs.') && name.endsWith('.vtt')).sort((a, b) => Number(b.includes('.ko')) - Number(a.includes('.ko')))[0];
    if (subFile) {
      const lines = parseVtt(fs.readFileSync(path.join(dir, subFile), 'utf8'));
      for (const cut of cuts) {
        cut.speech = lines
          .filter((line) => line.start < cut.end && line.end > cut.start)
          .map((line) => line.text)
          .join(' ')
          .slice(0, 400);
      }
    }

    if (long) {
      update({ step: '격자를 만드는 중' });
      const grids = await buildPages(dir, cuts, duration);
      update({ status: 'done', step: '', cuts, sound: soundPerSecond(sound, duration), grids });
    } else {
      await buildGrid(dir, cuts.map((cut) => ({ frame: cut.frame, label: cutLabel(cut) })), 'grid.jpg');
      update({ status: 'done', step: '', cuts });
    }
  } catch (e) {
    update({ status: 'failed', step: '', error: (e as Error).message });
  } finally {
    // 남의 영상은 남겨 두지 않는다
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (/^(video\.|subs\.|tiny\.)/.test(name)) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          // 다음에 지운다
        }
      }
    }
  }
}

export function startAnalysis(url: string, kind: AnalysisKind = 'shorts'): Analysis {
  const clean = url.trim();
  if (!/^https?:\/\/\S+$/i.test(clean)) throw new StoreError('http(s) 주소를 넣어 주세요.');
  if (kind !== 'shorts' && kind !== 'video') throw new StoreError('가져오기 종류를 알 수 없어요.');
  // 이미 분석한 영상은 다시 받지 않는다. 숏츠 가져오기와 영상 가져오기는 따로 센다
  const existing = listAnalyses(kind).find((a) => a.url === clean && a.status !== 'failed');
  if (existing) return existing;
  const analysis: Analysis = {
    id: `a_${crypto.randomBytes(8).toString('hex')}`,
    url: clean,
    title: '',
    ...(kind === 'video' ? { kind } : {}),
    status: 'running',
    step: '시작하는 중',
    error: '',
    width: 0,
    height: 0,
    duration: 0,
    cuts: [],
    createdAt: new Date().toISOString(),
  };
  write(analysis);
  void runAnalysis(analysis);
  return analysis;
}

function nearestAspect(width: number, height: number): string {
  const ratio = height ? width / height : 9 / 16;
  const options: [string, number][] = [['9:16', 9 / 16], ['4:5', 4 / 5], ['1:1', 1], ['16:9', 16 / 9]];
  return options.reduce((best, option) => (Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio) ? option : best))[0];
}

/**
 * 분석한 구조로 프로젝트를 만든다. 생성은 하지 않는다.
 * 여기서는 컷 길이와 리듬만 옮기고 그림은 넘기지 않는다. 구성까지 따라가는 단계의 칸 내용은
 * 대화에서 Claude가 격자를 읽고 샷 표에 쓴다.
 */
export function startFromAnalysis(id: string, level: FollowLevel = 'rhythm'): Project {
  const analysis = read(id);
  if (kindOf(analysis) === 'video') throw new StoreError('영상 가져오기는 보는 용도라 프로젝트를 만들지 않아요. 따라 만들려면 숏츠 가져오기를 써 주세요.');
  if (analysis.status !== 'done') throw new StoreError('분석이 끝난 뒤에 만들 수 있어요.', 409);
  const project = createProject(`${analysis.title.slice(0, 24).trim()} 따라 만들기`);
  const canvasId = project.canvases[0].id;
  const scenarioId = `n_${crypto.randomBytes(6).toString('hex')}`;
  const boardId = `n_${crypto.randomBytes(6).toString('hex')}`;
  const total = Math.max(1, Math.round(analysis.duration));
  const average = analysis.duration / analysis.cuts.length;
  const nodes: StoredNode[] = [
    {
      id: scenarioId,
      type: 'scenario',
      position: { x: 0, y: 0 },
      data: { title: '시나리오', logline: '', scenario: `참고한 영상의 구조: ${total}초, ${analysis.cuts.length}컷, 컷 평균 ${average.toFixed(1)}초. 우리 이야기를 적어 주세요.`, total },
    },
    {
      id: boardId,
      type: 'storyboard',
      position: { x: 340, y: 0 },
      data: { title: '스토리보드', cuts: analysis.cuts.length, total, aspect: nearestAspect(analysis.width, analysis.height), engine: 'higgsfield', resolution: '2k', prompt: '' },
    },
  ];
  const edges: StoredEdge[] = [{ id: `e_${crypto.randomBytes(6).toString('hex')}`, source: scenarioId, target: boardId }];
  saveCanvas(project.id, canvasId, { nodes, edges, viewport: null, revision: 0 });
  const shots: BoardShot[] = analysis.cuts.map((cut) => ({ no: cut.no, seconds: Math.round(cut.seconds * 10) / 10, scene: '', tension: cut.tension, must: [] }));
  saveBoardShots(project.id, boardId, shots);
  const chosen = FOLLOW_LEVELS.some((l) => l.value === level) ? level : 'rhythm';
  return setProjectReference(project.id, { analysisId: analysis.id, level: chosen, title: analysis.title });
}
