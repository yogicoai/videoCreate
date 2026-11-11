import type {
  AssetType,
  BoardShot,
  CellData,
  CellKind,
  CellStatus,
  Cost,
  CostStats,
  EngineId,
  FollowLevel,
  ImagePreset,
  Job,
  ShotFields,
  StoredEdge,
  StoredNode,
} from './types.ts';

/**
 * 엔진·모델 표와 예상 비용. 화면과 서버, 대기열 스크립트가 같은 값을 쓴다.
 *
 * 힉스필드 값은 2026-11-05 get_cost 실측이다.
 *   nano_banana_pro: 1k 2, 2k 2, 4k 4크레딧
 *   seedance_2_5: 초안 초당 3, 720p 초당 7, 1080p 초당 16크레딧 (소리 여부와 무관)
 * 제미나이 2K는 imgCreate 실측 ₩230~₩314다. 사고 토큰에 따라 흔들려 범위로 둔다.
 * 4K와 GPT는 토큰 단가로 계산한 참고치이며 실제 금액은 생성 뒤 응답의 사용량으로 다시 적는다.
 */

export const HIGGS_IMAGE_MODEL = 'nano_banana_pro';
export const DEFAULT_VIDEO_MODEL = 'seedance_2_5';

export const IMAGE_ASPECTS = ['9:16', '2:3', '3:4', '4:5', '1:1', '5:4', '4:3', '3:2', '16:9', '21:9'] as const;
export const SHOT_ASPECTS = ['9:16', '4:5', '1:1', '16:9'] as const;

export const ENGINE_ORDER: EngineId[] = ['gemini', 'openai', 'higgsfield'];

export const ENGINE_INFO: Record<
  EngineId,
  { label: string; short: string; direct: boolean; aspects: readonly string[]; resolutions: readonly string[] }
> = {
  gemini: { label: '제미나이', short: '제미나이', direct: true, aspects: IMAGE_ASPECTS, resolutions: ['1k', '2k', '4k'] },
  // GPT는 세 가지 크기만 받는다(세로 1024×1536, 정사각 1024, 가로 1536×1024)
  openai: { label: 'GPT', short: 'GPT', direct: true, aspects: ['2:3', '1:1', '3:2'], resolutions: [] },
  higgsfield: { label: '힉스필드 대기열', short: '힉스필드', direct: false, aspects: IMAGE_ASPECTS, resolutions: ['1k', '2k', '4k'] },
};

export const VIDEO_MODELS: Record<
  string,
  { label: string; aspects: readonly string[]; minDuration: number; maxDuration: number }
> = {
  seedance_2_5: {
    label: 'Seedance 2.5',
    aspects: ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'],
    minDuration: 4,
    maxDuration: 30,
  },
};

export const VIDEO_QUALITIES: Record<string, { label: string; perSecond: number }> = {
  draft: { label: '초안 480p', perSecond: 3 },
  '720p': { label: '720p', perSecond: 7 },
  '1080p': { label: '1080p', perSecond: 16 },
};

export const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: 'character', label: '캐릭터' },
  { value: 'product', label: '제품' },
  { value: 'background', label: '배경' },
  { value: 'other', label: '기타' },
];

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  character: '캐릭터',
  product: '제품',
  background: '배경',
  other: '기타',
};

/** 7단계 제작 흐름 */
export const STEPS = ['시나리오', '캐릭터 시트', '스토리보드', '프롬프트', '영상 생성', '편집', '완성'] as const;

export function gptSize(aspect: string): { size: string; width: number; height: number } {
  const ratio = aspectToRatio(aspect);
  if (ratio >= 1.15) return { size: '1536x1024', width: 1536, height: 1024 };
  if (ratio <= 0.87) return { size: '1024x1536', width: 1024, height: 1536 };
  return { size: '1024x1024', width: 1024, height: 1024 };
}

export function estimateImage(engine: EngineId, resolution: string | undefined, aspect: string): Cost {
  const res = resolution ?? '2k';
  if (engine === 'higgsfield') return { unit: 'credit', amount: res === '4k' ? 4 : 2 };
  if (engine === 'gemini') {
    return res === '4k'
      ? { unit: 'krw', amount: 420, min: 380, max: 465 }
      : { unit: 'krw', amount: 270, min: 230, max: 314 };
  }
  return gptSize(aspect).size === '1024x1024' ? { unit: 'krw', amount: 240 } : { unit: 'krw', amount: 350 };
}

