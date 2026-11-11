import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { canConnect, topoOrder } from './graph.ts';
import {
  composeShotText,
  computeStats,
  computeSteps,
  DEFAULT_VIDEO_MODEL,
  ENGINE_INFO,
  estimateCell,
  estimateImage,
  HIGGS_IMAGE_MODEL,
  MODEL_SHEET_GRID,
  modelSheetPrompt,
  promptOf,
  sheetLayout,
  SHEET_PANEL,
  shotScenePrompt,
} from './models.ts';
import { buildFinalPrompt, buildStoryboardPrompt, DEFAULT_RULE, DEFAULT_RULE_ID, ruleTextFor, YOGIBO_RULE, YOGIBO_RULE_ID } from './rules.ts';
import type {
  AssetType,
  AssetView,
  BalanceInfo,
  Board,
  BoardShot,
  CanvasDoc,
  CfLibrary,
  Cost,
  CostStats,
  FileEntry,
  Job,
  JobError,
  JobRef,
  JobResult,
  LibraryBoard,
  LibraryIdea,
  LibraryImage,
  LibraryItem,
  LibraryModel,
  LibraryResult,
  LibraryRule,
  LibraryVideo,
  LibraryView,
  LibraryWork,
  ModelVariant,
  Project,
  ProductEntry,
  ProjectSummary,
  RuleSet,
  StoredEdge,
  StoredNode,
  Viewport,
} from './types.ts';

/**
 * 프로젝트 저장소. 서버와 대기열 스크립트가 함께 쓴다.
 *
 * data/projects/<프로젝트>/
 *   project.json          이름과 캔버스 목록
 *   canvases/<캔버스>.json 칸과 선 (화면이 자동 저장)
 *   jobs.json             생성 기록 (서버·스크립트가 기록)
 *   boards.json           스토리보드의 샷 표와 칸 파일 (화면·스크립트가 기록)
 *   files.json, files/    올린 사진과 결과
 *   thumbs/               미리보기
 * data/library/
 *   library.json, files/  자산: 시트, 제작 규칙, 내 기획, 내 영상
 *
 * 칸 상태와 샷 표를 캔버스 파일에 넣지 않는 이유: 화면이 자동 저장을 하면서, 대화 쪽에서 막 넣은
 * 결과를 옛 상태로 덮어쓰는 일을 구조적으로 막기 위해서다.
 */

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const dataRoot = () => process.env.VIDEOCREATE_DATA_DIR || path.join(process.cwd(), 'data');
const projectsRoot = () => path.join(dataRoot(), 'projects');
const projectDir = (id: string) => path.join(projectsRoot(), id);
const projectFile = (id: string) => path.join(projectDir(id), 'project.json');
const canvasFile = (id: string, canvasId: string) => path.join(projectDir(id), 'canvases', `${canvasId}.json`);
const jobsFile = (id: string) => path.join(projectDir(id), 'jobs.json');
const boardsFile = (id: string) => path.join(projectDir(id), 'boards.json');
const filesIndex = (id: string) => path.join(projectDir(id), 'files.json');
const filesDir = (id: string) => path.join(projectDir(id), 'files');
const thumbsDir = (id: string) => path.join(projectDir(id), 'thumbs');
const settingsFile = () => path.join(dataRoot(), 'settings.json');
const libraryRoot = () => path.join(dataRoot(), 'library');
const libraryFile = () => path.join(libraryRoot(), 'library.json');
const libraryFilesDir = () => path.join(libraryRoot(), 'files');
const libraryThumbsDir = () => path.join(libraryRoot(), 'thumbs');

const ID_RE = /^[a-z]_[a-z0-9]{6,40}$/;
const FILE_RE = /^[urp]_[a-z0-9_]+\.(png|jpg|webp|mp4|mov|webm)$/;
const LIBRARY_FILE_RE = /^[lfv]_[a-z0-9_-]+\.(png|jpg|webp|mp4)$/;

export function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new StoreError('잘못된 주소예요.', 404);
}

function assertFileName(name: string): void {
  if (!FILE_RE.test(name)) throw new StoreError('잘못된 파일 이름이에요.', 404);
}

const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const now = () => new Date().toISOString();

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJson<T>(file: string, fallback: T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return fallback;
      if (attempt >= 20) throw e;
      sleepSync(20); // 윈도우에서 다른 프로세스가 교체하는 순간을 비켜 간다
    }
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameWithRetry(tmp, file);
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const busy = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!busy || attempt >= 40) throw e;
      sleepSync(25);
    }
  }
}

/** 서버와 스크립트가 같은 파일을 동시에 고치지 않도록 잠근다. fn 안에서는 동기 작업만 한다 */
function withLock<T>(lockPath: string, fn: () => T): T {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw e;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 15000) fs.rmdirSync(lockPath);
      } catch {
        // 그새 풀렸다
      }
      if (Date.now() > deadline) throw new StoreError('다른 작업이 파일을 쓰고 있어요. 잠시 뒤 다시 해 주세요.', 503);
      sleepSync(15);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockPath);
    } catch {
      // 다음 잠금에서 시간 초과로 정리된다
    }
  }
}

const projectLock = <T>(id: string, fn: () => T) => withLock(path.join(projectDir(id), '.lock'), fn);
const libraryLock = <T>(fn: () => T) => withLock(path.join(libraryRoot(), '.lock'), fn);

// ─── 프로젝트 ─────────────────────────────────────────────

function readProjectOrThrow(id: string): Project {
  assertId(id);
  const project = readJson<Project | null>(projectFile(id), null);
  if (!project) throw new StoreError('프로젝트를 찾지 못했어요.', 404);
  return project;
}

function emptyCanvas(id: string): CanvasDoc {
  return { id, nodes: [], edges: [], viewport: null, revision: 0, updatedAt: now() };
}

export function createProject(name?: string): Project {
  const id = newId('p');
  const canvasId = newId('c');
  const at = now();
  const project: Project = {
    id,
    name: name?.trim() || '제목 없음',
    createdAt: at,
    updatedAt: at,
    canvases: [{ id: canvasId, name: '캔버스 1' }],
  };
  writeJson(projectFile(id), project);
  writeJson(canvasFile(id, canvasId), emptyCanvas(canvasId));
  return project;
}

export function getProject(id: string): Project {
  return readProjectOrThrow(id);
}

export function hasProject(id: string): boolean {
  return ID_RE.test(id) && fs.existsSync(projectFile(id));
}

export function updateProject(id: string, patch: { name?: string; ruleId?: string }): Project {
  if (patch.name !== undefined && !patch.name.trim()) throw new StoreError('이름을 적어 주세요.');
  return projectLock(id, () => {
    const project = readProjectOrThrow(id);
    if (patch.name !== undefined) {
      project.name = patch.name.trim().slice(0, 80);
      project.updatedAt = now();
    }
    if (patch.ruleId !== undefined) project.ruleId = patch.ruleId;
    writeJson(projectFile(id), project);
    return project;
  });
}

/**
 * 프로젝트를 지운다. 되돌릴 수 있게 휴지통 폴더로 옮기고, 목록과 갤러리에서는 사라진다.
 * 생성 중인 칸이 있으면 결과를 받을 곳이 없어지므로 막는다.
 */
export function setProjectReference(id: string, reference: NonNullable<Project['reference']>): Project {
  return projectLock(id, () => {
    const project = readProjectOrThrow(id);
    project.reference = reference;
    writeJson(projectFile(id), project);
    return project;
  });
}

export function deleteProject(id: string): void {
  readProjectOrThrow(id);
  if (readJobs(id).some((j) => j.status === 'running')) {
    throw new StoreError('생성 중인 칸이 있어요. 끝난 뒤에 지워 주세요.', 409);
  }
  const trash = path.join(dataRoot(), 'trash');
  fs.mkdirSync(trash, { recursive: true });
  renameWithRetry(projectDir(id), path.join(trash, `${id}-${Date.now()}`));
}

