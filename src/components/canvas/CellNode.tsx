'use client';

import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { Clapperboard, FileText, ImageIcon, LayoutGrid, ListChecks, LoaderCircle, Maximize2, Play, Plus, Upload, UserRound } from 'lucide-react';
import { memo, useState } from 'react';
import { fileUrl } from '@/lib/client';
import {
  ASSET_TYPE_LABEL,
  aspectToRatio,
  boardCellWidth,
  boardTileWidth,
  cellStatusOf,
  ENGINE_INFO,
  estimateCell,
  formatCost,
  formatEstimate,
  frameSize,
  gptSize,
  SHOT_CARD_WIDTH,
  STATUS_LABEL,
  VIDEO_MODELS,
} from '@/lib/models';
import type { BoardShot, CellData, CellKind, CellStatus, Job, ShotFields } from '@/lib/types';
import { useEditor, type CellFlowNode } from './context';

const STATUS_STYLE: Record<CellStatus, string> = {
  draft: 'bg-ink-4',
  queued: 'bg-wait',
  running: 'bg-brand',
  done: 'bg-ok',
  failed: 'bg-bad',
};
const STATUS_TEXT: Record<CellStatus, string> = {
  draft: 'text-ink-3',
  queued: 'text-wait',
  running: 'text-brand-dark',
  done: 'text-ok',
  failed: 'text-bad',
};

function costLabel(kind: CellKind, data: CellData, job: Job | undefined, status: CellStatus): string {
  if (status === 'done' && job) return job.actual ? `실제 ${formatCost(job.actual)}` : `추정 ${formatCost(job.estimate)}`;
  if ((status === 'queued' || status === 'running') && job) return formatEstimate(job.estimate).replace('예상 ', '');
  if (status === 'failed') return job?.actual ? `실제 ${formatCost(job.actual)}` : '';
  const estimate = estimateCell(kind, data);
  return estimate ? formatEstimate(estimate).replace('예상 ', '') : '';
}

function sizeLabel(kind: CellKind, data: CellData, done: Job | undefined, videoSize: { width: number; height: number } | null): string {
  if (kind === 'ref') return data.file ? `${data.file.width} × ${data.file.height}` : '';
  if (done?.result) {
    if (done.result.kind === 'image' && done.result.width) return `${done.result.width} × ${done.result.height}`;
    if (videoSize) return `${videoSize.width} × ${videoSize.height}`;
  }
  if (kind === 'video') return `${data.duration ?? 5}초 · ${data.aspect ?? '9:16'}`;
  if (data.engine === 'openai') {
    const size = gptSize(data.aspect ?? '1:1');
    return `${size.width} × ${size.height}`;
  }
  return `${data.aspect ?? '9:16'} · ${(data.resolution ?? '2k').toUpperCase()}`;
}

function InlineTitle({ id, title }: { id: string; title: string }) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!editing) {
    return (
      <span
        className="min-w-0 truncate"
        title="두 번 눌러 이름 바꾸기"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setValue(title);
          setEditing(true);
        }}
      >
        {title}
      </span>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== title) updateNodeData(id, { title: next });
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label="칸 이름"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="nodrag nopan w-full min-w-0 rounded border border-brand bg-inset px-1 text-[12px] font-medium text-ink outline-none"
    />
  );
}

function TargetHandle({ onClick, position = Position.Left }: { onClick: (e: React.MouseEvent) => void; position?: Position }) {
  return (
    <Handle type="target" position={position} className="cell-handle" aria-label="참조 넣기" title="끌어서 잇거나 눌러서 참조를 넣어요" onClick={onClick}>
      <Plus size={13} strokeWidth={2.2} />
    </Handle>
  );
}

function SourceHandle({ onClick, position = Position.Right }: { onClick: (e: React.MouseEvent) => void; position?: Position }) {
  return (
    <Handle type="source" position={position} className="cell-handle" aria-label="다음 칸 잇기" title="끌어서 잇거나 눌러서 다음 칸을 만들어요" onClick={onClick}>
      <Plus size={13} strokeWidth={2.2} />
    </Handle>
  );
}