export function estimateVideo(quality: string | undefined, duration: number | undefined): Cost {
  const q = VIDEO_QUALITIES[quality ?? 'draft'] ?? VIDEO_QUALITIES.draft;
  return { unit: 'credit', amount: q.perSecond * (duration ?? 5) };
}

export function estimateCell(kind: CellKind, data: CellData): Cost | null {
  if (kind === 'image') return estimateImage(data.engine ?? 'higgsfield', data.resolution, data.aspect ?? '9:16');
  if (kind === 'storyboard') {
    const engine = data.engine ?? 'higgsfield';
    const layout = sheetLayout(data.cuts ?? 15, data.aspect ?? '9:16', ENGINE_INFO[engine].aspects);
    return estimateImage(engine, data.resolution, layout.aspect);
  }
  if (kind === 'video') return estimateVideo(data.quality, data.duration);
  return null;
}

/** 캐릭터 시트 한 장의 격자. 윗줄은 전신 5칸, 아랫줄은 얼굴 5칸이다 */
export const MODEL_SHEET_GRID = { rows: 2, cols: 5 };
/** 잘린 칸에서 어느 번째가 무엇인지 */
export const SHEET_PANEL = { bodyFront: 0, faceNeutral: 5, faceSmile: 6 };

const SHEET_LAYOUT =
  '같은 사람의 모델 시트 한 장. 가로 5칸 2줄이고 칸 크기는 모두 같으며 칸 사이에 흰 여백을 둔다. ' +
  '윗줄은 머리부터 발끝까지 보이는 전신으로 정면, 왼쪽 3/4, 왼쪽 옆, 뒤, 오른쪽 3/4. ' +
  '아랫줄은 어깨 위 얼굴 클로즈업으로 무표정, 은은한 미소, 밝은 웃음, 놀람, 진지한 표정. ' +
  '모든 칸에서 얼굴, 머리 모양, 옷, 체형이 같다. 단순한 옷, 밝은 회색 배경.';

const CHARACTER_TEMPLATE = SHEET_LAYOUT;

/** 참고 사진과 닮은 정도. 엔진에는 숫자만 보내지 않고 무엇을 닮게 할지 문장으로 적는다 */
export const LIKENESS_LEVELS: { value: number; label: string; text: string }[] = [
  { value: 50, label: '50%', text: '전체 인상과 분위기만 닮게 하고, 얼굴형과 눈·코·입은 다른 사람으로 그린다.' },
  { value: 60, label: '60%', text: '인상과 얼굴형은 닮게 하되, 눈매와 코·입은 조금씩 다른 사람으로 그린다.' },
  { value: 70, label: '70%', text: '얼굴형과 눈매까지 꽤 닮게 하되, 코와 입 같은 세부 이목구비는 다른 사람으로 그린다.' },
  { value: 80, label: '80%', text: '첫인상이 거의 같아 보일 만큼 닮게 하되, 세부 이목구비는 같은 사람이 아니게 그린다.' },
];

/** 새 모델을 만드는 프롬프트. 참고 사진이 있으면 닮은 정도를 넣는다 */
export function modelSheetPrompt(person: string, refCount: number, likeness?: number): string {
  const parts: string[] = [];
  if (person) parts.push(`${person.replace(/[.\s]+$/, '')}.`);
  parts.push('실제 사람 사진처럼 자연스러운 피부 질감.');
  if (refCount > 0) {
    const level = LIKENESS_LEVELS.find((l) => l.value === likeness) ?? LIKENESS_LEVELS[1];
    const names = Array.from({ length: refCount }, (_, i) => `${i + 1}번`).join(', ');
    parts.push(`${names} 사진 사람과 생김새가 ${level.value}% 정도 닮은, 다른 가상의 인물. ${level.text}`);
  } else {
    parts.push('실존 인물을 닮지 않은 가상의 인물.');
  }
  parts.push(SHEET_LAYOUT);
  return parts.join(' ');
}
const BACKGROUND_TEMPLATE = '사람 없는 와이드 컷 배경 시트. 공간 전체가 한눈에 보이고, 빛과 시간대가 분명하다.';

