'use client';

import { NodeToolbar, Position, useReactFlow, type Edge } from '@xyflow/react';
import { ChevronDown, FolderOpen, ImageIcon, Maximize2, Minimize2, Minus, Plus, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import { fileUrl } from '@/lib/client';
import {
  ASSET_TYPE_LABEL,
  cellStatusOf,
  composeShotText,
  ENGINE_INFO,
  ENGINE_ORDER,
  estimateCell,
  formatCost,
  formatEstimate,
  formatNumber,
  gptSize,
  isEditedSince,
  SHOT_ASPECTS,
  VIDEO_MODELS,
  VIDEO_QUALITIES,
} from '@/lib/models';
import type { AssetType, BoardShot, CellData, EngineId, Job, ModelVariant, ShotFields } from '@/lib/types';
import { useEditor, type CellFlowNode } from './context';

/** 칸을 고르면 창이 화면 밖이나 막대 뒤로 들어가지 않게 캔버스를 조금 옮긴다 */
function useKeepInView(ref: RefObject<HTMLDivElement | null>, container: RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const { getViewport, setViewport } = useReactFlow();
  useEffect(() => {
    const panelEl = ref.current;
    if (!panelEl) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const panel = panelEl.getBoundingClientRect();
        const box = container.current?.getBoundingClientRect();
        if (!box) return;
        const dockOpen = !!container.current?.querySelector('[data-asset-dock]');
        const left = box.left + (dockOpen ? 284 : 16);
        const right = box.right - 16;
        const top = box.top + 86;
        const bottom = box.bottom - 76;
        let dx = 0;
        let dy = 0;
        if (panel.bottom > bottom) dy = bottom - panel.bottom;
        if (panel.top + dy < top) dy = top - panel.top;
        if (panel.right > right) dx = right - panel.right;
        if (panel.left + dx < left) dx = left - panel.left;
        if (dx || dy) {
          const vp = getViewport();
          void setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 180 });
        }
      });
    };
    fit();
    // 실패 안내처럼 내용이 늘어나도 잘리지 않게 크기 변화를 따라간다
    const observer = new ResizeObserver(fit);
    observer.observe(panelEl);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** 금액 확인이 뜬 직후의 클릭은 무시한다. 두 번 빠르게 눌러 바로 결제되는 일을 막는다 */
const CONFIRM_GUARD_MS = 500;

function failureTitle(job: Job): string {
  if (job.error?.status && job.engine === 'gemini') return `구글 응답 ${job.error.status}`;
  if (job.error?.status && job.engine === 'openai') return `OpenAI 응답 ${job.error.status}`;
  return '실패 사유';
}

function failureHint(job: Job): string {
  if (job.engine !== 'gemini') return '';
  if (job.error?.status === 402) return '선불 잔액이 없다는 뜻이에요. 구글 AI 결제 화면에서 충전해야 해요.';
  if (job.error?.status === 429) return '월 지출 한도에 걸렸거나 요청이 몰렸다는 뜻이에요.';
  return '';
}

type RefItem = { edgeId: string; node: CellFlowNode | undefined };