// ─── 시나리오 ─────────────────────────────────────────────

function ScenarioCell({ id, data }: { id: string; data: CellData }) {
  const editor = useEditor();
  const empty = !data.logline?.trim() && !data.scenario?.trim();
  return (
    <div style={{ width: 240 }} data-cell-kind="scenario">
      <div className="mb-1.5 flex h-[18px] items-center gap-1.5 text-[12px] font-medium text-ink-2">
        <FileText size={13} strokeWidth={1.9} className="flex-none text-ink-3" />
        <InlineTitle id={id} title={data.title} />
        <span className="ml-auto flex-none text-[11px] font-normal text-ink-3">{data.total ?? 15}초</span>
      </div>
      <div className="cell-frame min-h-[120px] p-3.5 text-[13px] leading-[1.55]">
        {empty ? (
          <p className="text-ink-3">로그라인과 시나리오를 적어 주세요. 영상의 메시지를 한두 줄로 먼저 잡아요.</p>
        ) : (
          <>
            {data.logline?.trim() ? <p className="line-clamp-3 text-ink">{data.logline}</p> : null}
            {data.scenario?.trim() ? (
              <p className={`line-clamp-3 ${data.logline?.trim() ? 'mt-2 text-[12px] text-ink-2' : 'text-ink'}`}>{data.scenario}</p>
            ) : null}
          </>
        )}
        <SourceHandle
          onClick={(e) => {
            e.stopPropagation();
            editor.openNextMenu(id, e.clientX, e.clientY);
          }}
        />
      </div>
    </div>
  );
}

// ─── 스토리보드 ───────────────────────────────────────────

function StoryboardCell({ id, data, selected }: { id: string; data: CellData; selected: boolean }) {
  const editor = useEditor();
  const job = editor.latestJob(id);
  const done = editor.latestDone(id);
  const status = cellStatusOf(job);
  const board = editor.board(id);
  const shots: BoardShot[] = board?.shots ?? [];
  const count = shots.length || data.cuts || 15;
  const ratio = aspectToRatio(data.aspect);
  const cols = Math.min(5, count);
  const tile = boardTileWidth(data.aspect);
  const width = boardCellWidth(count, data.aspect);

  return (
    <div style={{ width }} data-cell-kind="storyboard" data-cell-status={status}>
      {selected ? <div className="cell-glow" /> : null}
      <div className="mb-1.5 flex h-[18px] items-center gap-1.5 text-[12px] font-medium text-ink-2">
        <LayoutGrid size={13} strokeWidth={1.9} className="flex-none text-ink-3" />
        <InlineTitle id={id} title={data.title} />
        <span className="ml-1 flex-none text-ink-3">· {count}컷</span>
        <span className="ml-auto flex-none text-[11px] font-normal text-ink-3">
          {data.total ?? 15}초 · {data.aspect ?? '9:16'}
        </span>
      </div>
      <div className="cell-frame px-[11px] pb-2.5 pt-2.5">
        <div className="grid gap-x-1.5 gap-y-2" style={{ gridTemplateColumns: `repeat(${cols}, ${tile}px)` }}>
          {Array.from({ length: count }, (_, index) => {
            const shot = shots[index];
            const panel = board?.panels[index];
            return (
              <div key={index} className="relative min-w-0 text-[9.5px] leading-[1.25] text-ink-3" data-panel={index + 1}>
                <div className="relative overflow-hidden rounded-[3px] bg-inset" style={{ aspectRatio: String(ratio) }}>
                  {panel ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(editor.projectId, panel, 240)} alt="" draggable={false} className="h-full w-full object-cover" />
                  ) : shot?.scene ? (
                    <p className="line-clamp-3 p-1 text-[8.5px] leading-[1.3] text-ink-3">{shot.scene}</p>
                  ) : null}
                  <span className="absolute left-0.5 top-0.5 flex h-[13px] min-w-[13px] items-center justify-center rounded-[3px] bg-black/75 px-0.5 text-[9px] font-bold text-white">
                    {index + 1}
                  </span>
                </div>
                <span className="mt-0.5 block truncate">{shot ? shot.size?.trim() || `${shot.seconds}초` : ' '}</span>
                <span className="tension mt-0.5">
                  <i style={{ width: `${shot?.tension ?? 0}%` }} />
                </span>
              </div>
            );
          })}
        </div>
        {status === 'running' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[10px] bg-black/60 text-[12px] font-medium text-brand-dark">
            <LoaderCircle size={22} className="spin" />
            시트를 뽑는 중
          </div>
        ) : null}
        {done?.result ? (
          <button
            type="button"
            aria-label={`${data.title} 시트 크게 보기`}
            className="nodrag cell-expand absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-white hover:bg-black/90"
            onClick={(e) => {
              e.stopPropagation();
              editor.openLightbox({ url: fileUrl(editor.projectId, done.result?.file as string), kind: 'image', title: data.title });
            }}
          >
            <Maximize2 size={14} />
          </button>
        ) : null}
        <TargetHandle
          onClick={(e) => {
            e.stopPropagation();
            editor.openPicker({ mode: 'connect', targetId: id });
          }}
        />
        <SourceHandle
          onClick={(e) => {
            e.stopPropagation();
            editor.openNextMenu(id, e.clientX, e.clientY);
          }}
        />
      </div>
      <div className="mt-1.5 flex h-[18px] items-center gap-1.5 text-[11px]">
        <span className={`h-1.5 w-1.5 flex-none rounded-full ${STATUS_STYLE[status]}`} />
        <span className={`flex-none font-semibold ${STATUS_TEXT[status]}`}>{STATUS_LABEL[status]}</span>
        <span className="truncate text-ink-3">{costLabel('storyboard', data, job, status)}</span>
        <span className="ml-auto flex-none text-ink-3">{ENGINE_INFO[job?.engine ?? data.engine ?? 'higgsfield'].short}</span>
      </div>
    </div>
  );
}