export function cellTitle(kind: CellKind, preset: ImagePreset | undefined, index: number): string {
  if (kind === 'scenario') return index > 1 ? `시나리오 ${index}` : '시나리오';
  if (kind === 'storyboard') return index > 1 ? `스토리보드 ${index}` : '스토리보드';
  if (kind === 'ref') return `참조 사진 ${index}`;
  if (kind === 'shot') return `샷 ${index}`;
  if (kind === 'video') return `영상 ${index}`;
  if (preset === 'character') return `캐릭터 시트 ${index}`;
  if (preset === 'background') return `배경 시트 ${index}`;
  return `장면 ${index}`;
}

export function defaultCellData(kind: CellKind, index: number, preset?: ImagePreset): CellData {
  const title = cellTitle(kind, preset, index);
  if (kind === 'scenario') return { title, logline: '', scenario: '', total: 15 };
  if (kind === 'ref') return { title, file: null, role: 'other' };
  if (kind === 'shot') return { title, duration: 4, shot: {} };
  if (kind === 'storyboard') {
    return { title, cuts: 15, total: 15, aspect: '9:16', engine: 'higgsfield', resolution: '2k', prompt: '' };
  }
  if (kind === 'image') {
    if (preset === 'character') {
      return { title, preset, prompt: CHARACTER_TEMPLATE, engine: 'higgsfield', aspect: '3:2', resolution: '4k', sheetGrid: MODEL_SHEET_GRID };
    }
    if (preset === 'background') {
      return { title, preset, prompt: BACKGROUND_TEMPLATE, engine: 'higgsfield', aspect: '16:9', resolution: '2k' };
    }
    return { title, preset: 'scene', prompt: '', engine: 'higgsfield', aspect: '9:16', resolution: '2k' };
  }
  return { title, prompt: '', model: DEFAULT_VIDEO_MODEL, aspect: '9:16', duration: 5, quality: 'draft', shot: {} };
}

export function aspectToRatio(aspect: string | undefined): number {
  const [a, b] = String(aspect ?? '').split(':').map(Number);
  return a > 0 && b > 0 ? a / b : 9 / 16;
}

/** 샷 카드 폭. 아래에 장면과 영상이 나란히 들어간다 */
export const SHOT_CARD_WIDTH = 326;
const SHOT_CARD_HEIGHT = 300;
const COMPACT_MAX_WIDTH = 143;

/** 비율이 달라도 칸의 면적이 비슷하게 보이도록 크기를 정한다 */
export function frameSize(ratio: number, compact = false): { width: number; height: number } {
  const safe = Math.min(Math.max(ratio, 0.3), 3);
  if (compact) {
    const width = Math.min(COMPACT_MAX_WIDTH, Math.round(Math.sqrt(20000 * safe)));
    return { width, height: Math.round(width / safe) };
  }
  return { width: Math.round(Math.sqrt(90000 * safe)), height: Math.round(Math.sqrt(90000 / safe)) };
}

/** 스토리보드 칸에 깔리는 타일의 폭 */
export function boardTileWidth(aspect: string | undefined): number {
  const ratio = aspectToRatio(aspect);
  return ratio >= 1.2 ? 86 : ratio <= 0.7 ? 62 : 72;
}

export function boardCellWidth(cuts: number, aspect: string | undefined): number {
  return Math.min(5, Math.max(1, cuts)) * (boardTileWidth(aspect) + 6) - 6 + 22;
}

/**
 * 스토리보드를 샷으로 나눈다: 시트 → 샷 카드 → 장면 → 영상. 만들어 놓기만 하고 생성하지 않는다.
 * 화면의 「샷 나누기」와 예제 만들기가 같은 배치를 쓴다.
 */
