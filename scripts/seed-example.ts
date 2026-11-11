/**
 * 예제 프로젝트를 넣는다. 크레딧과 돈을 쓰지 않는다.
 *
 *   npm run seed:example               이미 있으면 그대로 둔다
 *   npm run seed:example -- --replace  휴지통으로 보내고 다시 만든다
 *
 * imgCreate 「맥스 + 서포트」 스토리보드의 컷 그림으로 7단계 흐름을 채워 본다.
 * 시트는 컷을 격자로 붙여 만들고, 영상 칸은 생성하지 않고 초안으로 둔다.
 * 먼저 npm run import:imgcreate 를 돌려야 한다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { boardCellWidth, splitBoardCells } from '../src/lib/models.ts';
import { YOGIBO_RULE_ID } from '../src/lib/rules.ts';
import * as store from '../src/lib/store.ts';
import type { BoardShot, CellData, Cost, FileEntry, StoredEdge, StoredNode } from '../src/lib/types.ts';

const NAME = '예제 · 맥스 + 서포트 20초';
const MODEL_ID = 'l_mwe';
const PRODUCT_TITLE = '맥스 네이비블루';
const FREE: Cost = { unit: 'credit', amount: 0 };

const dataRoot = process.env.VIDEOCREATE_DATA_DIR || path.join(process.cwd(), 'data');
const exportFile = process.env.IMGCREATE_EXPORT || path.join(dataRoot, 'import', 'imgcreate-export.json');

// 제품 형태 단어와 색 이름은 쓰지 않는다. 라벨 글자는 편집에서 코드로 입힌다
const SHOTS: BoardShot[] = [
  {
    no: 1,
    seconds: 3.2,
    size: '와이드',
    angle: '로우 앵글',
    scene: '밝은 미니멀 거실. 맥스가 러그 위에 길게 눕혀져 있고 서포트는 그 옆 바닥에 따로 놓여 있다. 여성 모델이 맥스 앞에 서서 내려다본다. 맥스는 170 × 70cm, 모델 키는 160cm라 맥스가 모델보다 길다.',
    camera: '고정. 맥스의 길이가 화면을 가로지른다',
    action: '모델이 제품을 내려다보다가 앉으려고 무릎을 굽히기 시작한다',
    speed: '일정하게 흐른다',
    light: '창가의 부드러운 아침빛',
    tension: 20,
    must: ['tension'],
  },
  {
    no: 2,
    seconds: 0.9,
    size: '클로즈업',
    angle: '아이 레벨',
    scene: '같은 거실. 여성 모델의 얼굴 클로즈업. 아래를 보며 옅게 웃는다.',
    camera: '고정. 얼굴이 화면 높이의 절반',
    action: '시선이 아래로 내려가며 표정이 풀린다',
    speed: '짧게 끊는다',
    light: '얼굴 옆으로 드는 창빛',
    tension: 35,
    must: ['split'],
  },
  {
    no: 3,
    seconds: 1.3,
    size: '와이드',
    angle: '로우 앵글',
    scene: '같은 거실 와이드. 서포트 없이 맥스에만 걸터앉아 다리를 앞으로 뻗었다.',
    camera: '고정. 1번 컷과 같은 위치',
    action: '앉으면서 맥스가 몸무게로 깊게 눌려 내려앉는다',
    speed: '앉는 순간만 조금 느리게',
    light: '창가의 부드러운 아침빛',
    tension: 45,
    must: ['weight', 'match'],
  },
  {
    no: 4,
    seconds: 0.9,
    size: '클로즈업',
    angle: '하이 앵글',
    scene: '손 클로즈업. 두 손으로 서포트를 들어 맥스의 왼쪽 끝에 얹는다.',
    camera: '손을 따라 짧게 내려가는 팬',
    action: '서포트가 맥스 위에 내려앉으며 맥스 표면이 눌려 홈이 생긴다',
    speed: '내려앉는 순간 짧게 느려진다',
    light: '옆에서 드는 빛이 원단 결을 살린다',
    tension: 55,
    must: ['split', 'weight'],
  },
  {
    no: 5,
    seconds: 1.6,
    size: '와이드',
    angle: '로우 앵글',
    scene: '같은 거실 와이드. 맥스 왼쪽 끝에 올린 서포트에 등을 기대고 앉았다.',
    camera: '고정. 1번 컷과 같은 위치',
    action: '등을 기대며 서포트가 뒤로 눌린다',
    speed: '기대는 순간 한 박자 늦게 출렁인다',
    light: '창가의 부드러운 아침빛',
    tension: 50,
    must: ['weight', 'match'],
  },
  {
    no: 6,
    seconds: 1.1,
    size: '미디엄 클로즈업',
    angle: '옆 3/4',
    scene: '상반신을 옆에서 본다. 책을 펴 무릎 위에 올리고 시선을 아래로 내린다. 얼굴이 크게 들어간다.',
    camera: '고정. 옆 3/4 각도',
    action: '책장을 넘긴다',
    speed: '일정하게 흐른다',
    light: '창빛이 책장에 닿는다',
    tension: 30,
    must: ['split'],
  },
  {
    no: 7,
    seconds: 2,
    size: '와이드',
    angle: '로우 앵글',
    scene: '같은 거실 와이드. 다리를 완전히 뻗고 서포트에 깊이 기대 누웠다. 맥스가 사람보다 길어서 발뒤꿈치 너머로 원단이 남는다.',
    camera: '고정. 앞 컷보다 조금 더 낮게',
    action: '천천히 등을 눕히며 숨을 내쉰다',
    speed: '천천히 풀어 준다',
    light: '창가의 부드러운 아침빛',
    tension: 40,
    must: ['tension', 'match'],
  },
  {
    no: 8,
    seconds: 1.3,
    size: '클로즈업',
    angle: '아이 레벨',
    scene: '디테일 클로즈업. 서포트 위에 팔을 걸치고 손이 늘어져 있다. 비즈가 꽉 찬 원단이 팔 무게로 눌려 들어간다.',
    camera: '고정. 얕은 심도',
    action: '손가락이 힘을 풀며 아래로 늘어진다',
    speed: '아주 조금 느리게',
    light: '옆빛이 원단 결을 살린다',
    tension: 25,
    must: ['weight'],
  },
  {
    no: 9,
    seconds: 4.2,
    size: '와이드',
    angle: '아이 레벨',
    scene: '같은 거실 와이드. 여성 모델과 남성 모델이 맥스 양쪽 끝에 나란히 기대앉아 각자 다른 것을 한다. 한 명은 책을 읽고 다른 한 명은 쉰다.',
    camera: '고정. 두 사람과 제품 전체가 들어가게',
    action: '두 사람이 서로를 보지 않고 편하게 자기 시간을 보낸다',
    speed: '일정하게 흐른다',
    light: '오후로 넘어가는 창빛',
    tension: 60,
    must: ['tension'],
  },
  {
    no: 10,
    seconds: 3.5,
    size: '와이드',
    angle: '아이 레벨',
    scene: '같은 거실, 사람 없이 맥스와 서포트만. 창가 빛이 원단을 스친다. 화면 위쪽에 카피를 얹을 빈 공간을 둔다.',
    camera: '고정. 아주 느린 푸시인',
    action: '빛이 원단 위로 아주 천천히 옮겨 간다',
    speed: '가장 느리게',
    light: '오후로 넘어가는 창빛',
    tension: 10,
    must: ['match'],
  },
];

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`그림을 받지 못했어요 (HTTP ${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** 컷을 흰 여백을 두고 격자로 붙인다. 생성 시트와 똑같이 잘린다 */
async function tileSheet(cuts: Buffer[], rows: number, cols: number): Promise<Buffer> {
  const cellWidth = 640;
  const cellHeight = 360;
  const gap = 12;
  const composites = await Promise.all(
    cuts.map(async (cut, index) => ({
      input: await sharp(cut).resize(cellWidth, cellHeight, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer(),
      left: (index % cols) * (cellWidth + gap),
      top: Math.floor(index / cols) * (cellHeight + gap),
    })),
  );
  return sharp({
    create: { width: cols * cellWidth + (cols - 1) * gap, height: rows * cellHeight + (rows - 1) * gap, channels: 3, background: '#ffffff' },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();
}

const cellFile = (entry: FileEntry) => ({ name: entry.name, originalName: entry.originalName, width: entry.width, height: entry.height });
const newId = (prefix: string) => `${prefix}${crypto.randomBytes(6).toString('hex')}`;

const existing = store.listProjects().filter((p) => p.name === NAME);
if (existing.length && !process.argv.includes('--replace')) {
  console.log(`이미 있어요: http://localhost:6800/p/${existing[0].id}`);
  process.exit(0);
}
for (const project of existing) store.deleteProject(project.id);

if (!fs.existsSync(exportFile)) throw new Error('내보내기 파일이 없어요. imgCreate 내보내기부터 해 주세요.');
const exported = JSON.parse(fs.readFileSync(exportFile, 'utf8')) as {
  storyboards: { title?: string; scenario?: string; shots: { image: string }[] }[];
};
const source = exported.storyboards.find((b) => b.title?.includes('맥스 + 서포트'));
if (!source) throw new Error('「맥스 + 서포트」 스토리보드를 찾지 못했어요.');

store.ensureRules();
const product = store.readProducts().find((p) => p.name === PRODUCT_TITLE);
if (!product) throw new Error(`제품 목록에 '${PRODUCT_TITLE}'이 없어요. npm run import:imgcreate 를 먼저 돌려 주세요.`);

console.log('컷 그림 10장을 받는 중…');
const cuts = await Promise.all(source.shots.map((shot) => download(shot.image)));

// 10번 컷은 사람 없는 거실이라 배경 시트로 쓴다. 자산에도 남겨 다른 프로젝트에서 쓸 수 있게 한다
const background = await store.addLibraryImage(cuts[9], '거실 배경.jpg', 'background', '밝은 미니멀 거실');

const project = store.createProject(NAME);
const canvasId = project.canvases[0].id;
store.updateProject(project.id, { ruleId: YOGIBO_RULE_ID });

const modelCopy = await store.copyModelImage(project.id, MODEL_ID, 'rep');
const productCopy = { entry: await store.addUpload(project.id, await download(product.front), `${product.name}.jpg`, 'copy') };
const backgroundCopy = await store.copyLibraryImage(project.id, background.id);

const boardData: CellData = {
  title: '스토리보드',
  cuts: SHOTS.length,
  total: 20,
  aspect: '16:9',
  engine: 'higgsfield',
  resolution: '2k',
  prompt: '',
};
const scenarioId = newId('n_');
const modelId = newId('n_');
const productId = newId('n_');
const backgroundId = newId('n_');
const boardId = newId('n_');
const COLUMN_X = 0;
const BOARD_X = 340;

const nodes: StoredNode[] = [
  {
    id: scenarioId,
    type: 'scenario',
    position: { x: COLUMN_X, y: 0 },
    data: {
      title: '시나리오',
      logline: '맥스 하나에 서포트를 얹고 자세를 바꿔 가며 바닥 소파, 리클라이너, 침대, 2인 소파로 변해 가는 20초.',
      scenario: '제품은 한 세트, 방도 하나, 바뀌는 것은 자세와 라벨뿐이다. 클로즈업과 와이드를 번갈아 네 번 잇고 마지막은 긴 와이드로 마친다. 라벨 글자는 편집에서 입힌다.',
      total: 20,
    },
  },
  {
    id: modelId,
    type: 'ref',
    position: { x: COLUMN_X, y: 196 },
    data: {
      title: '캐릭터 시트 · 여성 E',
      file: cellFile(modelCopy.entry),
      role: 'character',
      talent: { libraryId: MODEL_ID, title: modelCopy.item.title, variant: 'rep' },
    },
  },
  {
    id: productId,
    type: 'ref',
    position: { x: COLUMN_X, y: 442 },
    data: { title: '제품 시트 · 맥스', file: cellFile(productCopy.entry), role: 'product' },
  },
  {
    id: backgroundId,
    type: 'ref',
    position: { x: COLUMN_X, y: 640 },
    data: { title: '배경 시트 · 거실', file: cellFile(backgroundCopy.entry), role: 'background' },
  },
  { id: boardId, type: 'storyboard', position: { x: BOARD_X, y: 0 }, data: boardData },
];
const edges: StoredEdge[] = [scenarioId, modelId, productId, backgroundId].map((sourceId) => ({ id: newId('e_'), source: sourceId, target: boardId }));

const split = splitBoardCells(
  { id: boardId, position: { x: BOARD_X, y: 0 }, width: boardCellWidth(SHOTS.length, boardData.aspect), data: boardData },
  SHOTS,
  newId,
);
store.saveCanvas(project.id, canvasId, { nodes: [...nodes, ...split.nodes], edges: [...edges, ...split.edges], viewport: null, revision: 0 });
store.saveBoardShots(project.id, boardId, SHOTS);

// 시트. 실제로 뽑지 않았으니 0크레딧으로 넣는다
const sheetOutcome = store.createJobs(project.id, canvasId, [boardId], false);
if (sheetOutcome.errors.length) throw new Error(sheetOutcome.errors[0].message);
const sheetJob = sheetOutcome.created[0];
const sheet = await tileSheet(cuts, sheetJob.options.rows ?? 2, sheetJob.options.cols ?? 5);
await store.completeJob(project.id, sheetJob.id, { bytes: sheet, actual: FREE, model: 'imgCreate 컷을 붙인 시트' });

// 장면. imgCreate 에서 뽑아 둔 컷을 그대로 결과로 넣는다
const sceneIds = split.nodes.filter((n) => n.type === 'image').map((n) => n.id);
const sceneOutcome = store.createJobs(project.id, canvasId, sceneIds, false);
if (sceneOutcome.errors.length) throw new Error(sceneOutcome.errors[0].message);
for (const job of sceneOutcome.created) {
  const shotNo = split.nodes.find((n) => n.id === job.nodeId)?.data.shotNo as number;
  await store.completeJob(project.id, job.id, { bytes: cuts[shotNo - 1], actual: FREE, model: 'imgCreate 에서 만든 컷' });
}

console.log(`넣었어요: http://localhost:6800/p/${project.id}`);
console.log('쓴 크레딧 0. 영상 칸은 초안이라 대기열에 들어가 있지 않아요.');
