import { secondsLabel } from './models.ts';
import type { BoardShot, RuleSet } from './types.ts';

/**
 * 모든 생성에 붙는 규칙. 앱에서 바로 뽑든 대화에서 뽑든 같은 문장이 들어간다.
 *
 * 로고 문장은 imgCreate 의 no-logo.ts 와 같다. 제미나이가 태그를 그리면 글자가 뭉개지거나
 * 없던 태그가 생겨서, 생성 단계에서 빼고 글자는 나중에 코드로 입히기로 정했다.
 */
export const NO_LOGO_RULE =
  'NO LOGO — MANDATORY: every product in this image is plain fabric with NO brand tag, NO sewn label, NO patch, ' +
  'NO logo, NO wordmark and NO lettering anywhere on it. If a reference photograph shows a tag or logo on a product, ' +
  'REMOVE it and render that spot as plain, continuous fabric of the same colour. ' +
  'Never draw, invent or add any logo, brand mark or tag. Keep the frame free of captions, subtitles, watermarks and any written text.';

/**
 * 기본 제작 규칙. 존코바 영상의 필수 5요소를 실사 영상에 맞게 풀어 썼다.
 * 개인 작업에도 쓰므로 특정 제품 이야기를 넣지 않는다. 요기보 제품을 쓸 때는 아래 규칙으로 바꾼다.
 */
export const DEFAULT_RULE: RuleSet = {
  style: '실사 사진처럼 자연스럽게. 실제 공간과 빛, 과장 없는 색.',
  aspect: '9:16',
  characters: '',
  camera: '샷 크기와 앵글을 컷마다 바꾼다. 같은 거리의 컷을 연달아 쓰지 않는다. 카메라 움직임은 인물의 동작과 맞춘다.',
  sound: '배경 음악은 만들지 않는다. 효과음만 넣는다.',
  product: '제품이 나오면 형태는 참조 사진을 그대로 따르고 형태 단어와 색 이름을 쓰지 않는다. 크기는 치수와 사람 키를 한 문장에 함께 적는다.',
  banned: '로고, 태그, 글자를 넣지 않는다. 빛살 무늬를 쓰지 않는다.',
  elements: [
    { key: 'tension', label: '긴장과 이완', text: '긴장을 쌓았다가 한순간에 풀어 준다.' },
    { key: 'dynamic', label: '역동적 앵글', text: '로우 앵글, 하이 앵글, 광각처럼 눈높이를 벗어난 구도를 쓴다.' },
    { key: 'weight', label: '12원칙', text: '움직임에 무게를 준다. 몸이 닿는 순간 물건이 한 박자 늦게 반응한다. 움직이기 전 예비 동작을 넣는다.' },
    { key: 'split', label: '샷 쪼개기', text: '같은 시간도 여러 컷으로 쪼개 속도감을 낸다. 클로즈업, 로우 와이드, 슬로, 클로즈업으로 이어 간다.' },
    { key: 'match', label: '매치컷', text: '앞 컷과 모양과 위치를 맞춰 장면을 넘긴다.' },
  ],
};

export const DEFAULT_RULE_ID = 'l_defaultrule';
export const YOGIBO_RULE_ID = 'l_yogiborule';

/** 요기보 제품을 쓸 때의 규칙. 12원칙은 애니메이션 기준이라 "앉을 때의 무게감"으로 바꿨다 */
export const YOGIBO_RULE: RuleSet = {
  ...DEFAULT_RULE,
  style: '실사 사진처럼 자연스럽게. 실제 집의 공간과 빛, 과장 없는 색.',
  product: '제품 형태는 참조 사진을 그대로 따르고 형태 단어와 색 이름을 쓰지 않는다. 크기는 치수와 사람 키를 한 문장에 함께 적는다. 맥스는 170 × 70cm다.',
  elements: DEFAULT_RULE.elements.map((element) => {
    if (element.key === 'tension') return { ...element, text: '긴장을 쌓았다가 한순간에 풀어 준다. 앉기 직전까지 조이고, 앉는 순간 풀린다.' };
    if (element.key === 'weight') return { ...element, text: '움직임에 무게를 준다. 앉을 때 몸이 잠기고 빈백이 한 박자 늦게 출렁인다. 움직이기 전 예비 동작을 넣는다.' };
    return element;
  }),
};