export function splitBoardCells(
  board: { id: string; position: { x: number; y: number }; width: number; data: CellData },
  shots: { seconds: number }[],
  newId: (prefix: string) => string,
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const aspect = board.data.aspect ?? '9:16';
  const small = frameSize(aspectToRatio(aspect), true);
  const columns = Math.min(5, Math.max(1, shots.length));
  const startX = board.position.x + board.width + 72;
  const rowGap = SHOT_CARD_HEIGHT + 44 + small.height + 74;
  const nodes: StoredNode[] = [];
  const edges: StoredEdge[] = [];
  shots.forEach((shot, index) => {
    const no = index + 1;
    const x = startX + (index % columns) * (SHOT_CARD_WIDTH + 44);
    const y = board.position.y + Math.floor(index / columns) * rowGap;
    const cardId = newId('n_');
    const sceneId = newId('n_');
    const clipId = newId('n_');
    nodes.push(
      { id: cardId, type: 'shot', position: { x, y }, data: { title: `샷 ${no}`, boardId: board.id, shotNo: no } },
      {
        id: sceneId,
        type: 'image',
        position: { x, y: y + SHOT_CARD_HEIGHT + 44 },
        data: {
          ...defaultCellData('image', no, 'scene'),
          title: `장면 ${no}`,
          boardId: board.id,
          shotNo: no,
          compact: true,
          engine: board.data.engine ?? 'higgsfield',
          aspect,
        },
      },
      {
        id: clipId,
        type: 'video',
        position: { x: x + SHOT_CARD_WIDTH - small.width, y: y + SHOT_CARD_HEIGHT + 44 },
        data: {
          ...defaultCellData('video', no),
          title: `영상 ${no}`,
          boardId: board.id,
          shotNo: no,
          compact: true,
          aspect: aspect === '4:5' ? '3:4' : aspect,
          duration: Math.max(4, Math.min(30, Math.ceil(shot.seconds))),
        },
      },
    );
    edges.push(
      { id: newId('e_'), source: board.id, target: cardId },
      { id: newId('e_'), source: cardId, target: sceneId },
      { id: newId('e_'), source: sceneId, target: clipId },
    );
  });
  return { nodes, edges };
}

/**
 * 스토리보드 시트 한 장의 칸 배치. 샷 비율과 엔진이 받는 비율에 가장 잘 맞는 격자를 고른다.
 * 빈칸이 남는 격자는 피한다.
 */
export function sheetLayout(
  cuts: number,
  shotAspect: string,
  allowed: readonly string[],
): { rows: number; cols: number; aspect: string } {
  const n = Math.max(1, Math.round(cuts));
  const shotRatio = aspectToRatio(shotAspect);
  let best = { rows: 1, cols: n, aspect: allowed[0] };
  let bestScore = Infinity;
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    const empty = rows * cols - n;
    if (empty >= cols) continue;
    const ratio = (cols * shotRatio) / rows;
    let aspect = allowed[0];
    let mismatch = Infinity;
    for (const option of allowed) {
      const gap = Math.abs(Math.log(aspectToRatio(option) / ratio));
      if (gap < mismatch) {
        mismatch = gap;
        aspect = option;
      }
    }
    const score = mismatch + empty * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = { rows, cols, aspect };
    }
  }
  return best;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

export function formatCost(cost: Cost): string {
  if (cost.unit === 'credit') return `${formatNumber(cost.amount)}크레딧`;
  return `₩${formatNumber(Math.round(cost.amount))}`;
}

export function formatEstimate(cost: Cost): string {
  if (cost.unit === 'credit') return `예상 ${formatCost(cost)}`;
  if (cost.min != null && cost.max != null) return `약 ₩${formatNumber(cost.min)}~₩${formatNumber(cost.max)}`;
  return `약 ${formatCost(cost)}`;
}

export function computeStats(jobs: Job[]): CostStats {
  const stats: CostStats = { credits: { actual: 0, estimated: 0 }, krw: { actual: 0, estimated: 0 } };
  for (const job of jobs) {
    if (job.actual) {
      const bucket = job.actual.unit === 'credit' ? stats.credits : stats.krw;
      bucket.actual += job.actual.amount;
    } else if (job.status === 'queued' || job.status === 'running' || job.status === 'done') {
      const bucket = job.estimate.unit === 'credit' ? stats.credits : stats.krw;
      bucket.estimated += job.estimate.amount;
    }
  }
  return stats;
}

export function cellStatusOf(job: Job | undefined): CellStatus {
  if (!job || job.status === 'cancelled') return 'draft';
  return job.status;
}

export const STATUS_LABEL: Record<CellStatus, string> = {
  draft: '초안',
  queued: '대기',
  running: '생성 중',
  done: '완료',
  failed: '실패',
};

/** 샷 카드를 한 문단의 프롬프트로 합친다. 프롬프트는 샷 단위로 쓴다 */
export function composeShotText(shot: ShotFields | undefined, extra?: string): string {
  const parts: string[] = [];
  const framing = [shot?.size, shot?.angle].map((v) => v?.trim()).filter(Boolean).join(', ');
  if (framing) parts.push(framing);
  if (shot?.action?.trim()) parts.push(shot.action.trim());
  if (shot?.camera?.trim()) parts.push(`카메라: ${shot.camera.trim()}`);
  if (shot?.speed?.trim()) parts.push(shot.speed.trim());
  if (shot?.light?.trim()) parts.push(shot.light.trim());
  const text = parts.map((p) => p.replace(/[.\s]+$/, '')).join('. ');
  const joined = [text ? `${text}.` : '', extra?.trim() ?? ''].filter(Boolean).join(' ');
  return joined.trim();
}

