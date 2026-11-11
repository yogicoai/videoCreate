/**
 * 칸 종류. 왼쪽에서 오른쪽으로 7단계를 따라 흐른다.
 * 시나리오 → 참조·시트 → 스토리보드 → 샷 카드 → 장면 그림 → 영상 클립
 */
export type CellKind = 'scenario' | 'ref' | 'image' | 'storyboard' | 'shot' | 'video';

/** 그림을 뽑는 곳. 제미나이·GPT는 앱에서 바로, 힉스필드는 대화의 MCP로 뽑는다 */
export type EngineId = 'gemini' | 'openai' | 'higgsfield';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** 화면에 보이는 칸 상태. 생성 기록(Job)에서 계산하고 캔버스 파일에는 저장하지 않는다 */
export type CellStatus = 'draft' | 'queued' | 'running' | 'done' | 'failed';

/** 자산으로 잡는 이미지의 쓰임 */
export type AssetType = 'character' | 'product' | 'background' | 'other';

/** 그림 칸의 쓰임. 시트는 프롬프트 틀을 미리 채워 준다 */
export type ImagePreset = 'scene' | 'character' | 'background';

export type CellFile = {
  name: string;
  originalName: string;
  width: number;
  height: number;
};

/** 샷 카드. 길이·샷 크기·앵글 / 카메라 / 동작·표정 / 속도 변화 / 조명·분위기 */
export type ShotFields = {
  size?: string;
  angle?: string;
  camera?: string;
  action?: string;
  speed?: string;
  light?: string;
  /** 켠 필수 연출 요소의 key */
  must?: string[];
};

export type CellData = {
  title: string;
  /** 참조 칸의 파일 */
  file?: CellFile | null;
  /** 참조 칸의 쓰임 */
  role?: AssetType;
  /** 내 영상을 참조로 쓸 때 원본 영상 */
  video?: { libraryId: string; title: string } | null;
  /** 내 모델을 참조로 쓸 때. variant 는 어떤 시트를 쓰는지다 */
  talent?: { libraryId: string; title: string; variant: ModelVariant } | null;
  /** 스토리보드에서 나눈 칸이면 어느 스토리보드인지 */
  boardId?: string;
  /** 그림 칸의 쓰임 */
  preset?: ImagePreset;
  prompt?: string;
  /** 그림·스토리보드 칸의 엔진. 영상 칸은 항상 힉스필드 대기열이다 */
  engine?: EngineId;
  aspect?: string;
  /** 그림 칸 화질: 1k | 2k | 4k */
  resolution?: string;
  /** 영상 칸 모델 */
  model?: string;
  /** 영상 칸 길이(초) */
  duration?: number;
  /** 영상 칸 화질: draft | 720p | 1080p */
  quality?: string;
  /** 시나리오 칸 */
  logline?: string;
  scenario?: string;
  /** 시나리오·스토리보드 칸의 전체 길이(초) */
  total?: number;
  /** 스토리보드 칸의 컷 수 */
  cuts?: number;
  /** 샷 카드. 영상 칸의 프롬프트가 된다 */
  shot?: ShotFields;
  /** 스토리보드에서 나눈 칸이면 몇 번 샷인지 */
  shotNo?: number;
  /** 스토리보드에서 나눈 작은 칸 */
  compact?: boolean;
  /** 편집본(edit)이나 완성본(final)인 영상 칸. 7단계의 06·07이 이 값으로 끝난다 */
  stage?: 'edit' | 'final';
  /** 한 장에 여러 칸을 그리는 시트면 그 격자. 끝나면 앱이 칸별로 자른다 */
  sheetGrid?: { rows: number; cols: number };
};

export type StoredNode = {
  id: string;
  type: CellKind;
  position: { x: number; y: number };
  data: CellData;
};

export type StoredEdge = { id: string; source: string; target: string };

export type Viewport = { x: number; y: number; zoom: number };

export type CanvasMeta = { id: string; name: string };

export type CanvasDoc = {
  id: string;
  nodes: StoredNode[];
  edges: StoredEdge[];
  viewport: Viewport | null;
  revision: number;
  updatedAt: string;
};

export type FollowLevel = 'rhythm' | 'structure' | 'close';

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvases: CanvasMeta[];
  /** 이 프로젝트가 따르는 제작 규칙 */
  ruleId?: string;
  /** 레퍼런스 영상을 따라 만드는 프로젝트면 그 정보. 샷 표를 쓸 때 분석 결과를 읽는다 */
  reference?: { analysisId: string; level: FollowLevel; title: string };
  /** 새 모델을 만드는 프로젝트면 그 정보. 시트가 끝나면 모델로 저장한다 */
  modelDraft?: {
    title: string;
    category: string;
    identity: string;
    size: string;
    nodes: { sheet: string };
    /** 참고 사진과 닮은 정도(%) */
    likeness?: number;
    savedId?: string;
  };
};

export type Cost = {
  unit: 'credit' | 'krw';
  amount: number;
  min?: number;
  max?: number;
};