export function ruleTextFor(rule: RuleSet, kind: 'image' | 'video' | 'storyboard', must?: string[]): string {
  const lines: string[] = [];
  if (rule.style.trim()) lines.push(`화풍: ${rule.style.trim()}`);
  if (rule.characters.trim()) lines.push(`캐릭터 키워드: ${rule.characters.trim()}`);
  if (rule.product.trim()) lines.push(`제품: ${rule.product.trim()}`);
  if (kind !== 'image' && rule.camera.trim()) lines.push(`카메라 문법: ${rule.camera.trim()}`);
  const elements = kind === 'storyboard' ? rule.elements : rule.elements.filter((e) => must?.includes(e.key));
  if (kind !== 'image') for (const element of elements) lines.push(`${element.label}: ${element.text}`);
  if (kind === 'video' && rule.sound.trim()) lines.push(`소리: ${rule.sound.trim()}`);
  if (rule.banned.trim()) lines.push(`금지: ${rule.banned.trim()}`);
  return lines.join('\n');
}

export function buildFinalPrompt(prompt: string, refCount: number, extra?: { ruleText?: string; context?: string }): string {
  const parts = [prompt.trim()];
  if (extra?.context?.trim()) parts.push(`시나리오 맥락:\n${extra.context.trim()}`);
  if (refCount > 0) {
    parts.push(
      `Reference images are attached in order and numbered from 1 to ${refCount}. ` +
        'When the text above says 1번, 2번 and so on, it means that numbered image.',
    );
  }
  if (extra?.ruleText?.trim()) parts.push(`제작 규칙:\n${extra.ruleText.trim()}`);
  parts.push(NO_LOGO_RULE);
  return parts.join('\n\n');
}

/**
 * 스토리보드 시트 프롬프트.
 * 칸마다 글자를 그리게 하면 뭉개지므로 AI는 그림만 그리고, 시간·샷 크기·긴장도는 앱이 얹는다.
 * 칸을 한 장에 함께 그리면 모델이 스스로 톤과 인물을 맞춘다. 흰 여백은 나중에 칸별로 자르기 위한 것이다.
 */
export function buildStoryboardPrompt(input: {
  title: string;
  shots: BoardShot[];
  cuts: number;
  total: number;
  shotAspect: string;
  rows: number;
  cols: number;
  scenario: string;
  extra: string;
  refs: { order: number; title: string }[];
  ruleText: string;
}): string {
  const { shots, rows, cols } = input;
  const count = shots.length || input.cuts;
  let clock = 0;
  const panelLines = shots.map((shot) => {
    const from = clock;
    clock += shot.seconds;
    const framing = [shot.size, shot.angle].filter(Boolean).join(', ');
    return [
      `PANEL ${shot.no} (${secondsLabel(from)}–${secondsLabel(clock)})`,
      framing,
      shot.scene,
      shot.action ?? '',
      shot.camera ? `카메라: ${shot.camera}` : '',
    ]
      .filter(Boolean)
      .join(' — ');
  });

  return [
    `STORYBOARD SHEET for "${input.title}" — ${count} panels in ONE image, in a clean grid of ${rows} rows × ${cols} columns, ` +
      'read left to right, top to bottom, evenly divided and separated by thin white gutters.',
    `Each panel is one shot of the same ${input.total}-second film, in ${input.shotAspect} framing.`,
    input.scenario.trim() ? `SCENARIO (Korean):\n${input.scenario.trim()}` : '',
    panelLines.length ? `PANELS (Korean, draw what they describe):\n${panelLines.join('\n')}` : '',
    input.extra.trim() ? `DIRECTION (Korean):\n${input.extra.trim()}` : '',
    input.refs.length
      ? `REFERENCE IMAGES, attached in this order:\n${input.refs.map((r) => `${r.order}. ${r.title}`).join('\n')}`
      : '',
    [
      'CONSISTENCY ACROSS ALL PANELS — this is the point of drawing them together:',
      '- The same person appears wherever a person is described. Same face, same hair, same outfit in every panel.',
      '- Any product keeps the exact shape and colour of its reference photo in every panel.',
      '- Same space, same time of day, same colour grade and grain, unless the panel says otherwise.',
    ].join('\n'),
    input.ruleText.trim() ? `제작 규칙:\n${input.ruleText.trim()}` : '',
    'ABSOLUTELY NO TEXT: no panel numbers, no captions, no timecodes, no logos, no watermarks anywhere in the image. Labels are added later by the app.',
    'Leave clean white gutters between panels so the sheet can be cut apart afterwards.',
    NO_LOGO_RULE,
  ]
    .filter(Boolean)
    .join('\n\n');
}