function projectIds(): string[] {
  try {
    return fs
      .readdirSync(projectsRoot(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && ID_RE.test(d.name) && fs.existsSync(projectFile(d.name)))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function thumbOf(jobs: Job[], files: FileEntry[], nodes: CanvasDoc['nodes']): ProjectSummary['thumb'] {
  const done = jobs.filter((j) => j.status === 'done' && j.result);
  // 완성본이 있으면 카드 표지도 완성본이다. 없으면 편집본을 쓴다
  const lastOf = (stage: 'final' | 'edit') => [...done].reverse().find((j) => nodes.some((n) => n.id === j.nodeId && n.data.stage === stage));
  const finished = lastOf('final') ?? lastOf('edit');
  if (finished?.result) return { file: finished.result.file, kind: finished.kind };
  const lastImage = [...done].reverse().find((j) => j.kind === 'image');
  if (lastImage?.result) return { file: lastImage.result.file, kind: 'image' };
  const upload = files.find((f) => f.kind === 'upload');
  if (upload) return { file: upload.name, kind: 'image' };
  const lastVideo = [...done].reverse().find((j) => j.kind === 'video');
  if (lastVideo?.result) return { file: lastVideo.result.file, kind: 'video' };
  return null;
}

export function listProjects(): ProjectSummary[] {
  return projectIds()
    .map((id) => {
      const project = readProjectOrThrow(id);
      const jobs = readJobs(id);
      const files = readFiles(id);
      const nodes = project.canvases.flatMap((c) => readCanvasRaw(id, c.id).nodes);
      const finished = new Set(jobs.filter((j) => j.status === 'done' && j.result).map((j) => j.nodeId));
      return {
        ...project,
        stats: computeStats(jobs),
        cellCount: nodes.length,
        thumb: thumbOf(jobs, files, nodes),
        steps: computeSteps(nodes, (nodeId) => finished.has(nodeId), readBoards(id)),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ─── 캔버스 ───────────────────────────────────────────────

function readCanvasRaw(id: string, canvasId: string): CanvasDoc {
  return readJson<CanvasDoc>(canvasFile(id, canvasId), emptyCanvas(canvasId));
}

export function getCanvas(id: string, canvasId: string): CanvasDoc {
  const project = readProjectOrThrow(id);
  if (!project.canvases.some((c) => c.id === canvasId)) throw new StoreError('캔버스를 찾지 못했어요.', 404);
  return readCanvasRaw(id, canvasId);
}

export function createCanvas(id: string, name?: string): Project {
  return projectLock(id, () => {
    const project = readProjectOrThrow(id);
    const canvasId = newId('c');
    project.canvases.push({ id: canvasId, name: name?.trim() || `캔버스 ${project.canvases.length + 1}` });
    project.updatedAt = now();
    writeJson(canvasFile(id, canvasId), emptyCanvas(canvasId));
    writeJson(projectFile(id), project);
    return project;
  });
}

export function canvasRevisions(id: string): Record<string, number> {
  const project = readProjectOrThrow(id);
  return Object.fromEntries(project.canvases.map((c) => [c.id, readCanvasRaw(id, c.id).revision]));
}

export function renameCanvas(id: string, canvasId: string, name: string): Project {
  const trimmed = name.trim();
  if (!trimmed) throw new StoreError('이름을 적어 주세요.');
  return projectLock(id, () => {
    const project = readProjectOrThrow(id);
    const canvas = project.canvases.find((c) => c.id === canvasId);
    if (!canvas) throw new StoreError('캔버스를 찾지 못했어요.', 404);
    canvas.name = trimmed.slice(0, 40);
    writeJson(projectFile(id), project);
    return project;
  });
}

const CELL_KINDS = ['scenario', 'ref', 'image', 'storyboard', 'shot', 'video'];

function sanitizeNodes(nodes: unknown): StoredNode[] {
  if (!Array.isArray(nodes)) throw new StoreError('칸 정보가 올바르지 않아요.');
  return nodes.map((raw) => {
    const n = raw as StoredNode;
    if (!n || typeof n.id !== 'string' || !CELL_KINDS.includes(n.type)) {
      throw new StoreError('칸 정보가 올바르지 않아요.');
    }
    return {
      id: n.id,
      type: n.type,
      position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
      data: n.data ?? { title: '' },
    };
  });
}

function sanitizeEdges(edges: unknown, nodes: StoredNode[]): StoredEdge[] {
  if (!Array.isArray(edges)) throw new StoreError('선 정보가 올바르지 않아요.');
  const kinds = new Map(nodes.map((n) => [n.id, n.type]));
  const seen = new Set<string>();
  const clean: StoredEdge[] = [];
  for (const raw of edges) {
    const e = raw as StoredEdge;
    const from = kinds.get(e?.source);
    const to = kinds.get(e?.target);
    if (!from || !to || !canConnect(from, to)) continue;
    const key = `${e.source}>${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ id: String(e.id), source: e.source, target: e.target });
  }
  return clean;
}

export function saveCanvas(
  id: string,
  canvasId: string,
  body: { nodes: unknown; edges: unknown; viewport?: Viewport | null; revision: number },
): { revision: number; updatedAt: string } {
  return projectLock(id, () => {
    const project = readProjectOrThrow(id);
    if (!project.canvases.some((c) => c.id === canvasId)) throw new StoreError('캔버스를 찾지 못했어요.', 404);
    const current = readCanvasRaw(id, canvasId);
    if (body.revision !== current.revision) {
      throw new StoreError('다른 창에서 먼저 저장했어요. 새로고침해 주세요.', 409);
    }
    const nodes = sanitizeNodes(body.nodes);
    const edges = sanitizeEdges(body.edges, nodes);
    const contentChanged =
      JSON.stringify(nodes) !== JSON.stringify(current.nodes) || JSON.stringify(edges) !== JSON.stringify(current.edges);
    const at = now();
    const next: CanvasDoc = {
      id: canvasId,
      nodes,
      edges,
      viewport: body.viewport ?? current.viewport,
      revision: current.revision + 1,
      updatedAt: at,
    };
    writeJson(canvasFile(id, canvasId), next);
    // 화면만 옮겼을 때는 목록 순서가 바뀌지 않게 한다
    if (contentChanged) {
      project.updatedAt = at;
      writeJson(projectFile(id), project);
    }
    return { revision: next.revision, updatedAt: at };
  });
}

// ─── 스토리보드 샷 표 ─────────────────────────────────────

export function readBoards(id: string): Record<string, Board> {
  return readJson<Record<string, Board>>(boardsFile(id), {});
}

const emptyBoard = (): Board => ({ shots: [], panels: [], sheetFile: null, updatedAt: now() });

function cleanShots(shots: unknown): BoardShot[] {
  if (!Array.isArray(shots)) throw new StoreError('샷 표가 올바르지 않아요.');
  const text = (value: unknown, max: number) => (value == null ? undefined : String(value).slice(0, max));
  return shots.slice(0, 60).map((raw, index) => {
    const shot = (raw ?? {}) as Partial<BoardShot>;
    return {
      no: index + 1,
      seconds: Math.max(0.5, Math.min(30, Number(shot.seconds) || 1)),
      scene: String(shot.scene ?? '').slice(0, 800),
      tension: Math.max(0, Math.min(100, Math.round(Number(shot.tension) || 0))),
      size: text(shot.size, 40),
      angle: text(shot.angle, 40),
      camera: text(shot.camera, 200),
      action: text(shot.action, 800),
      speed: text(shot.speed, 200),
      light: text(shot.light, 200),
      must: Array.isArray(shot.must) ? shot.must.map(String).slice(0, 12) : undefined,
    };
  });
}

export function saveBoardShots(id: string, nodeId: string, shots: unknown): Board {
  const clean = cleanShots(shots);
  return projectLock(id, () => {
    readProjectOrThrow(id);
    const boards = readBoards(id);
    const board = boards[nodeId] ?? emptyBoard();
    board.shots = clean;
    board.updatedAt = now();
    boards[nodeId] = board;
    writeJson(boardsFile(id), boards);
    return board;
  });
}

export function saveBoardPanels(id: string, nodeId: string, sheetFile: string, panels: string[]): void {
  projectLock(id, () => {
    const boards = readBoards(id);
    const board = boards[nodeId] ?? emptyBoard();
    board.sheetFile = sheetFile;
    board.panels = panels;
    board.updatedAt = now();
    boards[nodeId] = board;
    writeJson(boardsFile(id), boards);
  });
}

/** 칸 사이 여백을 찾아 경계를 정한다. 생성 모델은 칸을 정확히 1/N 로 나눠 주지 않는다 */
function findCuts(data: Buffer, width: number, height: number, parts: number, vertical: boolean): number[] {
  const length = vertical ? width : height;
  const other = vertical ? height : width;
  const pixel = (a: number, b: number) => (vertical ? data[b * width + a] : data[a * width + b]);
  const light: number[] = [];
  for (let a = 0; a < length; a++) {
    let darkest = 255;
    for (let b = 0; b < other; b += 4) {
      const value = pixel(a, b);
      if (value < darkest) darkest = value;
    }
    if (darkest > 225) light.push(a);
  }
  const runs: [number, number][] = [];
  let start = -1;
  let previous = -2;
  for (const a of light) {
    if (a !== previous + 1) {
      if (start >= 0) runs.push([start, previous]);
      start = a;
    }
    previous = a;
  }
  if (start >= 0) runs.push([start, previous]);
  const middles = runs
    .filter((run) => run[1] - run[0] >= 2 && run[0] > length * 0.03 && run[1] < length * 0.97)
    .map((run) => Math.round((run[0] + run[1]) / 2));
  const even = Array.from({ length: parts - 1 }, (_, i) => Math.round((length * (i + 1)) / parts));
  const picked = even.map((target) => {
    const near = middles
      .filter((m) => Math.abs(m - target) < (length / parts) * 0.4)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    return near.length ? near[0] : target;
  });
  for (let i = 1; i < picked.length; i++) if (picked[i] <= picked[i - 1]) picked[i] = even[i];
  return [0, ...picked, length];
}

/** 스토리보드 시트를 칸별 파일로 자른다. 시트는 확인용이라 칸은 작다. 확정한 샷은 다시 크게 뽑는다 */
async function sliceSheet(id: string, job: Job, bytes: Buffer): Promise<string[]> {
  const rows = job.options.rows ?? 1;
  const cols = job.options.cols ?? 1;
  const { data, info } = await sharp(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
  const columnCuts = findCuts(data, info.width, info.height, cols, true);
  const rowCuts = findCuts(data, info.width, info.height, rows, false);
  const panels: string[] = [];
  fs.mkdirSync(filesDir(id), { recursive: true });
  const stem = job.id.replace(/[^a-z0-9]/g, '_');
  const entries: FileEntry[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inset = 2;
      const left = columnCuts[c] + (c > 0 ? inset : 0);
      const top = rowCuts[r] + (r > 0 ? inset : 0);
      const width = columnCuts[c + 1] - left - (c < cols - 1 ? inset : 0);
      const height = rowCuts[r + 1] - top - (r < rows - 1 ? inset : 0);
      if (width < 8 || height < 8) continue;
      const buffer = await sharp(bytes).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
      const name = `p_${stem}_${panels.length + 1}.jpg`;
      fs.writeFileSync(path.join(filesDir(id), name), buffer);
      panels.push(name);
      entries.push({
        name,
        originalName: `${job.title} ${panels.length}번 칸`,
        kind: 'panel',
        mediaKind: 'image',
        mime: 'image/jpeg',
        width,
        height,
        bytes: buffer.length,
        createdAt: now(),
      });
    }
  }
  projectLock(id, () => {
    const files = readFiles(id).filter((f) => !entries.some((e) => e.name === f.name));
    writeJson(filesIndex(id), [...files, ...entries]);
  });
  return panels;
}

// ─── 파일 ─────────────────────────────────────────────────

type Sniffed = { kind: 'image' | 'video'; ext: string; mime: string };

export function sniff(b: Buffer): Sniffed | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return { kind: 'image', ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return { kind: 'image', ext: 'webp', mime: 'image/webp' };
  }
  if (b.toString('latin1', 4, 8) === 'ftyp') {
    return b.toString('latin1', 8, 12) === 'qt  '
      ? { kind: 'video', ext: 'mov', mime: 'video/quicktime' }
      : { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', ext: 'webm', mime: 'video/webm' };
  return null;
}

async function imageSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(bytes).metadata();
    const swap = (meta.orientation ?? 1) >= 5; // 휴대폰 사진은 EXIF 회전을 반영한 크기로 적는다
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    return swap ? { width: height, height: width } : { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

export function readFiles(id: string): FileEntry[] {
  return readJson<FileEntry[]>(filesIndex(id), []);
}

/** 올린 사진을 저장한다. 내용이 같으면 파일 하나로 합친다 */
export async function addUpload(id: string, bytes: Buffer, originalName: string, kind: 'upload' | 'copy' = 'upload'): Promise<FileEntry> {
  readProjectOrThrow(id);
  const type = sniff(bytes);
  if (!type || type.kind !== 'image') throw new StoreError('JPG, PNG, WEBP 사진만 올릴 수 있어요.');
  const { width, height } = await imageSize(bytes);
  const name = `u_${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${type.ext}`;
  return projectLock(id, () => {
    const files = readFiles(id);
    const existing = files.find((f) => f.name === name);
    if (existing) return existing;
    fs.mkdirSync(filesDir(id), { recursive: true });
    const target = path.join(filesDir(id), name);
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
    const entry: FileEntry = {
      name,
      originalName: originalName.slice(0, 200) || name,
      kind,
      mediaKind: 'image',
      mime: type.mime,
      width,
      height,
      bytes: bytes.length,
      createdAt: now(),
    };
    files.push(entry);
    writeJson(filesIndex(id), files);
    return entry;
  });
}

/** 다른 프로젝트의 사진을 이 프로젝트로 복사해 온다 */
export async function copyAsset(toId: string, fromId: string, name: string): Promise<FileEntry> {
  assertId(fromId);
  assertFileName(name);
  const entry = readFiles(fromId).find((f) => f.name === name);
  if (!entry) throw new StoreError('자산을 찾지 못했어요.', 404);
  if (toId === fromId && entry.kind === 'upload') return entry;
  const bytes = fs.readFileSync(path.join(filesDir(fromId), name));
  return addUpload(toId, bytes, entry.originalName);
}

/** 자산의 사진을 프로젝트로 복사해 온다. 프로젝트는 자기 파일만 가지고도 돌아간다 */
export async function copyLibraryImage(toId: string, itemId: string): Promise<{ entry: FileEntry; item: LibraryImage }> {
  const item = readLibrary().find((i): i is LibraryImage => i.id === itemId && i.kind === 'image');
  if (!item) throw new StoreError('자산을 찾지 못했어요.', 404);
  const bytes = fs.readFileSync(libraryFilePath(item.file));
  return { entry: await addUpload(toId, bytes, item.originalName, 'copy'), item };
}

async function bytesFromUrl(url: string): Promise<Buffer> {
  const local = /^\/api\/library\/files\/([^?]+)/.exec(url);
  if (local) return fs.readFileSync(libraryFilePath(local[1]));
  const res = await fetch(url);
  if (!res.ok) throw new StoreError(`그림을 받지 못했어요 (HTTP ${res.status}).`, 502);
  return Buffer.from(await res.arrayBuffer());
}

/** 내 모델의 대표컷이나 시트를 칸의 그림으로 가져온다 */
export async function copyModelImage(toId: string, itemId: string, variant: ModelVariant): Promise<{ entry: FileEntry; item: LibraryModel }> {
  const item = readLibrary().find((i): i is LibraryModel => i.id === itemId && i.kind === 'model');
  if (!item) throw new StoreError('모델을 찾지 못했어요.', 404);
  const url = variant === 'rep' ? item.rep : item.sheets[variant];
  if (!url) throw new StoreError('이 모델에는 그 시트가 없어요.', 404);
  const label = { rep: '대표컷', face: '얼굴 시트', expr: '표정 시트', body: '몸 시트' }[variant];
  return { entry: await addUpload(toId, await bytesFromUrl(url), `${item.title} ${label}.jpg`, 'copy'), item };
}

/** 내 영상을 참조로 쓸 때 포스터를 칸의 그림으로 가져온다 */
export async function copyVideoPoster(toId: string, itemId: string): Promise<{ entry: FileEntry; item: LibraryVideo }> {
  const item = readLibrary().find((i): i is LibraryVideo => i.id === itemId && i.kind === 'video');
  if (!item) throw new StoreError('영상을 찾지 못했어요.', 404);
  if (!item.poster) throw new StoreError('이 영상은 대표 그림이 없어요.');
  const res = await fetch(item.poster);
  if (!res.ok) throw new StoreError(`대표 그림을 받지 못했어요 (HTTP ${res.status}).`, 502);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { entry: await addUpload(toId, bytes, `${item.title}.jpg`, 'copy'), item };
}

async function addResult(id: string, jobId: string, bytes: Buffer, expected: 'image' | 'video', label: string): Promise<JobResult> {
  const type = sniff(bytes);
  if (!type) throw new StoreError('결과 파일 형식을 알아보지 못했어요.');
  if (type.kind !== expected) {
    throw new StoreError(expected === 'image' ? '그림 칸에는 그림 파일만 넣을 수 있어요.' : '영상 칸에는 영상 파일만 넣을 수 있어요.');
  }
  const size = type.kind === 'image' ? await imageSize(bytes) : { width: 0, height: 0 };
  const name = `r_${jobId.replace(/[^a-z0-9]/g, '_')}.${type.ext}`;
  fs.mkdirSync(filesDir(id), { recursive: true });
  const target = path.join(filesDir(id), name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  renameWithRetry(tmp, target);
  projectLock(id, () => {
    const files = readFiles(id).filter((f) => f.name !== name);
    files.push({
      name,
      originalName: label,
      kind: 'result',
      mediaKind: type.kind,
      mime: type.mime,
      width: size.width,
      height: size.height,
      bytes: bytes.length,
      createdAt: now(),
    });
    writeJson(filesIndex(id), files);
  });
  return { file: name, kind: type.kind, mime: type.mime, width: size.width, height: size.height, bytes: bytes.length };
}

export function filePath(id: string, name: string): string {
  assertId(id);
  assertFileName(name);
  return path.join(filesDir(id), name);
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

function describeFile(p: string, name: string): { path: string; mime: string; size: number; isImage: boolean } {
  let size: number;
  try {
    size = fs.statSync(p).size;
  } catch {
    throw new StoreError('파일을 찾지 못했어요.', 404);
  }
  const mime = MIME_BY_EXT[path.extname(name).slice(1)] ?? 'application/octet-stream';
  return { path: p, mime, size, isImage: mime.startsWith('image/') };
}

export function fileInfo(id: string, name: string): { path: string; mime: string; size: number; isImage: boolean } {
  return describeFile(filePath(id, name), name);
}

const THUMB_WIDTHS = [240, 480, 960];

/** 원본이 장당 수 MB라 캔버스에는 줄인 그림을 쓴다. 한 번 만들면 파일로 남는다 */
async function thumbFor(sourcePath: string, dir: string, name: string, width: number): Promise<{ path: string; mime: string; size: number }> {
  const w = THUMB_WIDTHS.find((t) => t >= width) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
  const target = path.join(dir, `${name}-${w}.webp`);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(dir, { recursive: true });
    const buffer = await sharp(sourcePath).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, buffer);
    renameWithRetry(tmp, target);
  }
  return { path: target, mime: 'image/webp', size: fs.statSync(target).size };
}

export async function ensureThumb(id: string, name: string, width: number) {
  return thumbFor(fileInfo(id, name).path, thumbsDir(id), name, width);
}

// ─── 생성 기록 ─────────────────────────────────────────────

export function readJobs(id: string): Job[] {
  return readJson<Job[]>(jobsFile(id), []);
}

function writeJobs(id: string, jobs: Job[]): void {
  writeJson(jobsFile(id), jobs);
}

export function jobsView(id: string): { jobs: Job[]; stats: CostStats; boards: Record<string, Board> } {
  readProjectOrThrow(id);
  const jobs = readJobs(id);
  return { jobs, stats: computeStats(jobs), boards: readBoards(id) };
}

export type QueueOutcome = {
  created: Job[];
  skipped: { nodeId: string; title: string; reason: string }[];
  errors: { nodeId: string; title: string; message: string }[];
};

function scenarioText(node: StoredNode): string {
  return [node.data.logline?.trim(), node.data.scenario?.trim()].filter(Boolean).join('\n');
}

/**
 * 칸들을 생성 기록으로 옮긴다. 이 시점의 프롬프트·옵션·참조를 그대로 고정한다.
 * allowDirect 가 없으면 제미나이·GPT 칸은 거절한다. 비용을 확인한 화면에서만 켜서 보낸다.
 */
export function createJobs(id: string, canvasId: string, nodeIds: string[], allowDirect: boolean): QueueOutcome {
  const rule = ruleForProject(id);
  const models = new Map(readLibrary().filter((i): i is LibraryModel => i.kind === 'model').map((m) => [m.id, m]));
  return projectLock(id, () => {
    const doc = getCanvas(id, canvasId);
    const jobs = readJobs(id);
    const boards = readBoards(id);
    const outcome: QueueOutcome = { created: [], skipped: [], errors: [] };
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));

    const latestOf = (nodeId: string) => [...jobs].reverse().find((j) => j.nodeId === nodeId && j.status !== 'cancelled');

    for (const nodeId of topoOrder(nodeIds, doc.edges)) {
      const node = byId.get(nodeId);
      if (!node) {
        outcome.errors.push({ nodeId, title: '', message: '칸을 찾지 못했어요. 잠시 뒤 다시 눌러 주세요.' });
        continue;
      }
      if (node.type === 'ref' || node.type === 'scenario' || node.type === 'shot') continue;
      const title = node.data.title || '칸';
      const isVideo = node.type === 'video';
      const engine = isVideo ? 'higgsfield' : node.data.engine ?? 'higgsfield';
      const fail = (message: string) => outcome.errors.push({ nodeId, title, message });

      const previous = latestOf(nodeId);
      if (previous && (previous.status === 'queued' || previous.status === 'running')) {
        outcome.skipped.push({ nodeId, title, reason: '이미 대기 중이에요.' });
        continue;
      }
      const board = boards[nodeId];
      // 샷 카드가 있으면 그 내용이 프롬프트가 된다. 스토리보드에서 나눈 칸은 샷 표를 그대로 읽는다
      const shotOf = (n: StoredNode) => (n.data.boardId && n.data.shotNo ? boards[n.data.boardId]?.shots[n.data.shotNo - 1] : undefined);
      const boardShot = shotOf(node);
      const linkedShot = doc.edges
        .filter((e) => e.target === nodeId)
        .map((e) => byId.get(e.source))
        .find((n) => n?.type === 'shot');
      const fields = boardShot ?? (linkedShot ? shotOf(linkedShot) ?? linkedShot.data.shot : undefined) ?? node.data.shot;
      const prompt =
        node.type === 'video'
          ? composeShotText(fields, node.data.prompt)
          : node.type === 'image' && !node.data.prompt?.trim() && boardShot
            ? shotScenePrompt(boardShot)
            : promptOf(node.type, node.data);
      if (node.type === 'storyboard') {
        if (!board?.shots.length && !prompt) {
          fail(`'${title}'의 샷 표를 먼저 채워 주세요. 대화에서 "샷 나눠줘"라고 하면 Claude가 채워요.`);
          continue;
        }
      } else if (!prompt) {
        fail(`'${title}'에 프롬프트를 적어 주세요.`);
        continue;
      }
      if (ENGINE_INFO[engine].direct && !allowDirect) {
        fail(`'${title}'은 바로 결제되는 엔진이라 비용 확인이 필요해요.`);
        continue;
      }

      const refs: JobRef[] = [];
      const contexts: string[] = [];
      const people: string[] = [];
      const seen = new Set<string>();
      let refProblem = '';

      /** 시트에서 자른 칸을 씨앗으로 쓰고, 시트에 이어진 시나리오·모델·제품·배경을 물려받는다 */
      const addPanel = (boardId: string, shotNo: number) => {
        const boardNode = byId.get(boardId);
        const panel = boards[boardId]?.panels[shotNo - 1];
        const boardTitle = boardNode?.data.title || '스토리보드';
        if (!panel) {
          refProblem = `'${boardTitle}' 시트가 끝난 뒤에 생성할 수 있어요.`;
          return;
        }
        refs.push({
          order: refs.length + 1,
          role: 'image_references',
          sourceNodeId: boardId,
          sourceTitle: `${boardTitle} ${shotNo}번 칸`,
          sourceJobId: null,
          file: panel,
        });
        for (const edge of doc.edges) {
          if (edge.target !== boardId) continue;
          const upstream = byId.get(edge.source);
          if (upstream) addSource(upstream);
        }
      };

      const addSource = (source: StoredNode) => {
        if (seen.has(source.id)) return;
        seen.add(source.id);
        const sourceTitle = source.data.title || '칸';
        if (source.type === 'shot') {
          // 샷 카드는 글이라 그림 참조가 아니다. 시트에서 나눈 카드면 그 칸을 씨앗으로 쓴다
          if (source.data.boardId && source.data.shotNo) addPanel(source.data.boardId, source.data.shotNo);
          return;
        }
        if (source.type === 'scenario') {
          const text = scenarioText(source);
          if (text) contexts.push(text);
          return;
        }
        if (source.type === 'ref') {
          if (!source.data.file) {
            refProblem = `'${sourceTitle}'에 사진을 먼저 올려 주세요.`;
            return;
          }
          const asVideo = isVideo && source.data.video;
          // 내 모델이면 인물 설명도 함께 넣는다. 얼굴이 흔들리지 않게 잡아 주는 문장이다
          const talent = source.data.talent ? models.get(source.data.talent.libraryId) : undefined;
          if (talent) {
            const text = [talent.identityEn || talent.identity, talent.sizeEn || talent.size].filter(Boolean).join('. ');
            people.push(`${refs.length + 1}번 사진의 인물: ${text}`);
          }
          refs.push({
            order: refs.length + 1,
            role: asVideo ? 'video_references' : 'image_references',
            sourceNodeId: source.id,
            sourceTitle,
            sourceJobId: null,
            file: source.data.file.name,
            ...(asVideo ? { videoLibraryId: source.data.video?.libraryId } : {}),
          });
          return;
        }
        const sourceJob = latestOf(source.id);
        // 캐릭터 시트는 통째로 넣으면 얼굴이 흔들린다. 잘라 둔 얼굴 칸과 전신 칸을 넣는다
        const sheetPanels = source.data.sheetGrid && sourceJob?.status === 'done' ? boards[source.id]?.panels ?? [] : [];
        if (sheetPanels.length > SHEET_PANEL.faceSmile) {
          for (const [index, label] of [[SHEET_PANEL.faceSmile, '얼굴'], [SHEET_PANEL.bodyFront, '전신']] as const) {
            refs.push({
              order: refs.length + 1,
              role: 'image_references',
              sourceNodeId: source.id,
              sourceTitle: `${sourceTitle} ${label}`,
              sourceJobId: null,
              file: sheetPanels[index],
            });
          }
          return;
        }
        if (source.type === 'storyboard' && node.data.shotNo) {
          addPanel(source.id, node.data.shotNo);
          return;
        }
        const sourceReady = sourceJob && (sourceJob.status === 'done' || sourceJob.status === 'queued' || sourceJob.status === 'running');
        if (!sourceReady && source.data.boardId && source.data.shotNo) {
          // 장면을 크게 다시 뽑지 않았으면 시트의 칸으로 바로 영상을 뽑을 수 있다. 480p 초안에는 이걸로 충분하다
          addPanel(source.data.boardId, source.data.shotNo);
          return;
        }
        if (!sourceJob || !sourceReady) {
          refProblem = `앞 칸 '${sourceTitle}'의 결과가 아직 없어요. 앞 칸부터 생성해 주세요.`;
          return;
        }
        if (ENGINE_INFO[engine].direct && sourceJob.status !== 'done' && !ENGINE_INFO[sourceJob.engine].direct) {
          refProblem = `앞 칸 '${sourceTitle}'이 힉스필드 대기열에 있어요. 끝난 뒤에 바로 생성할 수 있어요.`;
          return;
        }
        refs.push({
          order: refs.length + 1,
          role: 'image_references',
          sourceNodeId: source.id,
          sourceTitle,
          sourceJobId: sourceJob.id,
          file: null,
        });
      };

      for (const edge of doc.edges) {
        if (edge.target !== nodeId) continue;
        const source = byId.get(edge.source);
        if (source) addSource(source);
        if (refProblem) break;
      }
      // 시트에서 나눈 장면은 선이 샷 카드에서 오더라도 자기 칸을 첫 참조로 쓴다
      if (!refProblem && node.type === 'image' && node.data.boardId && node.data.shotNo && !refs.some((r) => r.sourceTitle.endsWith('번 칸'))) {
        addPanel(node.data.boardId, node.data.shotNo);
      }
      if (refProblem) {
        fail(refProblem);
        continue;
      }
      if (isVideo) {
        // 장면 그림이나 시트의 칸이 이어져 있으면 첫 장을 시작 그림으로 쓴다. 올린 사진은 형태 참조로 남긴다
        const start = refs.find((r) => r.sourceJobId && r.role === 'image_references') ?? refs.find((r) => r.sourceTitle.endsWith('번 칸'));
        if (start) start.role = 'start_image';
      }

      const estimate = estimateCell(node.type, node.data) as Cost;
      let finalPrompt: string;
      let options: Job['options'];
      let actualEstimate = estimate;
      if (node.type === 'storyboard') {
        if (people.length) contexts.push(people.join('\n'));
        const cuts = board?.shots.length || node.data.cuts || 15;
        const shotAspect = node.data.aspect ?? '9:16';
        const layout = sheetLayout(cuts, shotAspect, ENGINE_INFO[engine].aspects);
        actualEstimate = estimateImage(engine, node.data.resolution, layout.aspect);
        finalPrompt = buildStoryboardPrompt({
          title,
          shots: board?.shots ?? [],
          cuts,
          total: node.data.total ?? 15,
          shotAspect,
          rows: layout.rows,
          cols: layout.cols,
          scenario: contexts.join('\n'),
          extra: prompt,
          refs: refs.map((r) => ({ order: r.order, title: r.sourceTitle })),
          ruleText: ruleTextFor(rule, 'storyboard'),
        });
        options = { aspect: layout.aspect, resolution: node.data.resolution, rows: layout.rows, cols: layout.cols };
      } else {
        const ruleText = ruleTextFor(rule, isVideo ? 'video' : 'image', fields?.must);
        finalPrompt = buildFinalPrompt(prompt, refs.length, { ruleText, context: [...contexts, ...people].join('\n') });
        options = isVideo
          ? { aspect: node.data.aspect ?? '9:16', duration: node.data.duration ?? 5, quality: node.data.quality ?? 'draft' }
          : { aspect: node.data.aspect ?? '9:16', resolution: node.data.resolution, ...(node.data.sheetGrid ?? {}) };
      }

      const job: Job = {
        id: newId('j'),
        projectId: id,
        canvasId,
        nodeId,
        title,
        kind: isVideo ? 'video' : 'image',
        ...(node.type === 'storyboard' ? { preset: 'storyboard' as const } : node.data.sheetGrid ? { preset: 'sheet' as const } : {}),
        engine,
        model: modelFor(node),
        status: 'queued',
        prompt,
        finalPrompt,
        options,
        refs,
        estimate: actualEstimate,
        actual: null,
        externalId: null,
        result: null,
        error: null,
        createdAt: now(),
        startedAt: null,
        finishedAt: null,
      };
      jobs.push(job);
      outcome.created.push(job);
    }
    if (outcome.created.length) writeJobs(id, jobs);
    return outcome;
  });
}

function modelFor(node: StoredNode): string {
  if (node.type === 'video') return node.data.model ?? DEFAULT_VIDEO_MODEL;
  const engine = node.data.engine ?? 'higgsfield';
  if (engine === 'higgsfield') return HIGGS_IMAGE_MODEL;
  // 실제 모델 이름은 호출할 때 환경변수에서 읽어 결과 기록에 다시 적는다
  return engine === 'gemini' ? process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image' : process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
}

function updateJob(id: string, jobId: string, patch: (job: Job, jobs: Job[]) => void): Job {
  return projectLock(id, () => {
    const jobs = readJobs(id);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new StoreError('생성 기록을 찾지 못했어요.', 404);
    patch(job, jobs);
    writeJobs(id, jobs);
    return job;
  });
}

function dependentsOf(jobs: Job[], jobId: string): Job[] {
  return jobs.filter((j) => j.status === 'queued' && j.refs.some((r) => r.sourceJobId === jobId));
}

export function cancelJob(id: string, jobId: string): Job {
  return updateJob(id, jobId, (job, jobs) => {
    if (job.status !== 'queued') throw new StoreError('대기 중인 칸만 취소할 수 있어요.', 409);
    const stack = [job];
    while (stack.length) {
      const current = stack.pop() as Job;
      current.status = 'cancelled';
      current.finishedAt = now();
      stack.push(...dependentsOf(jobs, current.id));
    }
  });
}

/** 앞 칸이 다 끝났는지 본다. 생성을 시작해도 되는지 판단할 때 쓴다 */
export function upstreamState(jobs: Job[], job: Job): 'ready' | 'waiting' | 'broken' {
  let state: 'ready' | 'waiting' | 'broken' = 'ready';
  for (const ref of job.refs) {
    if (!ref.sourceJobId) continue;
    const source = jobs.find((j) => j.id === ref.sourceJobId);
    if (!source || source.status === 'failed' || source.status === 'cancelled') return 'broken';
    if (source.status !== 'done') state = 'waiting';
  }
  return state;
}

export function startJob(id: string, jobId: string): Job {
  return updateJob(id, jobId, (job, jobs) => {
    if (job.status !== 'queued') throw new StoreError(`대기 중이 아니라 시작할 수 없어요 (지금: ${job.status}).`, 409);
    const state = upstreamState(jobs, job);
    if (state === 'waiting') throw new StoreError('앞 칸이 아직 끝나지 않았어요. 앞 칸부터 처리해 주세요.', 409);
    if (state === 'broken') throw new StoreError('앞 칸이 실패하거나 취소됐어요.', 409);
    job.status = 'running';
    job.startedAt = now();
    job.error = null;
  });
}

export function requeueJob(id: string, jobId: string): Job {
  return updateJob(id, jobId, (job) => {
    if (job.status !== 'running') throw new StoreError('생성 중인 칸만 되돌릴 수 있어요.', 409);
    job.status = 'queued';
    job.startedAt = null;
  });
}

export async function completeJob(
  id: string,
  jobId: string,
  input: { bytes: Buffer; actual: Cost | null; externalId?: string | null; model?: string },
): Promise<Job> {
  const before = readJobs(id).find((j) => j.id === jobId);
  if (!before) throw new StoreError('생성 기록을 찾지 못했어요.', 404);
  if (before.status === 'done') throw new StoreError('이미 결과가 들어간 칸이에요.', 409);
  if (before.status === 'cancelled') throw new StoreError('취소된 칸이에요.', 409);
  const result = await addResult(id, jobId, input.bytes, before.kind, before.title);
  if (before.preset === 'storyboard' || before.preset === 'sheet') {
    // 자르기가 실패해도 시트는 살린다. 칸 없이 큰 그림으로 볼 수 있다
    let panels: string[] = [];
    try {
      panels = await sliceSheet(id, before, input.bytes);
    } catch (e) {
      console.error('시트 자르기 실패', e);
    }
    saveBoardPanels(id, before.nodeId, result.file, panels);
  }
  return updateJob(id, jobId, (job) => {
    job.status = 'done';
    job.result = result;
    job.actual = input.actual;
    job.externalId = input.externalId ?? job.externalId;
    if (input.model) job.model = input.model;
    job.error = null;
    job.startedAt = job.startedAt ?? now();
    job.finishedAt = now();
  });
}

export function failJob(id: string, jobId: string, error: JobError, actual: Cost | null = null): Job {
  return updateJob(id, jobId, (job, jobs) => {
    job.status = 'failed';
    job.error = error;
    job.actual = actual;
    job.finishedAt = now();
    const stack = dependentsOf(jobs, job.id);
    while (stack.length) {
      const current = stack.pop() as Job;
      current.status = 'failed';
      current.error = { message: `앞 칸 '${job.title}'이 실패해서 멈췄어요.` };
      current.finishedAt = now();
      stack.push(...dependentsOf(jobs, current.id));
    }
  });
}

export function findJob(jobId: string): { projectId: string; job: Job; jobs: Job[] } | null {
  for (const projectId of projectIds()) {
    const jobs = readJobs(projectId);
    const job = jobs.find((j) => j.id === jobId);
    if (job) return { projectId, job, jobs };
  }
  return null;
}

/** 대기열 스크립트가 읽는 힉스필드 작업들. 앞 칸부터 순서대로 나온다 */
export function pendingHiggsfieldJobs(): { projectId: string; projectName: string; job: Job; jobs: Job[] }[] {
  const out: { projectId: string; projectName: string; job: Job; jobs: Job[] }[] = [];
  for (const projectId of projectIds()) {
    const jobs = readJobs(projectId);
    const project = readProjectOrThrow(projectId);
    for (const job of jobs) {
      if (job.engine === 'higgsfield' && (job.status === 'queued' || job.status === 'running')) {
        out.push({ projectId, projectName: project.name, job, jobs });
      }
    }
  }
  return out;
}

export function resolveRefFile(jobs: Job[], ref: JobRef): string | null {
  if (!ref.sourceJobId) return ref.file;
  return jobs.find((j) => j.id === ref.sourceJobId)?.result?.file ?? null;
}

/** 대화에서 샷을 나눌 때 읽는 스토리보드 정보 */
export function storyboardsForPlanning(): {
  projectId: string;
  projectName: string;
  canvasId: string;
  nodeId: string;
  title: string;
  cuts: number;
  total: number;
  aspect: string;
  scenario: string;
  sources: { title: string; kind: string; role?: string }[];
  rule: RuleSet;
  shots: BoardShot[];
  /** 레퍼런스를 따라 만드는 프로젝트면 분석 id 와 따라 만드는 정도 */
  reference: Project['reference'] | null;
}[] {
  const out = [];
  for (const projectId of projectIds()) {
    const project = readProjectOrThrow(projectId);
    const boards = readBoards(projectId);
    for (const canvas of project.canvases) {
      const doc = readCanvasRaw(projectId, canvas.id);
      const byId = new Map(doc.nodes.map((n) => [n.id, n]));
      for (const node of doc.nodes) {
        if (node.type !== 'storyboard') continue;
        const sources = doc.edges.filter((e) => e.target === node.id).map((e) => byId.get(e.source)).filter((n): n is StoredNode => !!n);
        out.push({
          reference: project.reference ?? null,
          projectId,
          projectName: project.name,
          canvasId: canvas.id,
          nodeId: node.id,
          title: node.data.title,
          cuts: node.data.cuts ?? 15,
          total: node.data.total ?? 15,
          aspect: node.data.aspect ?? '9:16',
          scenario: sources.filter((s) => s.type === 'scenario').map(scenarioText).join('\n'),
          sources: sources
            .filter((s) => s.type !== 'scenario')
            .map((s) => ({ title: s.data.title, kind: s.type, role: s.data.role ?? s.data.preset })),
          rule: ruleForProject(projectId),
          shots: boards[node.id]?.shots ?? [],
        });
      }
    }
  }
  return out;
}

// ─── 자산 ─────────────────────────────────────────────────

export function readLibrary(): LibraryItem[] {
  return readJson<LibraryItem[]>(libraryFile(), []);
}

function writeLibrary(items: LibraryItem[]): void {
  writeJson(libraryFile(), items);
}

/** 기본 규칙과 요기보 규칙을 넣어 둔다. 옛 기본 규칙은 요기보 내용이라 둘로 나눈다 */
export function ensureRules(): LibraryRule[] {
  const ready = (items: LibraryItem[]) => {
    const rules = items.filter((i): i is LibraryRule => i.kind === 'rule');
    return rules.some((r) => r.id === DEFAULT_RULE_ID && r.title !== '요기보 숏츠 기본') && rules.some((r) => r.id === YOGIBO_RULE_ID) ? rules : null;
  };
  const found = ready(readLibrary());
  if (found) return found;
  return libraryLock(() => {
    const items = readLibrary();
    const again = ready(items);
    if (again) return again;
    const make = (id: string, title: string, rule: RuleSet): LibraryRule => ({ id, kind: 'rule', title, rule, createdAt: now(), updatedAt: now() });
    const others = items.filter((i) => !(i.kind === 'rule' && (i.id === DEFAULT_RULE_ID || i.id === YOGIBO_RULE_ID)));
    const oldDefault = items.find((i): i is LibraryRule => i.kind === 'rule' && i.id === DEFAULT_RULE_ID);
    const oldYogibo = items.find((i): i is LibraryRule => i.kind === 'rule' && i.id === YOGIBO_RULE_ID);
    const isOld = oldDefault?.title === '요기보 숏츠 기본';
    const base = oldDefault && !isOld ? oldDefault : make(DEFAULT_RULE_ID, '숏츠 기본', DEFAULT_RULE);
    const yogibo = oldYogibo ?? make(YOGIBO_RULE_ID, '요기보', isOld && oldDefault ? oldDefault.rule : YOGIBO_RULE);
    writeLibrary([base, yogibo, ...others]);
    return [base, yogibo, ...others.filter((i): i is LibraryRule => i.kind === 'rule')];
  });
}

export function ruleItemForProject(id: string): LibraryRule {
  const rules = ensureRules();
  const project = readProjectOrThrow(id);
  return rules.find((r) => r.id === project.ruleId) ?? rules[0];
}

function ruleForProject(id: string): RuleSet {
  return ruleItemForProject(id).rule;
}

export function updateRule(itemId: string, patch: { title?: string; rule?: Partial<RuleSet> }): LibraryRule {
  return libraryLock(() => {
    const items = readLibrary();
    const item = items.find((i): i is LibraryRule => i.id === itemId && i.kind === 'rule');
    if (!item) throw new StoreError('규칙을 찾지 못했어요.', 404);
    if (patch.title?.trim()) item.title = patch.title.trim().slice(0, 60);
    if (patch.rule) item.rule = { ...item.rule, ...patch.rule };
    item.updatedAt = now();
    writeLibrary(items);
    return item;
  });
}

export function createRule(fromId?: string): LibraryRule {
  ensureRules();
  return libraryLock(() => {
    const items = readLibrary();
    const source = items.find((i): i is LibraryRule => i.id === fromId && i.kind === 'rule') ?? items.find((i): i is LibraryRule => i.kind === 'rule');
    const rule: LibraryRule = {
      id: newId('l'),
      kind: 'rule',
      title: `${source?.title ?? '규칙'} 사본`,
      rule: source?.rule ?? DEFAULT_RULE,
      createdAt: now(),
      updatedAt: now(),
    };
    writeLibrary([...items, rule]);
    return rule;
  });
}

export function libraryFilePath(name: string): string {
  if (!LIBRARY_FILE_RE.test(name)) throw new StoreError('잘못된 파일 이름이에요.', 404);
  return path.join(libraryFilesDir(), name);
}

export function libraryFileInfo(name: string) {
  return describeFile(libraryFilePath(name), name);
}

export async function ensureLibraryThumb(name: string, width: number) {
  return thumbFor(libraryFileInfo(name).path, libraryThumbsDir(), name, width);
}

/** 사진을 자산으로 저장한다 */
export async function addLibraryImage(bytes: Buffer, originalName: string, type: AssetType, title: string): Promise<LibraryImage> {
  const kind = sniff(bytes);
  if (!kind || kind.kind !== 'image') throw new StoreError('JPG, PNG, WEBP 사진만 올릴 수 있어요.');
  const { width, height } = await imageSize(bytes);
  const name = `l_${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${kind.ext}`;
  return libraryLock(() => {
    const items = readLibrary();
    const existing = items.find((i): i is LibraryImage => i.kind === 'image' && i.file === name);
    if (existing) {
      existing.type = type;
      existing.title = title.trim() || existing.title;
      writeLibrary(items);
      return existing;
    }
    fs.mkdirSync(libraryFilesDir(), { recursive: true });
    fs.writeFileSync(path.join(libraryFilesDir(), name), bytes);
    const item: LibraryImage = {
      id: newId('l'),
      kind: 'image',
      type,
      title: title.trim().slice(0, 60) || originalName,
      file: name,
      originalName,
      width,
      height,
      createdAt: now(),
    };
    writeLibrary([...items, item]);
    return item;
  });
}

export async function saveProjectFileAsAsset(projectId: string, name: string, type: AssetType, title: string): Promise<LibraryImage> {
  const info = fileInfo(projectId, name);
  if (!info.isImage) throw new StoreError('사진만 자산으로 저장할 수 있어요.');
  return addLibraryImage(fs.readFileSync(info.path), name, type, title);
}

export function updateLibraryImage(itemId: string, patch: { type?: AssetType; title?: string }): LibraryImage {
  return libraryLock(() => {
    const items = readLibrary();
    const item = items.find((i): i is LibraryImage => i.id === itemId && i.kind === 'image');
    if (!item) throw new StoreError('자산을 찾지 못했어요.', 404);
    if (patch.type) item.type = patch.type;
    if (patch.title?.trim()) item.title = patch.title.trim().slice(0, 60);
    writeLibrary(items);
    return item;
  });
}

/** imgCreate에서 가져온 항목을 새 내용으로 바꾼다. 내가 만든 자산은 건드리지 않는다 */
export function replaceImported(next: (LibraryIdea | LibraryBoard | LibraryWork | LibraryVideo | LibraryModel)[]): void {
  libraryLock(() => {
    const items = readLibrary().filter((i) => !('source' in i && i.source === 'imgcreate'));
    writeLibrary([...items, ...next]);
  });
}

export function addLibraryFrame(fileName: string, bytes: Buffer): string {
  const safe = `f_${fileName.toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}`;
  fs.mkdirSync(libraryFilesDir(), { recursive: true });
  fs.writeFileSync(path.join(libraryFilesDir(), safe), bytes);
  return safe;
}

const videoLocalName = (itemId: string) => `v_${itemId.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.mp4`;

export function libraryVideo(itemId: string): LibraryVideo {
  const item = readLibrary().find((i): i is LibraryVideo => i.id === itemId && i.kind === 'video');
  if (!item) throw new StoreError('영상을 찾지 못했어요.', 404);
  return item;
}

export function libraryVideoPath(itemId: string): string {
  return libraryFilePath(videoLocalName(itemId));
}

/** 영상을 참조로 넘기려면 파일이 있어야 한다. 처음 쓸 때만 내려받는다 */
export async function ensureLibraryVideoFile(itemId: string): Promise<string> {
  const target = libraryVideoPath(itemId);
  if (fs.existsSync(target)) return target;
  const item = libraryVideo(itemId);
  const res = await fetch(`${item.origin}/${item.key}`);
  if (!res.ok) throw new StoreError(`영상을 받지 못했어요 (HTTP ${res.status}).`, 502);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sniff(bytes)?.kind !== 'video') throw new StoreError('받은 파일이 영상이 아니에요.', 502);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  renameWithRetry(tmp, target);
  return target;
}

export function listLibrary(): LibraryView {
  ensureRules();
  const items = readLibrary();
  const images: AssetView[] = [];
  const results: LibraryResult[] = [];

  for (const item of items) {
    if (item.kind !== 'image') continue;
    images.push({
      key: item.id,
      name: item.file,
      title: item.title,
      type: item.type,
      width: item.width,
      height: item.height,
      url: `/api/library/files/${item.file}`,
      thumb: `/api/library/files/${item.file}?w=480`,
      source: 'library',
      libraryId: item.id,
      createdAt: item.createdAt,
    });
  }

  const seen = new Set(images.map((i) => i.name.replace(/^l_/, '')));
  for (const projectId of projectIds()) {
    const project = readProjectOrThrow(projectId);
    for (const file of readFiles(projectId)) {
      const bare = file.name.replace(/^u_/, '');
      if (file.kind !== 'upload' || seen.has(bare)) continue;
      seen.add(bare);
      images.push({
        key: `${projectId}/${file.name}`,
        name: file.name,
        title: file.originalName,
        type: 'other',
        width: file.width,
        height: file.height,
        url: `/api/projects/${projectId}/files/${file.name}`,
        thumb: `/api/projects/${projectId}/files/${file.name}?w=480`,
        source: 'project',
        projectId,
        projectName: project.name,
        createdAt: file.createdAt,
      });
    }
    const stages = new Map(
      project.canvases.flatMap((c) => readCanvasRaw(projectId, c.id).nodes).flatMap((n) => (n.data.stage ? [[n.id, n.data.stage] as const] : [])),
    );
    for (const job of readJobs(projectId)) {
      if (job.status === 'done' && job.result) {
        results.push({
          stage: stages.get(job.nodeId),
          jobId: job.id,
          projectId,
          projectName: project.name,
          title: job.title,
          prompt: job.prompt,
          engine: job.engine,
          model: job.model,
          cost: job.actual ?? job.estimate,
          costIsActual: !!job.actual,
          externalId: job.externalId,
          finishedAt: job.finishedAt ?? job.createdAt,
          result: job.result,
        });
      }
    }
  }

  return {
    models: items.filter((i): i is LibraryModel => i.kind === 'model'),
    images: images.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    rules: items.filter((i): i is LibraryRule => i.kind === 'rule'),
    ideas: items.filter((i): i is LibraryIdea => i.kind === 'idea'),
    boards: items.filter((i): i is LibraryBoard => i.kind === 'storyboard'),
    works: items.filter((i): i is LibraryWork => i.kind === 'work'),
    videos: items.filter((i): i is LibraryVideo => i.kind === 'video'),
    results: results.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
  };
}

// ─── 새 모델 만들기 ────────────────────────────────────────

/**
 * 새 모델을 만드는 프로젝트를 차린다. 앞·뒤·옆·표정을 한 장에 뽑고 앱이 칸별로 자른다.
 * 참고 사진을 넣으면 닮은 정도를 프롬프트에 적는다. 여기서는 아무것도 생성하지 않는다.
 */
export async function startModelDraft(input: {
  title?: string;
  category?: string;
  identity?: string;
  size?: string;
  likeness?: number;
  refs?: { bytes: Buffer; name: string }[];
}): Promise<Project> {
  const title = input.title?.trim();
  const identity = input.identity?.trim() ?? '';
  const refs = input.refs ?? [];
  if (!title) throw new StoreError('모델 이름을 적어 주세요.');
  if (!identity && !refs.length) throw new StoreError('어떤 사람인지 적거나 참고 사진을 넣어 주세요.');
  const size = input.size?.trim() ?? '';
  const project = createProject(`모델: ${title}`);
  const canvasId = project.canvases[0].id;
  const nid = () => `n_${crypto.randomBytes(6).toString('hex')}`;
  const refNodes: StoredNode[] = [];
  for (const [index, ref] of refs.entries()) {
    const entry = await addUpload(project.id, ref.bytes, ref.name, 'copy');
    refNodes.push({
      id: nid(),
      type: 'ref',
      position: { x: 0, y: index * 250 },
      data: {
        title: `참고 사진 ${index + 1}`,
        file: { name: entry.name, originalName: entry.originalName, width: entry.width, height: entry.height },
        role: 'character',
      },
    });
  }
  const likeness = refs.length ? input.likeness ?? 60 : undefined;
  const sheetId = nid();
  const person = [identity, size].filter(Boolean).join('. ');
  const sheet: StoredNode = {
    id: sheetId,
    type: 'image',
    position: { x: refs.length ? 340 : 0, y: 0 },
    data: {
      title: '모델 시트',
      preset: 'character',
      prompt: modelSheetPrompt(person, refs.length, likeness),
      engine: 'higgsfield',
      aspect: '3:2',
      resolution: '4k',
      sheetGrid: MODEL_SHEET_GRID,
    },
  };
  const edges: StoredEdge[] = refNodes.map((node) => ({ id: `e_${crypto.randomBytes(6).toString('hex')}`, source: node.id, target: sheetId }));
  saveCanvas(project.id, canvasId, { nodes: [...refNodes, sheet], edges, viewport: null, revision: 0 });
  return projectLock(project.id, () => {
    const current = readProjectOrThrow(project.id);
    current.modelDraft = { title, category: input.category?.trim() || '기타', identity, size, likeness, nodes: { sheet: sheetId } };
    writeJson(projectFile(project.id), current);
    return current;
  });
}

/** 끝난 시트를 내 모델로 저장한다. 자른 칸에서 대표컷과 얼굴을, 시트의 윗줄·아랫줄에서 몸과 표정을 만든다 */
export async function saveModelFromDraft(projectId: string): Promise<LibraryModel> {
  const project = readProjectOrThrow(projectId);
  const draft = project.modelDraft;
  if (!draft) throw new StoreError('모델을 만드는 프로젝트가 아니에요.');
  const job = [...readJobs(projectId)].reverse().find((j) => j.nodeId === draft.nodes.sheet && j.status === 'done' && j.result);
  if (!job?.result) throw new StoreError('모델 시트를 먼저 뽑아 주세요.');
  const panels = readBoards(projectId)[draft.nodes.sheet]?.panels ?? [];
  const sheetBytes = fs.readFileSync(filePath(projectId, job.result.file));
  const keep = async (bytes: Buffer, label: string) => {
    const saved = await addLibraryImage(bytes, `${draft.title} ${label}.jpg`, 'character', `${draft.title} ${label}`);
    return `/api/library/files/${saved.file}`;
  };
  const panelBytes = (index: number) => (panels[index] ? fs.readFileSync(filePath(projectId, panels[index])) : sheetBytes);
  const { width = 0, height = 0 } = await sharp(sheetBytes).metadata();
  const half = Math.floor(height / 2);
  const strip = (top: number, stripHeight: number) => sharp(sheetBytes).extract({ left: 0, top, width, height: stripHeight }).jpeg({ quality: 92 }).toBuffer();
  const rep = await keep(panelBytes(SHEET_PANEL.faceSmile), '대표컷');
  const sheets = {
    face: await keep(panelBytes(SHEET_PANEL.faceNeutral), '얼굴'),
    expr: await keep(await strip(half, height - half), '표정 시트'),
    body: await keep(await strip(0, half), '몸 시트'),
  };
  const identity = draft.identity || '참고 사진을 닮은 모델';
  const model = libraryLock(() => {
    // 시트마다 이미지 자산이 따로 보이면 목록이 어지러워서 모델 하나로 묶는다
    const usedFiles = new Set([rep, sheets.face, sheets.expr, sheets.body].map((u) => String(u).split('/').pop()));
    const items = readLibrary().filter((i) => !(i.kind === 'image' && usedFiles.has(i.file)));
    const existing = items.find((i): i is LibraryModel => i.kind === 'model' && i.id === draft.savedId);
    const next: LibraryModel = {
      id: existing?.id ?? newId('l'),
      kind: 'model',
      source: 'local',
      code: existing?.code ?? '',
      title: draft.title,
      category: draft.category,
      identity,
      identityEn: identity,
      size: draft.size,
      sizeEn: draft.size,
      rep,
      sheets,
      outfits: existing?.outfits ?? [],
      createdAt: existing?.createdAt ?? now(),
    };
    writeLibrary(existing ? items.map((i) => (i === existing ? next : i)) : [...items, next]);
    return next;
  });
  projectLock(projectId, () => {
    const current = readProjectOrThrow(projectId);
    if (current.modelDraft) current.modelDraft.savedId = model.id;
    writeJson(projectFile(projectId), current);
  });
  return model;
}

// ─── 내 기획에서 시작하기 ──────────────────────────────────

/** "0~9초 · 맥스를 끌어안고…" 형식의 기획안 줄을 샷으로 바꾼다 */
export function beatsToShots(beats: string[]): BoardShot[] {
  return beats.map((beat, index) => {
    const match = /^\s*([\d.]+)\s*[~-]\s*([\d.]+)\s*초\s*[·:]?\s*(.*)$/.exec(beat);
    const seconds = match ? Math.max(0.5, Number(match[2]) - Number(match[1])) : 3;
    return { no: index + 1, seconds, scene: (match ? match[3] : beat).trim(), tension: 30, must: [] };
  });
}

function totalOf(length: string, shots: BoardShot[]): number {
  const parsed = parseFloat(length);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return shots.reduce((sum, s) => sum + s.seconds, 0) || 15;
}

/** 기획안이나 스토리보드로 새 프로젝트를 만든다. 생성은 하지 않는다 */
export async function startFromLibrary(itemId: string): Promise<Project> {
  const item = readLibrary().find((i) => i.id === itemId);
  if (!item || (item.kind !== 'idea' && item.kind !== 'storyboard')) throw new StoreError('기획을 찾지 못했어요.', 404);
  const project = createProject(item.title);
  const canvasId = project.canvases[0].id;
  const scenarioId = `n_${crypto.randomBytes(6).toString('hex')}`;
  const boardId = `n_${crypto.randomBytes(6).toString('hex')}`;

  const shots: BoardShot[] =
    item.kind === 'idea'
      ? beatsToShots(item.beats)
      : item.shots.map((shot, index) => ({
          no: index + 1,
          seconds: shot.seconds || 3,
          scene: shot.scene,
          action: shot.action,
          camera: shot.camera,
          tension: 30,
          must: [],
        }));
  const total = item.kind === 'idea' ? totalOf(item.length, shots) : item.total;
  const aspect = item.kind === 'storyboard' ? item.aspect || '9:16' : '9:16';

  const nodes: StoredNode[] = [
    {
      id: scenarioId,
      type: 'scenario',
      position: { x: 330, y: 120 },
      data:
        item.kind === 'idea'
          ? { title: '시나리오', logline: item.logline, scenario: [item.hook && `훅: ${item.hook}`, ...item.beats].filter(Boolean).join('\n'), total }
          : { title: '시나리오', logline: '', scenario: item.scenario, total },
    },
    {
      id: boardId,
      type: 'storyboard',
      position: { x: 680, y: 120 },
      data: { title: '스토리보드', cuts: shots.length || 15, total, aspect, engine: 'higgsfield', resolution: '2k', prompt: '' },
    },
  ];
  const edges: StoredEdge[] = [{ id: `e_${crypto.randomBytes(6).toString('hex')}`, source: scenarioId, target: boardId }];
  saveCanvas(project.id, canvasId, { nodes, edges, viewport: null, revision: 0 });
  saveBoardShots(project.id, boardId, shots);

  // 가져온 스토리보드의 칸 그림이 있으면 함께 넣는다. 일부를 못 받아도 프로젝트는 만든다
  if (item.kind === 'storyboard' && item.shots.every((s) => s.image)) {
    const panels: string[] = [];
    for (const shot of item.shots) {
      try {
        const res = await fetch(shot.image);
        if (!res.ok) throw new Error(String(res.status));
        panels.push((await addUpload(project.id, Buffer.from(await res.arrayBuffer()), `${shot.no}번 칸.jpg`)).name);
      } catch {
        break;
      }
    }
    if (panels.length === item.shots.length) saveBoardPanels(project.id, boardId, panels[0], panels);
  }
  return getProject(project.id);
}

// ─── 설정 ─────────────────────────────────────────────────

type Settings = { balance?: BalanceInfo; geminiUsed?: number };

const readSettings = () => readJson<Settings>(settingsFile(), {});

export function getBalance(): BalanceInfo {
  return readSettings().balance ?? null;
}

export function setBalance(credits: number): BalanceInfo {
  return withLock(`${settingsFile()}.lock`, () => {
    const settings = readSettings();
    settings.balance = { credits, at: now() };
    writeJson(settingsFile(), settings);
    return settings.balance;
  });
}

export function getGeminiUsed(): number {
  return readSettings().geminiUsed ?? 0;
}

export function addGeminiUsed(count: number): void {
  withLock(`${settingsFile()}.lock`, () => {
    const settings = readSettings();
    settings.geminiUsed = (settings.geminiUsed ?? 0) + count;
    writeJson(settingsFile(), settings);
  });
}

// ─── 제품 목록 ────────────────────────────────────────────

const productsFile = () => path.join(libraryRoot(), 'products.json');

export function readProducts(): ProductEntry[] {
  return readJson<ProductEntry[]>(productsFile(), []);
}

export function saveProducts(products: ProductEntry[]): void {
  libraryLock(() => writeJson(productsFile(), products));
}

/**
 * 대화에서 "맥스 써 줘"라고 할 때 쓴다. 제품이나 모델을 참조 칸으로 만들어 스토리보드에 잇는다.
 * 저장된 캔버스에 넣으므로 화면이 열려 있으면 몇 초 안에 따라온다.
 */
export async function connectAsset(
  projectId: string,
  input: { canvasId?: string; name: string; toTitle?: string },
): Promise<{ title: string; target: string | null }> {
  const project = readProjectOrThrow(projectId);
  const canvasId = input.canvasId ?? project.canvases[0].id;
  const needle = input.name.replace(/\s/g, '');
  const same = (text: string) => text.replace(/[\s_]/g, '').includes(needle);
  const library = readLibrary();
  const models = library.filter((i): i is LibraryModel => i.kind === 'model' && (same(i.title) || same(i.code)));
  const products = readProducts().filter((p) => same(p.name));
  const found = models.length + products.length;
  if (!found) throw new StoreError(`'${input.name}'을 찾지 못했어요.`, 404);
  const exact = [...models.filter((m) => m.title.replace(/\s/g, '') === needle), ...products.filter((p) => p.name.replace(/[\s_]/g, '') === needle)];
  if (found > 1 && exact.length !== 1) {
    const names = [...models.map((m) => m.title), ...products.map((p) => p.name)].slice(0, 12).join(', ');
    throw new StoreError(`'${input.name}'에 맞는 것이 여럿이에요: ${names}`, 409);
  }
  const pick = exact[0] ?? models[0] ?? products[0];
  let data: StoredNode['data'];
  if ('front' in pick) {
    if (!project.ruleId || project.ruleId === DEFAULT_RULE_ID) updateProject(projectId, { ruleId: YOGIBO_RULE_ID });
    const res = await fetch(pick.front);
    if (!res.ok) throw new StoreError(`제품 사진을 받지 못했어요 (HTTP ${res.status}).`, 502);
    const entry = await addUpload(projectId, Buffer.from(await res.arrayBuffer()), `${pick.name}.jpg`, 'copy');
    data = { title: `제품 · ${pick.name}`, file: { name: entry.name, originalName: entry.originalName, width: entry.width, height: entry.height }, role: 'product' };
  } else {
    const { entry } = await copyModelImage(projectId, pick.id, 'rep');
    data = {
      title: `모델 · ${pick.title}`,
      file: { name: entry.name, originalName: entry.originalName, width: entry.width, height: entry.height },
      role: 'character',
      talent: { libraryId: pick.id, title: pick.title, variant: 'rep' },
    };
  }
  return projectLock(projectId, () => {
    const doc = getCanvas(projectId, canvasId);
    const target =
      doc.nodes.find((n) => input.toTitle && n.data.title === input.toTitle) ??
      (input.toTitle ? undefined : doc.nodes.find((n) => n.type === 'storyboard'));
    if (input.toTitle && !target) throw new StoreError(`'${input.toTitle}' 칸을 찾지 못했어요.`, 404);
    const id = `n_${crypto.randomBytes(6).toString('hex')}`;
    const lefts = doc.nodes.filter((n) => n.type === 'ref' || n.type === 'scenario');
    const x = lefts.length ? Math.min(...lefts.map((n) => n.position.x)) : target ? target.position.x - 340 : 0;
    const y = lefts.length ? Math.max(...lefts.map((n) => n.position.y)) + 260 : target?.position.y ?? 0;
    const next: CanvasDoc = {
      ...doc,
      nodes: [...doc.nodes, { id, type: 'ref', position: { x, y }, data }],
      edges: target ? [...doc.edges, { id: `e_${crypto.randomBytes(6).toString('hex')}`, source: id, target: target.id }] : doc.edges,
      revision: doc.revision + 1,
      updatedAt: now(),
    };
    writeJson(canvasFile(projectId, canvasId), next);
    return { title: data.title, target: target?.data.title ?? null };
  });
}

// ─── CF 레퍼런스 ──────────────────────────────────────────

const cfFile = () => path.join(libraryRoot(), 'cf-refs.json');
const folderNotesFile = () => path.join(libraryRoot(), 'folder-notes.json');

export function readCfLibrary(): CfLibrary {
  return readJson<CfLibrary>(cfFile(), { refs: [], concepts: [] });
}

export function saveCfLibrary(library: CfLibrary): void {
  libraryLock(() => writeJson(cfFile(), library));
}

/** 제작물 폴더에 붙는 설명과 순서. imgCreate 에서 가져온다 */
export type FolderNotes = { order: string[]; notes: Record<string, string> };

export function readFolderNotes(): FolderNotes {
  return readJson<FolderNotes>(folderNotesFile(), { order: [], notes: {} });
}

export function saveFolderNotes(notes: FolderNotes): void {
  libraryLock(() => writeJson(folderNotesFile(), notes));
}

/**
 * CF 레퍼런스로 새 프로젝트를 만든다. 구조와 기법만 시나리오로 옮긴다.
 * 남의 브랜드·사람·문구가 생성 프롬프트로 들어가지 않게 원작 설명과 브랜드 이름은 넣지 않는다.
 */
export function startFromCf(refId: string): Project {
  const ref = readCfLibrary().refs.find((r) => r.refId === refId);
  if (!ref) throw new StoreError('레퍼런스를 찾지 못했어요.', 404);
  const project = createProject(`${ref.titleKo || ref.title} 참고`);
  const canvasId = project.canvases[0].id;
  const scenarioId = `n_${crypto.randomBytes(6).toString('hex')}`;
  const boardId = `n_${crypto.randomBytes(6).toString('hex')}`;
  const total = Math.max(4, Math.min(180, ref.lengthSec || 15));
  const tone = [(ref.tone?.mood ?? []).join(', '), ref.tone?.pace].filter(Boolean).join(' · ');
  const scenario = [
    ref.why && `왜 맞는지: ${ref.why}`,
    ref.technique?.length && `기법: ${ref.technique.join(', ')}`,
    tone && `분위기: ${tone}`,
    ref.make && `만드는 방식: ${[ref.make, ref.makeNote].filter(Boolean).join(' · ')}`,
  ]
    .filter(Boolean)
    .join('\n');
  const nodes: StoredNode[] = [
    { id: scenarioId, type: 'scenario', position: { x: 0, y: 0 }, data: { title: '시나리오', logline: ref.adapt ?? '', scenario, total } },
    {
      id: boardId,
      type: 'storyboard',
      position: { x: 340, y: 0 },
      data: { title: '스토리보드', cuts: 15, total, aspect: ref.format === '숏폼' ? '9:16' : '16:9', engine: 'higgsfield', resolution: '2k', prompt: '' },
    },
  ];
  const edges: StoredEdge[] = [{ id: `e_${crypto.randomBytes(6).toString('hex')}`, source: scenarioId, target: boardId }];
  saveCanvas(project.id, canvasId, { nodes, edges, viewport: null, revision: 0 });
  return getProject(project.id);
}

// ─── 메인에 건 작업물 ─────────────────────────────────────

const showcaseFile = () => path.join(libraryRoot(), 'showcase.json');

/** 메인 화면에 걸 작업물. 사용자가 갤러리에서 직접 고른 것만 넣는다. video:<자산 id> 또는 result:<job id> */
export function readShowcase(): string[] {
  return readJson<string[]>(showcaseFile(), []);
}

export function setShowcase(key: string, on: boolean): string[] {
  if (!/^(video|result):[A-Za-z0-9_-]+$/.test(key)) throw new StoreError('작업물을 찾지 못했어요.');
  return libraryLock(() => {
    const keys = readShowcase().filter((k) => k !== key);
    const next = on ? [key, ...keys] : keys;
    writeJson(showcaseFile(), next);
    return next;
  });
}