export type JobRef = {
  /** 1부터 시작하는 번호. 프롬프트에서 부르는 번호와 같다 */
  order: number;
  role: 'image_references' | 'start_image' | 'video_references';
  sourceNodeId: string;
  sourceTitle: string;
  /** 앞 칸이 생성물이면 그 Job. 올린 사진이면 null */
  sourceJobId: string | null;
  /** 올린 사진 파일. 앞 칸 생성물은 끝난 뒤 sourceJobId 로 찾는다 */
  file: string | null;
  /** 내 영상을 참조로 넘길 때 원본 영상 */
  videoLibraryId?: string;
};

export type JobResult = {
  file: string;
  kind: 'image' | 'video';
  mime: string;
  width: number;
  height: number;
  bytes: number;
};

export type JobError = { message: string; status?: number };

export type Job = {
  id: string;
  projectId: string;
  canvasId: string;
  nodeId: string;
  title: string;
  kind: 'image' | 'video';
  /** 시트면 끝난 뒤 칸별로 자른다 */
  preset?: 'storyboard' | 'sheet';
  engine: EngineId;
  model: string;
  status: JobStatus;
  /** 사람이 쓴 프롬프트 */
  prompt: string;
  /** 규칙까지 붙은 최종 프롬프트. 엔진에는 이 글이 들어간다 */
  finalPrompt: string;
  options: {
    aspect: string;
    resolution?: string;
    duration?: number;
    quality?: string;
    rows?: number;
    cols?: number;
  };
  refs: JobRef[];
  estimate: Cost;
  actual: Cost | null;
  /** 힉스필드 job id */
  externalId: string | null;
  result: JobResult | null;
  error: JobError | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CostStats = {
  credits: { actual: number; estimated: number };
  krw: { actual: number; estimated: number };
};

export type FileEntry = {
  name: string;
  originalName: string;
  /** copy 는 자산에서 가져온 사진이다. 자산 목록에 또 보이지 않게 올린 사진과 나눈다 */
  kind: 'upload' | 'copy' | 'result' | 'panel';
  mediaKind: 'image' | 'video';
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
};

/** 스토리보드의 샷 한 줄 */
export type BoardShot = ShotFields & {
  no: number;
  seconds: number;
  /** 시작 화면에 무엇이 보이는가 */
  scene: string;
  /** 긴장도 0~100 */
  tension: number;
};

export type Board = {
  shots: BoardShot[];
  /** 시트를 칸별로 자른 파일. 샷 번호 순서다 */
  panels: string[];
  sheetFile: string | null;
  updatedAt: string;
};

export type ProjectSummary = Project & {
  stats: CostStats;
  cellCount: number;
  thumb: { file: string; kind: 'image' | 'video' } | null;
  /** 7단계 중 끝난 단계 */
  steps: boolean[];
};

export type EngineStatus = {
  gemini: boolean;
  openai: boolean;
  /** 시험용 가짜 응답 모드. 켜져 있으면 실제 호출은 일어나지 않는다 */
  fake: boolean;
};

export type BalanceInfo = { credits: number; at: string } | null;

// ─── 자산 ─────────────────────────────────────────────────

export type RuleElement = { key: string; label: string; text: string };

/**
 * 제작 규칙. 어떤 시나리오를 넣어도 같은 품질 기준으로 나오게 하는 고정값이다.
 * 화풍·화면비·캐릭터 키워드·카메라 문법·필수 연출 요소.
 */
export type RuleSet = {
  style: string;
  aspect: string;
  characters: string;
  camera: string;
  sound: string;
  product: string;
  banned: string;
  elements: RuleElement[];
};

export type LibraryImage = {
  id: string;
  kind: 'image';
  type: AssetType;
  title: string;
  file: string;
  originalName: string;
  width: number;
  height: number;
  createdAt: string;
};

export type LibraryRule = {
  id: string;
  kind: 'rule';
  title: string;
  rule: RuleSet;
  createdAt: string;
  updatedAt: string;
};

export type LibraryIdea = {
  id: string;
  kind: 'idea';
  source: 'imgcreate';
  title: string;
  tag: string;
  status: string;
  logline: string;
  hook: string;
  beats: string[];
  assets: string;
  length: string;
  why: string;
  risk: string;
  images: { url: string; caption: string }[];
};

export type LibraryBoard = {
  id: string;
  kind: 'storyboard';
  source: 'imgcreate';
  title: string;
  scenario: string;
  aspect: string;
  total: number;
  sheet: string;
  shots: { no: number; seconds: number; scene: string; action: string; camera: string; image: string; title: string }[];
};

export type LibraryWork = {
  id: string;
  kind: 'work';
  source: 'imgcreate';
  title: string;
  type: string;
  aspect: string;
  seconds: string;
  /** 레퍼런스로 삼은 것 */
  reference: string;
  lessons: string[];
  frames: { file: string; caption: string }[];
};

export type LibraryVideo = {
  id: string;
  kind: 'video';
  source: 'imgcreate';
  title: string;
  /** 영상 제작물 | 레퍼런스 제작물 */
  area: 'final' | 'ideas';
  folder: string;
  project: string;
  summary: string;
  aspect: string;
  key: string;
  origin: string;
  poster: string;
  createdAt: string | null;
};

export type ModelVariant = 'rep' | 'face' | 'expr' | 'body';

/**
 * 내 모델. 포즈·의상·공간이 바뀌어도 같은 사람으로 보이게 하는 고정 인물이다.
 * 대표컷과 시트 3종, 프롬프트에 그대로 들어가는 인물 설명을 함께 가진다.
 * 주소는 원격(imgCreate)이거나 자산 파일(/api/library/files/...)이다.
 */
export type LibraryModel = {
  id: string;
  kind: 'model';
  source: 'imgcreate' | 'local';
  code: string;
  title: string;
  category: string;
  identity: string;
  identityEn: string;
  size: string;
  sizeEn: string;
  rep: string;
  sheets: { face?: string; expr?: string; body?: string };
  outfits: { code: string; desc: string; image: string }[];
  createdAt: string;
};

export type LibraryItem = LibraryImage | LibraryRule | LibraryIdea | LibraryBoard | LibraryWork | LibraryVideo | LibraryModel;

/** 화면에 보여 주는 이미지 자산. 자산에 저장한 것과 프로젝트에 올린 것을 함께 다룬다 */
export type AssetView = {
  key: string;
  name: string;
  title: string;
  type: AssetType;
  width: number;
  height: number;
  url: string;
  thumb: string;
  source: 'library' | 'project';
  projectId?: string;
  projectName?: string;
  libraryId?: string;
  createdAt: string;
};

export type LibraryResult = {
  /** 편집본이나 완성본이면 그 표시 */
  stage?: 'edit' | 'final';
  jobId: string;
  projectId: string;
  projectName: string;
  title: string;
  prompt: string;
  engine: EngineId;
  model: string;
  cost: Cost;
  costIsActual: boolean;
  externalId: string | null;
  finishedAt: string;
  result: JobResult;
};

export type LibraryView = {
  models: LibraryModel[];
  images: AssetView[];
  rules: LibraryRule[];
  ideas: LibraryIdea[];
  boards: LibraryBoard[];
  works: LibraryWork[];
  videos: LibraryVideo[];
  results: LibraryResult[];
};

// ─── 제품 목록 ────────────────────────────────────────────

/** 요기보 제품 사진 주소. 화면에 늘어놓지 않고, 대화에서 "맥스 써 줘"라고 하면 Claude가 칸으로 잇는다 */
export type ProductEntry = {
  id: string;
  name: string;
  category: string;
  line: string;
  color: string;
  front: string;
  views: Record<string, string>;
  scalePrompt: string;
};

// ─── CF 레퍼런스 ──────────────────────────────────────────

export type CfRef = {
  refId: string;
  brand: string;
  title: string;
  titleKo?: string;
  country?: string | null;
  year?: number | null;
  format?: string | null;
  lengthSec?: number | null;
  url?: string | null;
  checked?: boolean;
  thumbUrl?: string;
  concept?: string;
  hook?: string | null;
  scenes?: string[];
  basis?: string;
  frames?: string | null;
  tone?: { mood?: string[]; music?: string | null; pace?: string | null; color?: string | null };
  technique?: string[];
  evidence?: { claim: string; url?: string }[];
  why?: string;
  adapt?: string;
  products?: string[];
  make?: string;
  makeNote?: string;
  fit: number;
  themes: string[];
  /** 요즘 통하는 이유. 값이 있으면 트렌드 영상이다 */
  trend?: string | null;
  sources?: { url?: string; title?: string }[];
};

/** 고른 CF를 요기보로 풀어 본 장면 그림 */
export type CfConcept = {
  name: string;
  refId: string;
  plan: string;
  cast: string;
  scenes: { text: string; url: string; note?: string }[];
};

export type CfLibrary = { refs: CfRef[]; concepts: CfConcept[] };

// ─── 갤러리 ───────────────────────────────────────────────

export type GalleryGroup = 'project' | 'final' | 'ideas';

export type GalleryEntry = { kind: 'video'; video: LibraryVideo } | { kind: 'result'; result: LibraryResult };

/** 제작물 하나. 눌러서 들어가면 안의 결과가 묶음별로 나온다 */
export type GalleryFolder = {
  id: string;
  group: GalleryGroup;
  title: string;
  desc: string;
  /** 프로젝트에서 나온 제작물이면 그 프로젝트로 돌아갈 수 있다 */
  projectId?: string;
  count: number;
  cover: { url: string; kind: 'image' | 'video' } | null;
  sections: { title: string; entries: GalleryEntry[] }[];
};

/** 메인 화면 띠에 걸린 작업물 */
export type ShowcaseItem = {
  key: string;
  title: string;
  poster: string;
  ratio: number;
  url: string;
  kind: 'image' | 'video';
  meta: string;
  note: string;
};