/** 칸에 적힌 내용으로 사람이 읽는 프롬프트를 만든다 */
export function promptOf(kind: CellKind, data: CellData): string {
  if (kind === 'video') return composeShotText(data.shot, data.prompt);
  return (data.prompt ?? '').trim();
}

/** 레퍼런스 영상을 어느 정도로 따라 만들지. 남의 화면 자체는 어느 단계에서도 넘어오지 않는다 */
export const FOLLOW_LEVELS: { value: FollowLevel; label: string; takes: string; fresh: string }[] = [
  { value: 'rhythm', label: '리듬만', takes: '컷 수, 컷 길이, 긴장 곡선', fresh: '이야기 전부를 새로 써요.' },
  { value: 'structure', label: '구성까지', takes: '리듬에 더해 샷 크기, 앵글, 카메라, 장면이 바뀌는 순서', fresh: '인물, 공간, 소품을 새로 정해요.' },
  { value: 'close', label: '거의 따라가기', takes: '구성에 더해 컷마다 일어나는 일의 순서', fresh: '사람, 브랜드, 화면, 문구, 음악은 우리 것으로 바꿔요.' },
];

/** 7단계 중 끝난 단계. 캔버스 위쪽 막대와 프로젝트 목록이 같은 기준을 쓴다 */
export function computeSteps(
  nodes: { id: string; type?: string; data: CellData }[],
  isDone: (nodeId: string) => boolean,
  boards: Record<string, { shots: BoardShot[] } | undefined>,
): boolean[] {
  const clips = nodes.filter((n) => n.type === 'video' && !n.data.stage);
  const hasPrompt = (n: { data: CellData }) =>
    n.data.boardId && n.data.shotNo
      ? !!composeShotText(boards[n.data.boardId]?.shots[n.data.shotNo - 1], n.data.prompt)
      : !!promptOf('video', n.data);
  return [
    nodes.some((n) => n.type === 'scenario' && !!(n.data.logline?.trim() || n.data.scenario?.trim())),
    nodes.some((n) => (n.type === 'ref' && !!n.data.file) || (n.type === 'image' && (n.data.preset === 'character' || n.data.preset === 'background') && isDone(n.id))),
    nodes.some((n) => n.type === 'storyboard' && isDone(n.id)),
    clips.length > 0 && clips.every(hasPrompt),
    clips.length > 0 && clips.every((n) => isDone(n.id)),
    nodes.some((n) => !!n.data.stage && isDone(n.id)),
    nodes.some((n) => n.data.stage === 'final' && isDone(n.id)),
  ];
}

export function shotScenePrompt(shot: BoardShot): string {
  const framing = [shot.size, shot.angle].map((v) => v?.trim()).filter(Boolean).join(', ');
  return [framing ? `${framing}.` : '', shot.scene.trim(), shot.light?.trim() ? `${shot.light.trim().replace(/[.\s]+$/, '')}.` : '']
    .filter(Boolean)
    .join(' ');
}

/** 마지막 생성 뒤에 프롬프트나 옵션을 바꿨는지 */
export function isEditedSince(job: Job, kind: CellKind, data: CellData): boolean {
  if (promptOf(kind, data) !== job.prompt.trim()) return true;
  if (job.kind === 'image') {
    if (job.preset === 'storyboard') return (data.engine ?? 'higgsfield') !== job.engine;
    if ((data.aspect ?? '') !== job.options.aspect) return true;
    if ((data.engine ?? 'higgsfield') !== job.engine) return true;
    return (data.resolution ?? '') !== (job.options.resolution ?? data.resolution ?? '');
  }
  if ((data.aspect ?? '') !== job.options.aspect) return true;
  return data.duration !== job.options.duration || data.quality !== job.options.quality || data.model !== job.model;
}

export function secondsLabel(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const text = Number.isInteger(s) ? String(s).padStart(2, '0') : s.toFixed(1).padStart(4, '0');
  return `${m}:${text}`;
}