function RefThumbs({
  items,
  locked,
  onRemove,
  onReorder,
}: {
  items: RefItem[];
  locked: boolean;
  onRemove: (edgeId: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const editor = useEditor();
  const dragFrom = useRef<number | null>(null);
  if (!items.length) return null;

  return (
    <div className="mt-2.5 flex flex-wrap gap-2" aria-label="연결된 참조">
      {items.map(({ edgeId, node }, index) => {
        const file = node?.type === 'ref' ? node.data.file?.name : node ? editor.latestDone(node.id)?.result?.file : undefined;
        return (
          <div
            key={edgeId}
            data-ref-thumb={index + 1}
            draggable={!locked && items.length > 1}
            title={locked ? node?.data.title : `${node?.data.title} · 끌어서 순서를 바꿔요`}
            onDragStart={(e) => {
              dragFrom.current = index;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(index));
            }}
            onDragOver={(e) => {
              if (dragFrom.current !== null) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragFrom.current !== null && dragFrom.current !== index) onReorder(dragFrom.current, index);
              dragFrom.current = null;
            }}
            onDragEnd={() => {
              dragFrom.current = null;
            }}
            className="group/thumb relative h-[50px] w-[50px] flex-none rounded-lg bg-inset ring-1 ring-line"
          >
            {file ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(editor.projectId, file, 240)} alt="" draggable={false} className="h-full w-full rounded-lg object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-ink-4">
                <ImageIcon size={18} strokeWidth={1.5} />
              </span>
            )}
            <span className="absolute left-[3px] top-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-black/80 px-0.5 text-[10px] font-bold text-white">
              {index + 1}
            </span>
            {!locked ? (
              <button
                type="button"
                aria-label={`${index + 1}번 참조 빼기`}
                onClick={() => onRemove(edgeId)}
                className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 opacity-0 transition-opacity hover:text-bad focus-visible:opacity-100 group-hover/thumb:opacity-100"
              >
                <X size={11} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-3">
      {label}
      {children}
    </label>
  );
}

/** 제작 규칙 표시. 눌러서 프로젝트의 규칙을 바꾼다 */
function RuleChip() {
  const editor = useEditor();
  if (!editor.rule) return null;
  return (
    <label className="chip relative !pr-6" aria-pressed="true" data-rule-chip title="이 프로젝트의 제작 규칙. 생성할 때 프롬프트에 함께 들어가요">
      {editor.rule.title} 규칙
      <ChevronDown size={12} className="absolute right-1.5" />
      <select
        aria-label="제작 규칙"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={editor.rule.id}
        onChange={(e) => editor.setRule(e.target.value)}
      >
        {editor.rules.map((rule) => (
          <option key={rule.id} value={rule.id}>
            {rule.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function PanelHead({
  title,
  locked,
  onAddRef,
  expanded,
  onExpand,
}: {
  title: string;
  locked: boolean;
  onAddRef: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="chip" disabled={locked} onClick={onAddRef}>
        <Plus size={13} strokeWidth={2.2} />
        참고
      </button>
      <RuleChip />
      <span className="min-w-0 truncate text-[12px] text-ink-3">{title}</span>
      <button type="button" className="icon-btn ml-auto h-7 w-7 flex-none" aria-label={expanded ? '창 줄이기' : '창 크게 펼치기'} onClick={onExpand}>
        {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}

function EngineSeg({ engine, locked, onChoose }: { engine: EngineId; locked: boolean; onChoose: (engine: EngineId) => void }) {
  return (
    <div className="mt-2 grid grid-cols-[1fr_1fr_1.3fr] gap-0.5 rounded-[10px] border border-line bg-inset p-0.5" role="group" aria-label="엔진">
      {ENGINE_ORDER.map((option) => {
        const active = engine === option;
        return (
          <button
            key={option}
            type="button"
            disabled={locked}
            aria-pressed={active}
            onClick={() => onChoose(option)}
            className={`h-7 rounded-[7px] text-[12px] font-medium transition-colors ${
              active ? 'bg-fill font-semibold text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {ENGINE_INFO[option].label}
          </button>
        );
      })}
    </div>
  );
}

function aspectForGpt(aspect: string | undefined): string {
  const size = gptSize(aspect ?? '1:1');
  return size.width > size.height ? '3:2' : size.width < size.height ? '2:3' : '1:1';
}

/** 아래쪽: 상태 안내와 생성 버튼 */
function GenerateFoot({
  nodeId,
  job,
  estimate,
  direct,
  disabled,
  disabledTitle,
  idleLabel,
  balanceNote,
}: {
  nodeId: string;
  job: Job | undefined;
  estimate: ReturnType<typeof estimateCell>;
  direct: boolean;
  disabled: boolean;
  disabledTitle?: string;
  idleLabel: string;
  balanceNote?: string;
}) {
  const editor = useEditor();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmShownAt = useRef(0);
  const status = cellStatusOf(job);

  const generate = async () => {
    if (direct && !confirming) {
      confirmShownAt.current = Date.now();
      setConfirming(true);
      return;
    }
    if (direct && Date.now() - confirmShownAt.current < CONFIRM_GUARD_MS) return;
    setBusy(true);
    try {
      await editor.queueNodes([nodeId], direct);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2.5 flex min-h-[34px] items-center gap-2">
      {status === 'queued' && job ? (
        <Fragment key="queued">
          <p className="min-w-0 flex-1 text-[12px] leading-[1.45] text-ink-2">
            {ENGINE_INFO[job.engine].direct ? '앞 칸이 끝나면 바로 생성돼요.' : '대화에서 “돌려줘”라고 하면 장수·크레딧·잔액을 먼저 알려 드려요.'}
          </p>
          <button type="button" className="btn btn-line flex-none" onClick={() => void editor.cancelJob(job.id)}>
            대기 취소
          </button>
        </Fragment>
      ) : status === 'running' && job ? (
        <p className="text-[12px] text-ink-2">{ENGINE_INFO[job.engine].direct ? '생성하고 있어요. 보통 1분 안팎 걸려요.' : '대화에서 생성하고 있어요.'}</p>
      ) : confirming && estimate ? (
        <Fragment key="confirm">
          <p className="min-w-0 flex-1 text-[12px] font-medium leading-[1.45] text-ink">{formatEstimate(estimate)}이 바로 결제돼요.</p>
          <button type="button" className="btn btn-line flex-none" onClick={() => setConfirming(false)}>
            취소
          </button>
          <button type="button" className="btn btn-primary flex-none" disabled={busy} onClick={() => void generate()}>
            생성
          </button>
        </Fragment>
      ) : (
        <Fragment key="idle">
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
            {estimate ? formatEstimate(estimate) : ''}
            {balanceNote ? ` · ${balanceNote}` : ''}
          </p>
          <button type="button" className="btn btn-primary flex-none" disabled={busy || disabled} title={disabled ? disabledTitle : undefined} onClick={() => void generate()}>
            {idleLabel}
          </button>
        </Fragment>
      )}
    </div>
  );
}

function FailureBox({ job }: { job: Job }) {
  return (
    <div className="mt-2 rounded-lg bg-bad-soft px-2.5 py-2 text-[12px] leading-[1.5]">
      <p className="font-semibold text-bad">{failureTitle(job)}</p>
      <p className="mt-0.5 break-words text-ink-2">{job.error?.message}</p>
      {failureHint(job) ? <p className="mt-0.5 text-ink-2">{failureHint(job)}</p> : null}
    </div>
  );
}

function refItemsOf(id: string, nodes: CellFlowNode[], edges: Edge[]): RefItem[] {
  return edges
    .filter((edge) => edge.target === id)
    .map((edge) => ({ edgeId: edge.id, node: nodes.find((n) => n.id === edge.source) }))
    .filter((item) => item.node?.type !== 'scenario' && item.node?.type !== 'shot' && item.node?.type !== 'storyboard');
}

type PanelProps = {
  node: CellFlowNode;
  nodes: CellFlowNode[];
  edges: Edge[];
  container: RefObject<HTMLDivElement | null>;
  onRemoveEdge: (edgeId: string) => void;
  onReorderRefs: (targetId: string, from: number, to: number) => void;
};

const panelClass = (wide: boolean) =>
  `floating thin-scroll nodrag nopan nowheel max-h-[calc(100vh-176px)] overflow-y-auto p-3 ${wide ? 'w-[640px]' : 'w-[470px]'}`;

const taClass =
  'thin-scroll mt-2.5 w-full resize-none rounded-[10px] border border-line bg-inset px-3 py-2 text-[13px] leading-[1.55] text-ink placeholder:text-ink-3 focus:border-[#818cf8] focus:outline-none disabled:text-ink-2';

// ─── 그림 · 영상 칸 ────────────────────────────────────────

export function PromptPanel({ node, nodes, edges, container, onRemoveEdge, onReorderRefs }: PanelProps) {
  const editor = useEditor();
  const { updateNodeData } = useReactFlow();
  const { id, type: kind, data } = node;
  // 입력창은 자기 상태를 먼저 고친다. 캔버스 상태는 한 박자 늦게 반영되어, 바로 묶으면 한글 조합이 깨진다
  const [prompt, setPrompt] = useState(data.prompt ?? '');
  const [shot, setShot] = useState<ShotFields>(data.shot ?? {});
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInView(panelRef, container, [id]);

  const job = editor.latestJob(id);
  const status = cellStatusOf(job);
  const locked = status === 'queued' || status === 'running';
  const isVideo = kind === 'video';
  const engine: EngineId = isVideo ? 'higgsfield' : data.engine ?? 'higgsfield';
  const direct = ENGINE_INFO[engine].direct;
  const available = !direct || editor.engines[engine as 'gemini' | 'openai'];
  const estimate = estimateCell(kind as 'image' | 'video', data);
  const fromBoard = !!(data.boardId && data.shotNo);
  const boardShot = fromBoard ? editor.board(data.boardId as string)?.shots[(data.shotNo as number) - 1] : undefined;
  const linkedShotNode = edges
    .filter((edge) => edge.target === id)
    .map((edge) => nodes.find((n) => n.id === edge.source))
    .find((n) => n?.type === 'shot');
  const shotFromCard = boardShot ?? linkedShotNode?.data.shot;
  const finalText = isVideo ? composeShotText(shotFromCard ?? shot, prompt) : prompt.trim() || (boardShot ? boardShot.scene : '');
  const edited = !!job && job.status === 'done' && isEditedSince(job, kind as 'image' | 'video', { ...data, prompt, shot: shotFromCard ?? shot });

  const refs = refItemsOf(id, nodes, edges);

  const update = (patch: Partial<CellData>) => updateNodeData(id, patch);

  const setShotField = (patch: Partial<ShotFields>) => {
    const next = { ...shot, ...patch };
    setShot(next);
    updateNodeData(id, { shot: next });
  };

  const chooseEngine = (next: EngineId) => {
    const patch: Partial<CellData> = { engine: next };
    if (!ENGINE_INFO[next].aspects.includes(data.aspect ?? '')) patch.aspect = aspectForGpt(data.aspect);
    update(patch);
  };

  const redo = status === 'done' || status === 'failed';
  const idleLabel = direct
    ? `${redo ? '다시 ' : ''}바로 생성${estimate ? ` · ${estimate.min != null ? `약 ₩${estimate.amount}` : `약 ${formatCost(estimate)}`}` : ''}`
    : `${redo ? '다시 ' : ''}생성 대기열`;

  const elements = editor.rule?.rule.elements ?? [];

  // 편집본과 완성본은 다시 생성하는 칸이 아니다. 완성 등록만 다룬다
  if (data.stage) {
    const isFinal = data.stage === 'final';
    return (
      <NodeToolbar nodeId={id} isVisible position={Position.Bottom} offset={10}>
        <div ref={panelRef} data-prompt-panel={id} className={panelClass(false)} onMouseDown={(e) => e.stopPropagation()}>
          <p className="text-[13px] font-semibold">{isFinal ? '완성본이에요' : '편집본이에요'}</p>
          <p className="mt-1 text-[12.5px] leading-[1.55] text-ink-2">
            {isFinal
              ? '갤러리의 이 프로젝트 맨 위에 보여요. 메인 화면에 걸고 싶으면 갤러리에서 별을 누르세요.'
              : '마음에 들면 완성으로 등록해요. 공개할 영상은 등록 전에 업스케일하면 좋아요. 대화에서 말씀하시면 크레딧을 먼저 알려 드려요.'}
          </p>
          <div className="mt-3 flex justify-end">
            {isFinal ? (
              <button type="button" className="btn btn-line" onClick={() => editor.setStage(id, 'edit')}>
                완성 등록 풀기
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={status !== 'done'} onClick={() => editor.setStage(id, 'final')}>
                완성으로 등록
              </button>
            )}
          </div>
        </div>
      </NodeToolbar>
    );
  }

  return (
    <NodeToolbar nodeId={id} isVisible position={Position.Bottom} offset={10}>
      <div ref={panelRef} data-prompt-panel={id} className={panelClass(expanded)} onMouseDown={(e) => e.stopPropagation()}>
        <PanelHead
          title={data.title}
          locked={locked}
          onAddRef={() => editor.openPicker({ mode: 'connect', targetId: id })}
          expanded={expanded}
          onExpand={() => setExpanded((v) => !v)}
        />

        <RefThumbs items={refs} locked={locked} onRemove={onRemoveEdge} onReorder={(from, to) => onReorderRefs(id, from, to)} />

        {isVideo && !shotFromCard ? (
          <div className="mt-2.5 grid gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <input disabled={locked} aria-label="샷 크기" placeholder="샷 크기 (클로즈업)" value={shot.size ?? ''} onChange={(e) => setShotField({ size: e.target.value })} className="field" />
              <input disabled={locked} aria-label="앵글" placeholder="앵글 (로우 앵글)" value={shot.angle ?? ''} onChange={(e) => setShotField({ angle: e.target.value })} className="field" />
            </div>
            <input disabled={locked} aria-label="카메라 움직임" placeholder="카메라 움직임" value={shot.camera ?? ''} onChange={(e) => setShotField({ camera: e.target.value })} className="field" />
            <input disabled={locked} aria-label="동작과 표정" placeholder="동작 · 표정" value={shot.action ?? ''} onChange={(e) => setShotField({ action: e.target.value })} className="field" />
            <div className="grid grid-cols-2 gap-1.5">
              <input disabled={locked} aria-label="속도 변화" placeholder="속도 변화" value={shot.speed ?? ''} onChange={(e) => setShotField({ speed: e.target.value })} className="field" />
              <input disabled={locked} aria-label="조명과 분위기" placeholder="조명 · 분위기" value={shot.light ?? ''} onChange={(e) => setShotField({ light: e.target.value })} className="field" />
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1" role="group" aria-label="필수 연출 요소">
              {elements.map((element) => {
                const on = (shot.must ?? []).includes(element.key);
                return (
                  <button
                    key={element.key}
                    type="button"
                    disabled={locked}
                    title={element.text}
                    aria-pressed={on}
                    onClick={() => setShotField({ must: on ? (shot.must ?? []).filter((m) => m !== element.key) : [...(shot.must ?? []), element.key] })}
                    className="chip !px-2 !py-[3px] !text-[11px]"
                  >
                    {element.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {isVideo && shotFromCard ? (
          <p className="mt-2.5 rounded-[10px] bg-inset px-3 py-2 text-[12px] leading-[1.55] text-ink-2">
            <b className="font-semibold text-ink">샷 카드 내용으로 만들어요.</b> {finalText || '샷 카드를 채워 주세요.'}
          </p>
        ) : null}

        <textarea
          value={prompt}
          disabled={locked}
          aria-label="프롬프트"
          rows={expanded ? 10 : isVideo ? 2 : 4}
          placeholder={
            isVideo
              ? '더 넣을 지시가 있으면 적어 주세요.'
              : boardShot
                ? `비워 두면 샷 내용으로 뽑아요: ${boardShot.scene}`
                : refs.length
                  ? '어떤 장면인가요? 참조는 1번, 2번으로 부를 수 있어요.'
                  : '어떤 장면인가요? 왼쪽 + 로 참조를 이을 수 있어요.'
          }
          onChange={(e) => {
            setPrompt(e.target.value);
            updateNodeData(id, { prompt: e.target.value });
          }}
          className={taClass}
        />

        {!isVideo ? <EngineSeg engine={engine} locked={locked} onChoose={chooseEngine} /> : null}

        {!isVideo ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Labeled label="비율">
              <select className="field" disabled={locked} value={data.aspect ?? '9:16'} onChange={(e) => update({ aspect: e.target.value })}>
                {ENGINE_INFO[engine].aspects.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Labeled>
            {ENGINE_INFO[engine].resolutions.length ? (
              <Labeled label="화질">
                <select className="field" disabled={locked} value={data.resolution ?? '2k'} onChange={(e) => update({ resolution: e.target.value })}>
                  {ENGINE_INFO[engine].resolutions.map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Labeled>
            ) : (
              <Labeled label="크기">
                <span className="field flex items-center text-ink-2">
                  {gptSize(data.aspect ?? '1:1').width} × {gptSize(data.aspect ?? '1:1').height}
                </span>
              </Labeled>
            )}
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Labeled label="모델">
              <select className="field" disabled={locked} value={data.model} onChange={(e) => update({ model: e.target.value })}>
                {Object.entries(VIDEO_MODELS).map(([value, model]) => (
                  <option key={value} value={value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="길이">
              <DurationField
                value={data.duration ?? 5}
                min={VIDEO_MODELS[data.model ?? '']?.minDuration ?? 4}
                max={VIDEO_MODELS[data.model ?? '']?.maxDuration ?? 30}
                disabled={locked}
                onChange={(duration) => update({ duration })}
              />
            </Labeled>
            <Labeled label="화질">
              <select className="field" disabled={locked} value={data.quality ?? 'draft'} onChange={(e) => update({ quality: e.target.value })}>
                {Object.entries(VIDEO_QUALITIES).map(([value, quality]) => (
                  <option key={value} value={value}>
                    {quality.label} · 초당 {quality.perSecond}크레딧
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="비율">
              <select className="field" disabled={locked} value={data.aspect ?? '9:16'} onChange={(e) => update({ aspect: e.target.value })}>
                {(VIDEO_MODELS[data.model ?? '']?.aspects ?? ['9:16']).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Labeled>
          </div>
        )}

        {engine === 'openai' && !locked ? (
          <p className="mt-2 flex gap-1.5 rounded-lg bg-wait-soft px-2.5 py-2 text-[12px] leading-[1.5] text-wait">
            <TriangleAlert size={14} className="mt-px flex-none" />
            GPT는 얼굴이 바뀌거나 맥스·라운저를 다른 의자로 그린 적이 있어요. 얼굴이나 제품이 나오는 컷이면 제미나이나 힉스필드를 쓰세요.
          </p>
        ) : null}

        {direct && !available ? (
          <p className="mt-2 rounded-lg bg-bad-soft px-2.5 py-2 text-[12px] text-bad">{ENGINE_INFO[engine].label} 키가 없어요. .env.local 을 확인해 주세요.</p>
        ) : null}

        {status === 'failed' && job?.error ? <FailureBox job={job} /> : null}

        {status === 'done' && job ? (
          <p className="mt-2 text-[12px] leading-[1.5] text-ink-3">
            {job.actual ? `실제 ${formatCost(job.actual)}` : `추정 ${formatCost(job.estimate)}`}
            {job.externalId ? ` · job ${job.externalId.slice(0, 8)}` : ''}
            {edited ? ' · 이 결과 뒤에 내용을 고쳤어요' : ''}
          </p>
        ) : null}

        {status === 'done' && job?.result?.kind === 'image' ? <SaveAssetRow fileName={job.result.file} title={data.title} preset={data.preset} /> : null}

        <GenerateFoot
          nodeId={id}
          job={job}
          estimate={estimate}
          direct={direct}
          disabled={!available || !finalText.trim()}
          disabledTitle="프롬프트를 먼저 적어 주세요"
          idleLabel={idleLabel}
        />
      </div>
    </NodeToolbar>
  );
}

function SaveAssetRow({ fileName, title, preset }: { fileName: string; title: string; preset?: string }) {
  const editor = useEditor();
  const [type, setType] = useState<AssetType>(preset === 'background' ? 'background' : preset === 'character' ? 'character' : 'other');
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3">
      자산으로 저장
      <select aria-label="자산 종류" className="field h-7 px-1.5 text-[12px]" value={type} onChange={(e) => setType(e.target.value as AssetType)}>
        {(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((value) => (
          <option key={value} value={value}>
            {ASSET_TYPE_LABEL[value]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-line h-7 px-2 text-[12px]"
        disabled={saved}
        onClick={() => {
          void editor.saveAsset(fileName, title, type).then(() => setSaved(true));
        }}
      >
        {saved ? '저장했어요' : '저장'}
      </button>
    </div>
  );
}

// ─── 시나리오 칸 ──────────────────────────────────────────

export function ScenarioPanel({ node, container }: { node: CellFlowNode; container: RefObject<HTMLDivElement | null> }) {
  const { updateNodeData } = useReactFlow();
  const { id, data } = node;
  const [logline, setLogline] = useState(data.logline ?? '');
  const [scenario, setScenario] = useState(data.scenario ?? '');
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInView(panelRef, container, [id]);
  return (
    <NodeToolbar nodeId={id} isVisible position={Position.Bottom} offset={10}>
      <div ref={panelRef} data-prompt-panel={id} className={panelClass(false)} onMouseDown={(e) => e.stopPropagation()}>
        <Labeled label="로그라인. 영상의 메시지를 한두 줄로">
          <textarea
            aria-label="로그라인"
            rows={2}
            value={logline}
            placeholder="트리 불빛이 켜진 저녁 거실, 커다란 맥스를 끌어안고 들어온 사람이 책을 펴 읽는다."
            onChange={(e) => {
              setLogline(e.target.value);
              updateNodeData(id, { logline: e.target.value });
            }}
            className={`${taClass} !mt-0`}
          />
        </Labeled>
        <div className="mt-2">
          <Labeled label="시나리오">
            <textarea
              aria-label="시나리오"
              rows={6}
              value={scenario}
              placeholder="장면의 흐름을 적어 주세요. 대화에서 “샷 나눠줘”라고 하면 이 글을 읽고 샷 표를 채워요."
              onChange={(e) => {
                setScenario(e.target.value);
                updateNodeData(id, { scenario: e.target.value });
              }}
              className={`${taClass} !mt-0`}
            />
          </Labeled>
        </div>
        <div className="mt-2 w-[120px]">
          <Labeled label="전체 길이">
            <DurationField value={data.total ?? 15} min={4} max={180} disabled={false} onChange={(total) => updateNodeData(id, { total })} />
          </Labeled>
        </div>
      </div>
    </NodeToolbar>
  );
}

// ─── 스토리보드 칸 ────────────────────────────────────────

const newShot = (no: number): BoardShot => ({ no, seconds: 1, scene: '', tension: 30, must: [] });

export function StoryboardPanel({ node, nodes, edges, container, onRemoveEdge, onReorderRefs }: PanelProps) {
  const editor = useEditor();
  const { updateNodeData } = useReactFlow();
  const { id, data } = node;
  const [prompt, setPrompt] = useState(data.prompt ?? '');
  const [expanded, setExpanded] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInView(panelRef, container, [id]);

  const job = editor.latestJob(id);
  const done = editor.latestDone(id);
  const status = cellStatusOf(job);
  const locked = status === 'queued' || status === 'running';
  const engine: EngineId = data.engine ?? 'higgsfield';
  const direct = ENGINE_INFO[engine].direct;
  const available = !direct || editor.engines[engine as 'gemini' | 'openai'];
  const estimate = estimateCell('storyboard', data);
  const board = editor.board(id);
  const shots = board?.shots ?? [];
  const total = shots.reduce((sum, s) => sum + s.seconds, 0);
  const refs = refItemsOf(id, nodes, edges);
  const hasContent = shots.length > 0 || !!prompt.trim();

  const patchShot = (index: number, patch: Partial<BoardShot>) => {
    editor.setShots(id, shots.map((shot, i) => (i === index ? { ...shot, ...patch } : shot)));
  };

  const redo = status === 'done' || status === 'failed';
  const idleLabel = direct
    ? `${redo ? '다시 ' : ''}바로 생성${estimate ? ` · ${estimate.min != null ? `약 ₩${estimate.amount}` : `약 ${formatCost(estimate)}`}` : ''}`
    : `${redo ? '시트 다시 뽑기' : '스토리보드 대기열'}`;

  const balance = editor.balance ? `잔액 ${formatNumber(Math.floor(editor.balance.credits))}` : undefined;
  const boardReady = !!done && (board?.panels.length ?? 0) > 0;
  const split = editor.hasShots(id);

  return (
    <NodeToolbar nodeId={id} isVisible position={Position.Bottom} offset={10}>
      <div ref={panelRef} data-prompt-panel={id} className={panelClass(expanded)} onMouseDown={(e) => e.stopPropagation()}>
        <PanelHead
          title=""
          locked={locked}
          onAddRef={() => editor.openPicker({ mode: 'connect', targetId: id })}
          expanded={expanded}
          onExpand={() => setExpanded((v) => !v)}
        />
        <RefThumbs items={refs} locked={locked} onRemove={onRemoveEdge} onReorder={(from, to) => onReorderRefs(id, from, to)} />

        <textarea
          value={prompt}
          disabled={locked}
          aria-label="프롬프트"
          rows={expanded ? 6 : 3}
          placeholder="시트 전체에 줄 지시가 있으면 적어 주세요. 칸은 샷 표대로 그려요."
          onChange={(e) => {
            setPrompt(e.target.value);
            updateNodeData(id, { prompt: e.target.value });
          }}
          className={taClass}
        />

        <div className="mt-2 rounded-[10px] border border-line">
          <button
            type="button"
            aria-expanded={tableOpen}
            onClick={() => setTableOpen((v) => !v)}
            className="flex h-8 w-full items-center gap-1.5 px-2.5 text-[12px] font-medium text-ink-2 hover:text-ink"
          >
            <ChevronDown size={13} className={`transition-transform ${tableOpen ? '' : '-rotate-90'}`} />
            샷 표 {shots.length}줄
            {shots.length ? <span className="text-ink-3">· 합계 {formatNumber(total)}초</span> : null}
            {!shots.length ? <span className="ml-auto text-ink-3">대화에서 “샷 나눠줘”라고 하면 채워요</span> : null}
          </button>
          {tableOpen ? (
            <div className="thin-scroll max-h-[260px] overflow-y-auto border-t border-line p-2">
              {shots.map((shot, index) => (
                <div key={index} className="mb-2 grid grid-cols-[20px_52px_1fr_1fr_24px] items-center gap-1.5 last:mb-0" data-shot-row={index + 1}>
                  <span className="text-center text-[11px] font-semibold text-ink-3">{index + 1}</span>
                  <input
                    aria-label={`${index + 1}번 샷 길이`}
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={shot.seconds}
                    disabled={locked}
                    onChange={(e) => patchShot(index, { seconds: Number(e.target.value) || 1 })}
                    className="field h-7 px-1.5 text-[12px]"
                  />
                  <input
                    aria-label={`${index + 1}번 샷 크기`}
                    value={shot.size ?? ''}
                    placeholder="샷 크기"
                    disabled={locked}
                    onChange={(e) => patchShot(index, { size: e.target.value })}
                    className="field h-7 px-1.5 text-[12px]"
                  />
                  <input
                    aria-label={`${index + 1}번 앵글`}
                    value={shot.angle ?? ''}
                    placeholder="앵글"
                    disabled={locked}
                    onChange={(e) => patchShot(index, { angle: e.target.value })}
                    className="field h-7 px-1.5 text-[12px]"
                  />
                  <button
                    type="button"
                    aria-label={`${index + 1}번 샷 지우기`}
                    disabled={locked}
                    className="icon-btn h-6 w-6"
                    onClick={() => editor.setShots(id, shots.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={12} />
                  </button>
                  <span />
                  <input
                    aria-label={`${index + 1}번 긴장도`}
                    title="긴장도"
                    type="range"
                    min={0}
                    max={100}
                    value={shot.tension}
                    disabled={locked}
                    onChange={(e) => patchShot(index, { tension: Number(e.target.value) })}
                    className="tension-input"
                  />
                  <textarea
                    aria-label={`${index + 1}번 장면`}
                    value={shot.scene}
                    rows={2}
                    placeholder="시작 화면에 무엇이 보이나요"
                    disabled={locked}
                    onChange={(e) => patchShot(index, { scene: e.target.value })}
                    className="field col-span-2 h-auto resize-none py-1 text-[12px] leading-[1.45]"
                  />
                </div>
              ))}
              <button
                type="button"
                className="chip mt-1"
                disabled={locked}
                onClick={() => editor.setShots(id, [...shots, newShot(shots.length + 1)])}
              >
                <Plus size={12} />줄 추가
              </button>
            </div>
          ) : null}
        </div>

        <EngineSeg
          engine={engine}
          locked={locked}
          onChoose={(next) => updateNodeData(id, { engine: next })}
        />

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <label className="field flex items-center justify-between gap-1 text-[12px] text-ink-3">
            컷
            <input
              aria-label="컷 수"
              type="number"
              min={1}
              max={60}
              disabled={locked || shots.length > 0}
              value={shots.length || data.cuts || 15}
              onChange={(e) => updateNodeData(id, { cuts: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
              className="w-10 bg-transparent text-right font-semibold text-ink outline-none disabled:text-ink"
            />
          </label>
          <label className="field flex items-center justify-between gap-1 text-[12px] text-ink-3">
            길이
            <span className="flex items-center font-semibold text-ink">
              <input
                aria-label="전체 길이(초)"
                type="number"
                min={1}
                max={180}
                disabled={locked}
                value={data.total ?? 15}
                onChange={(e) => updateNodeData(id, { total: Math.max(1, Number(e.target.value) || 1) })}
                className="w-9 bg-transparent text-right outline-none"
              />
              초
            </span>
          </label>
          <label className="field flex items-center justify-between gap-1 text-[12px] text-ink-3">
            비율
            <select
              aria-label="샷 비율"
              disabled={locked}
              value={data.aspect ?? '9:16'}
              onChange={(e) => updateNodeData(id, { aspect: e.target.value })}
              className="bg-transparent text-right font-semibold text-ink outline-none"
            >
              {SHOT_ASPECTS.map((aspect) => (
                <option key={aspect} value={aspect}>
                  {aspect}
                </option>
              ))}
            </select>
          </label>
        </div>

        {engine === 'openai' && !locked ? (
          <p className="mt-2 flex gap-1.5 rounded-lg bg-wait-soft px-2.5 py-2 text-[12px] leading-[1.5] text-wait">
            <TriangleAlert size={14} className="mt-px flex-none" />
            GPT는 얼굴이 바뀌거나 맥스·라운저를 다른 의자로 그린 적이 있어요. 흐름만 확인하는 시트에 쓰고, 최종 장면은 제미나이나 힉스필드를 쓰세요.
          </p>
        ) : null}

        {status === 'failed' && job?.error ? <FailureBox job={job} /> : null}

        {boardReady ? (
          <div className="mt-2.5 flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[12px] leading-[1.45] text-ink-2">
              {job?.actual ? `실제 ${formatCost(job.actual)}` : ''} 컷 순서와 리듬을 확인한 뒤 샷으로 나눠요. 나누는 건 무료예요.
            </p>
            <button type="button" className="btn btn-primary flex-none" onClick={() => (split ? editor.focusShots(id) : editor.splitBoard(id))}>
              {split ? '샷 카드로 가기' : '이 시트로 샷 나누기'}
            </button>
          </div>
        ) : null}

        <GenerateFoot
          nodeId={id}
          job={job}
          estimate={estimate}
          direct={direct}
          disabled={!available || !hasContent}
          disabledTitle="샷 표를 채우거나 지시를 적어 주세요"
          idleLabel={idleLabel}
          balanceNote={balance}
        />
      </div>
    </NodeToolbar>
  );
}

function DurationField({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  const commit = (next: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(next) || min));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <span className="field flex items-center justify-between px-0.5">
      <button
        type="button"
        className="icon-btn h-6 w-6"
        aria-label="1초 줄이기"
        disabled={disabled || value <= min}
        onClick={(e) => {
          e.preventDefault();
          commit(value - 1);
        }}
      >
        <Minus size={13} />
      </button>
      <span className="flex items-center gap-0.5 text-ink">
        <input
          value={text}
          disabled={disabled}
          inputMode="numeric"
          aria-label="길이(초)"
          onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => commit(Number(text))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(Number(text));
          }}
          className="w-7 bg-transparent text-right outline-none"
        />
        초
      </span>
      <button
        type="button"
        className="icon-btn h-6 w-6"
        aria-label="1초 늘리기"
        disabled={disabled || value >= max}
        onClick={(e) => {
          e.preventDefault();
          commit(value + 1);
        }}
      >
        <Plus size={13} />
      </button>
    </span>
  );
}

// ─── 참조 사진 칸 ─────────────────────────────────────────

const VARIANTS: { value: ModelVariant; label: string }[] = [
  { value: 'rep', label: '대표컷' },
  { value: 'face', label: '얼굴 시트' },
  { value: 'expr', label: '표정 시트' },
  { value: 'body', label: '몸 시트' },
];

/** 참조 사진 칸을 골랐을 때 뜨는 작은 창 */
export function RefPanel({ node, container }: { node: CellFlowNode; container: RefObject<HTMLDivElement | null> }) {
  const editor = useEditor();
  const { updateNodeData } = useReactFlow();
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInView(panelRef, container, [node.id]);
  const has = !!node.data.file;
  const talent = node.data.talent;
  return (
    <NodeToolbar nodeId={node.id} isVisible position={Position.Bottom} offset={10}>
      <div
        ref={panelRef}
        data-prompt-panel={node.id}
        className="floating nodrag nopan nowheel flex max-w-[470px] flex-col gap-2 p-2.5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {talent ? (
          <>
            <div className="flex flex-wrap gap-1" role="group" aria-label="모델 시트 고르기">
              {VARIANTS.map((variant) => (
                <button
                  key={variant.value}
                  type="button"
                  className="chip"
                  aria-pressed={talent.variant === variant.value}
                  onClick={() => editor.setModelVariant(node.id, variant.value)}
                >
                  {variant.label}
                </button>
              ))}
            </div>
            <p className="text-[12px] leading-[1.5] text-ink-3">
              인물 설명은 생성할 때 자동으로 들어가요. 얼굴이 흔들리면 대표컷을 쓰세요. 시트를 통째로 넣으면 얼굴이 흔들리기 쉬워요.
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn btn-line h-8" onClick={() => editor.uploadTo(node.id)}>
              <Upload size={14} />
              {has ? '사진 바꾸기' : '내 PC에서 올리기'}
            </button>
            <button type="button" className="btn btn-line h-8" onClick={() => editor.openPicker({ mode: 'fill', nodeId: node.id })}>
              <FolderOpen size={14} />
              자산에서 고르기
            </button>
            <select
              aria-label="참조 종류"
              className="field h-8"
              value={node.data.role ?? 'other'}
              onChange={(e) => updateNodeData(node.id, { role: e.target.value as AssetType })}
            >
              {(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((value) => (
                <option key={value} value={value}>
                  {ASSET_TYPE_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
        )}
        {has && !talent && !node.data.video ? (
          <button
            type="button"
            className="btn btn-ghost h-7 justify-start px-1 text-[12px]"
            onClick={() => void editor.saveAsset(node.data.file?.name as string, node.data.title, node.data.role ?? 'other')}
          >
            자산으로 저장해 다른 프로젝트에서도 쓰기
          </button>
        ) : null}
      </div>
    </NodeToolbar>
  );
}