// ─── 샷 카드 ──────────────────────────────────────────────

const SHOT_ROWS: { key: keyof ShotFields; label: string; rows: number; placeholder: string }[] = [
  { key: 'camera', label: '카메라', rows: 1, placeholder: '천천히 뒤로 빠지며 따라감' },
  { key: 'action', label: '동작 · 표정', rows: 2, placeholder: '무엇이 움직이고 어떤 표정인가요' },
  { key: 'speed', label: '속도 변화', rows: 1, placeholder: '내려놓는 순간 슬로모션' },
  { key: 'light', label: '조명 · 분위기', rows: 1, placeholder: '트리 불빛, 따뜻한 저녁' },
];

function ShotCell({ id, data, selected }: { id: string; data: CellData; selected: boolean }) {
  const editor = useEditor();
  const { updateNodeData } = useReactFlow();
  const board = data.boardId ? editor.board(data.boardId) : undefined;
  const index = (data.shotNo ?? 1) - 1;
  const boardShot = board?.shots[index];
  const shot: ShotFields = boardShot ?? data.shot ?? {};
  const seconds = boardShot?.seconds ?? data.duration ?? 4;
  const elements = editor.rule?.rule.elements ?? [];
  // 입력창은 자기 상태를 먼저 고친다. 캔버스 상태는 한 박자 늦게 반영되어, 바로 묶으면 한글 조합이 깨진다
  const [draft, setDraft] = useState<ShotFields>(shot);
  const [wasSelected, setWasSelected] = useState(selected);
  const [seenVersion, setSeenVersion] = useState(editor.historyVersion);
  if (selected !== wasSelected || seenVersion !== editor.historyVersion) {
    setWasSelected(selected);
    setSeenVersion(editor.historyVersion);
    if (selected) setDraft(shot);
  }
  const fields = selected ? draft : shot;

  const save = (patch: Partial<ShotFields & { seconds: number }>) => {
    const { seconds: nextSeconds, ...rest } = patch;
    setDraft((current) => ({ ...current, ...rest }));
    if (board && data.boardId) {
      editor.setShots(
        data.boardId,
        board.shots.map((item, i) => (i === index ? { ...item, ...rest, ...(nextSeconds ? { seconds: nextSeconds } : {}) } : item)),
      );
    } else {
      updateNodeData(id, { shot: { ...draft, ...rest }, ...(nextSeconds ? { duration: nextSeconds } : {}) });
    }
  };

  const toggle = (key: string) => {
    const must = fields.must ?? [];
    save({ must: must.includes(key) ? must.filter((m) => m !== key) : [...must, key] });
  };

  return (
    <div style={{ width: SHOT_CARD_WIDTH }} data-cell-kind="shot">
      <div className="cell-frame px-3.5 pb-3 pt-3">
        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
          <ListChecks size={14} strokeWidth={1.9} className="flex-none text-ink-3" />
          <InlineTitle id={id} title={data.title} />
          <span className="ml-auto flex flex-none items-center gap-1 text-[12px] font-normal text-ink-2">
            {selected ? (
              <input
                aria-label="샷 길이(초)"
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                defaultValue={seconds}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (value > 0) save({ seconds: value });
                }}
                className="nodrag nopan w-12 rounded border border-line bg-inset px-1 text-right text-ink outline-none focus:border-brand"
              />
            ) : (
              seconds
            )}
            초 · 프롬프트
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-[74px_1fr] items-baseline gap-y-1.5 text-[12px] leading-[1.45]">
          <dt className="text-ink-2">샷 · 앵글</dt>
          <dd className="min-w-0 text-ink">
            {selected ? (
              <span className="flex gap-1">
                <input
                  aria-label="샷 크기"
                  value={fields.size ?? ''}
                  placeholder="로우 앵글"
                  onChange={(e) => save({ size: e.target.value })}
                  className="nodrag nopan w-1/2 min-w-0 rounded border border-line bg-inset px-1.5 py-0.5 outline-none focus:border-brand"
                />
                <input
                  aria-label="앵글"
                  value={fields.angle ?? ''}
                  placeholder="광각"
                  onChange={(e) => save({ angle: e.target.value })}
                  className="nodrag nopan w-1/2 min-w-0 rounded border border-line bg-inset px-1.5 py-0.5 outline-none focus:border-brand"
                />
              </span>
            ) : (
              [fields.size, fields.angle].filter(Boolean).join(', ') || <span className="text-ink-4">비어 있음</span>
            )}
          </dd>
          {SHOT_ROWS.map((row) => (
            <div key={row.key} className="contents">
              <dt className="text-ink-2">{row.label}</dt>
              <dd className="min-w-0 text-ink">
                {selected ? (
                  <textarea
                    aria-label={row.label}
                    rows={row.rows}
                    value={String(fields[row.key] ?? '')}
                    placeholder={row.placeholder}
                    onChange={(e) => save({ [row.key]: e.target.value })}
                    className="nodrag nopan nowheel block w-full resize-none rounded border border-line bg-inset px-1.5 py-0.5 leading-[1.45] outline-none focus:border-brand"
                  />
                ) : (
                  <span className="line-clamp-3">{String(fields[row.key] ?? '') || <span className="text-ink-4">비어 있음</span>}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-2.5 flex flex-wrap gap-1" role="group" aria-label="필수 연출 요소">
          {elements.map((element) => {
            const on = (fields.must ?? []).includes(element.key);
            return (
              <button
                key={element.key}
                type="button"
                title={element.text}
                aria-pressed={on}
                disabled={!selected}
                onClick={() => toggle(element.key)}
                className="chip nodrag !px-2 !py-[3px] !text-[11px] disabled:cursor-default"
              >
                {element.label}
              </button>
            );
          })}
        </div>
        <TargetHandle
          onClick={(e) => {
            e.stopPropagation();
          }}
        />
        <SourceHandle
          position={Position.Bottom}
          onClick={(e) => {
            e.stopPropagation();
            editor.openNextMenu(id, e.clientX, e.clientY);
          }}
        />
      </div>
    </div>
  );
}

// ─── 사진·그림·영상 ───────────────────────────────────────

function MediaCell({ id, kind, data }: { id: string; kind: CellKind; data: CellData }) {
  const editor = useEditor();
  const job = kind === 'ref' ? undefined : editor.latestJob(id);
  const done = kind === 'ref' ? undefined : editor.latestDone(id);
  const status = cellStatusOf(job);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);

  // 아직 크게 뽑지 않은 장면은 시트에서 자른 칸을 보여 준다
  const seedPanel = kind === 'image' && !done && data.boardId && data.shotNo ? editor.board(data.boardId)?.panels[data.shotNo - 1] : undefined;
  const mediaFile = kind === 'ref' ? data.file?.name : done?.result?.file ?? seedPanel;
  const mediaKind = done?.result?.kind ?? 'image';

  let ratio = aspectToRatio(data.aspect);
  if (kind === 'ref') ratio = data.file?.width ? data.file.width / data.file.height : 16 / 9;
  else if (done?.result?.width) ratio = done.result.width / done.result.height;
  else if (videoSize) ratio = videoSize.width / videoSize.height;
  else if (kind === 'image' && data.engine === 'openai') {
    const size = gptSize(data.aspect ?? '1:1');
    ratio = size.width / size.height;
  }
  // 재료 칸은 왼쪽 열에 쌓이므로 세로 사진도 너무 길어지지 않게 위쪽을 살려 자른다. 눌러서 원본을 볼 수 있다
  const refCropped = kind === 'ref' && !data.compact && ratio < 1.2;
  const frame = kind === 'ref' && !data.compact ? { width: 240, height: Math.round(240 / Math.min(Math.max(ratio, 1.2), 2.4)) } : frameSize(ratio, data.compact);
  const Icon = kind === 'video' ? Clapperboard : data.talent ? UserRound : ImageIcon;
  const size = sizeLabel(kind, data, done, videoSize);
  const fromShotCard = !!data.compact && kind === 'image';

  const openLarge = () => {
    if (!mediaFile) return;
    editor.openLightbox({
      url: fileUrl(editor.projectId, mediaFile),
      kind: kind === 'ref' ? 'image' : mediaKind,
      title: data.title,
      meta: seedPanel ? '시트에서 자른 칸' : size,
    });
  };

  return (
    <div style={{ width: frame.width }} data-cell-kind={kind} data-cell-status={kind === 'ref' ? undefined : status}>
      <div className="mb-1.5 flex h-[18px] items-center gap-1.5 text-[12px] font-medium text-ink-2">
        {data.compact ? null : <Icon size={13} strokeWidth={1.9} className="flex-none text-ink-3" />}
        <InlineTitle id={id} title={data.title} />
        {data.compact ? null : <span className="ml-auto flex-none text-[11px] font-normal text-ink-3">{size}</span>}
      </div>

      <div className="cell-frame" style={{ height: frame.height }} onDoubleClick={openLarge}>
        {mediaFile && (kind === 'ref' || mediaKind === 'image') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl(editor.projectId, mediaFile, 480)}
            alt={data.title}
            draggable={false}
            className={`cell-media ${seedPanel ? 'opacity-70' : ''} ${refCropped ? 'object-top' : ''}`}
          />
        ) : null}
        {mediaFile && kind !== 'ref' && mediaKind === 'video' ? (
          <video
            src={fileUrl(editor.projectId, mediaFile)}
            preload="metadata"
            muted
            playsInline
            className="cell-media pointer-events-none"
            onLoadedMetadata={(e) => {
              const { videoWidth, videoHeight } = e.currentTarget;
              if (videoWidth && videoHeight) setVideoSize({ width: videoWidth, height: videoHeight });
            }}
          />
        ) : null}

        {!mediaFile && kind !== 'ref' ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-ink-4">
            <Icon size={data.compact ? 22 : 36} strokeWidth={1.3} />
            {kind === 'video' && (data.quality ?? 'draft') === 'draft' ? <span className="text-[11px] text-ink-3">480p 초안</span> : null}
          </div>
        ) : null}

        {!mediaFile && kind === 'ref' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <button
              type="button"
              className="nodrag btn btn-line"
              onClick={(e) => {
                e.stopPropagation();
                editor.uploadTo(id);
              }}
            >
              <Upload size={14} />
              사진 올리기
            </button>
            <p className="text-[12px] text-ink-3">끌어다 놓아도 돼요</p>
          </div>
        ) : null}

        {status === 'running' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[10px] bg-black/60 text-[12px] font-medium text-brand-dark">
            <LoaderCircle size={22} className="spin" />
            생성 중
          </div>
        ) : null}

        {mediaFile && kind !== 'ref' && mediaKind === 'video' && status !== 'running' ? (
          <button
            type="button"
            aria-label={`${data.title} 재생`}
            className="nodrag absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm hover:bg-black/85"
            onClick={(e) => {
              e.stopPropagation();
              openLarge();
            }}
          >
            <Play size={18} fill="currentColor" className="ml-0.5" />
          </button>
        ) : null}

        {mediaFile && !(kind !== 'ref' && mediaKind === 'video') && status !== 'running' ? (
          <button
            type="button"
            aria-label={`${data.title} 크게 보기`}
            className="nodrag cell-expand absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-white hover:bg-black/90"
            onClick={(e) => {
              e.stopPropagation();
              openLarge();
            }}
          >
            <Maximize2 size={14} />
          </button>
        ) : null}

        {kind !== 'ref' ? (
          <TargetHandle
            position={fromShotCard ? Position.Top : Position.Left}
            onClick={(e) => {
              e.stopPropagation();
              editor.openPicker({ mode: 'connect', targetId: id });
            }}
          />
        ) : null}
        {kind !== 'video' ? (
          <SourceHandle
            onClick={(e) => {
              e.stopPropagation();
              editor.openNextMenu(id, e.clientX, e.clientY);
            }}
          />
        ) : null}
      </div>

      {kind !== 'ref' ? (
        <div className="mt-1.5 flex h-[18px] items-center gap-1.5 text-[11px]">
          <span className={`h-1.5 w-1.5 flex-none rounded-full ${STATUS_STYLE[status]}`} />
          <span className={`flex-none font-semibold ${STATUS_TEXT[status]}`}>{STATUS_LABEL[status]}</span>
          <span className="truncate text-ink-3">{costLabel(kind, data, job, status)}</span>
          {data.compact || data.stage ? null : (
            <span className="ml-auto flex-none text-ink-3">
              {kind === 'image' ? ENGINE_INFO[job?.engine ?? data.engine ?? 'higgsfield'].short : VIDEO_MODELS[data.model ?? '']?.label}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex h-[18px] items-center gap-1.5 text-[11px] text-ink-3">
          <span className="truncate">{data.talent ? '내 모델' : data.video ? '내 영상' : data.file?.originalName ?? '사진 없음'}</span>
          {data.role && data.role !== 'other' ? <span className="ml-auto flex-none">{ASSET_TYPE_LABEL[data.role]}</span> : null}
        </div>
      )}
    </div>
  );
}

function CellNodeView({ id, type, data, selected }: NodeProps<CellFlowNode>) {
  const kind = type as CellKind;
  if (kind === 'scenario') return <ScenarioCell id={id} data={data} />;
  if (kind === 'storyboard') return <StoryboardCell id={id} data={data} selected={!!selected} />;
  if (kind === 'shot') return <ShotCell id={id} data={data} selected={!!selected} />;
  return <MediaCell id={id} kind={kind} data={data} />;
}

export const CellNode = memo(CellNodeView);
