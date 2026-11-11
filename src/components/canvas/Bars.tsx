'use client';

import { useReactFlow, useViewport } from '@xyflow/react';
import {
  AlignStartVertical,
  Check,
  ChevronDown,
  ChevronLeft,
  Clapperboard,
  FileText,
  FlaskConical,
  Hand,
  ImageIcon,
  LayoutGrid,
  ListChecks,
  MousePointer2,
  Mountain,
  Pencil,
  Plus,
  Redo2,
  Scan,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, formatDateTime } from '@/lib/client';
import { cellStatusOf, ENGINE_INFO, formatCost, formatEstimate, formatNumber, STATUS_LABEL, STEPS } from '@/lib/models';
import type { BalanceInfo, CellKind, CostStats, ImagePreset, Job, Project } from '@/lib/types';
import { FIT_PADDING } from './context';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

const SAVE_TEXT: Record<SaveState, string> = {
  saved: '저장됨',
  dirty: '저장 안 됨',
  saving: '저장 중',
  error: '저장 실패',
  conflict: '다른 창에서 고쳤어요. 새로고침해 주세요',
};

export function ProjectChip({
  project,
  canvasId,
  saveState,
  onSave,
  onLeave,
  onRename,
  onSwitchCanvas,
  onCreateCanvas,
  onRenameCanvas,
}: {
  project: Project;
  canvasId: string;
  saveState: SaveState;
  onSave: () => void;
  /** 저장 안 된 변경이 있으면 나가기 전에 묻는다 */
  onLeave: () => boolean;
  onRename: (name: string) => void;
  onSwitchCanvas: (id: string) => void;
  onCreateCanvas: () => void;
  onRenameCanvas: (id: string, name: string) => void;
}) {
  const current = project.canvases.find((c) => c.id === canvasId);
  const canSave = saveState === 'dirty' || saveState === 'error';
  return (
    <div className="floating flex h-[58px] w-[252px] flex-none items-center gap-1 pl-1.5 pr-2">
      <Link
        href="/"
        className="icon-btn flex-none"
        aria-label="전체 프로젝트로"
        title="전체 프로젝트로"
        onClick={(e) => {
          if (onLeave()) e.preventDefault();
        }}
      >
        <ChevronLeft size={18} />
      </Link>
      <div className="min-w-0 flex-1">
        <EditableName value={project.name} label="프로젝트 이름" onCommit={onRename} className="block w-full truncate text-left text-[14px] font-semibold" />
        <div className="flex min-w-0 items-center gap-1 text-[12px] text-ink-2">
          <CanvasMenu
            project={project}
            canvasId={canvasId}
            currentName={current?.name ?? ''}
            onSwitch={onSwitchCanvas}
            onCreate={onCreateCanvas}
            onRename={onRenameCanvas}
          />
          <span
            data-save-state={saveState}
            title={SAVE_TEXT[saveState]}
            className={`truncate ${saveState === 'error' || saveState === 'conflict' ? 'text-bad' : saveState === 'dirty' ? 'text-wait' : 'text-ink-3'}`}
          >
            · {SAVE_TEXT[saveState]}
          </span>
        </div>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={onSave}
        aria-label="변경내용 저장"
        title="변경내용 저장 (Ctrl+S)"
        className={`btn h-8 flex-none px-2.5 text-[12px] ${canSave ? 'btn-primary' : 'btn-line'}`}
      >
        저장
      </button>
    </div>
  );
}

function EditableName({
  value,
  label,
  onCommit,
  className,
}: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing) {
    return (
      <button
        type="button"
        title={`${label} 바꾸기`}
        aria-label={`${label}: ${value}. 눌러서 바꾸기`}
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
        className={`hover:text-brand-dark ${className ?? ''}`}
      >
        {value}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = text.trim();
    if (next && next !== value) onCommit(next);
  };
  return (
    <input
      autoFocus
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="field h-6 w-full px-1 text-[13px] font-semibold"
    />
  );
}

function CanvasMenu({
  project,
  canvasId,
  currentName,
  onSwitch,
  onCreate,
  onRename,
}: {
  project: Project;
  canvasId: string;
  currentName: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const commitRename = () => {
    if (renaming && text.trim()) onRename(renaming, text.trim());
    setRenaming(null);
  };

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-0.5 whitespace-nowrap hover:text-ink"
      >
        {currentName}
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="floating absolute left-0 top-[calc(100%+8px)] z-10 w-[240px] p-1" role="menu" aria-label="캔버스">
          {project.canvases.map((canvas) => (
            <div key={canvas.id} className="group flex items-center rounded-lg hover:bg-white/5">
              {renaming === canvas.id ? (
                <input
                  autoFocus
                  value={text}
                  aria-label="캔버스 이름"
                  onChange={(e) => setText(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="field m-1 h-7 min-w-0 flex-1"
                />
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      if (canvas.id !== canvasId) onSwitch(canvas.id);
                    }}
                    className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[13px] font-medium text-ink"
                  >
                    <span className="flex w-4 flex-none justify-center text-brand-dark">{canvas.id === canvasId ? <Check size={14} /> : null}</span>
                    <span className="truncate">{canvas.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${canvas.name} 이름 바꾸기`}
                    className="icon-btn mr-1 h-7 w-7 flex-none opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => {
                      setText(canvas.name);
                      setRenaming(canvas.id);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            className="btn btn-ghost h-9 w-full justify-start px-2 font-medium"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            <span className="flex w-4 justify-center">
              <Plus size={14} />
            </span>
            새 캔버스
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 7단계 제작 흐름. 현재 위치와 끝난 단계를 보여 주고, 누르면 그 단계의 칸으로 간다 */
export function StepBar({ done, current, onStep }: { done: boolean[]; current: number; onStep: (index: number) => void }) {
  return (
    <ol className="floating grid h-[58px] min-w-0 flex-1 grid-cols-7 gap-1 p-[5px]" aria-label="7단계 제작 흐름">
      {STEPS.map((label, index) => {
        const on = index === current;
        return (
          <li key={label} className="min-w-0">
            <button
              type="button"
              aria-current={on ? 'step' : undefined}
              aria-label={label}
              title={label}
              data-step-done={done[index] ? 'true' : undefined}
              onClick={() => onStep(index)}
              className={`flex h-full w-full min-w-0 flex-col justify-center rounded-[10px] px-1.5 text-left text-[13px] font-semibold transition-colors min-[1100px]:px-3 ${
                on ? 'bg-brand text-white' : done[index] ? 'text-ink hover:bg-white/5' : 'text-ink-2 hover:bg-white/5 hover:text-ink'
              }`}
            >
              <span className={`flex items-center gap-1 text-[11px] font-semibold tabular-nums ${on ? 'text-white/75' : done[index] ? 'text-ok' : 'text-ink-3'}`}>
                {String(index + 1).padStart(2, '0')}
                {done[index] ? <Check size={11} strokeWidth={3} /> : null}
              </span>
              <span className="hidden truncate min-[1100px]:block">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function MoneyChip({
  stats,
  balance,
  fake,
  pendingCount,
  queueOpen,
  onToggleQueue,
}: {
  stats: CostStats;
  balance: BalanceInfo;
  fake: boolean;
  pendingCount: number;
  queueOpen: boolean;
  onToggleQueue: () => void;
}) {
  const hasMoney = stats.krw.actual > 0 || stats.krw.estimated > 0;
  return (
    <div data-bar="money" className="floating flex h-[58px] flex-none items-center gap-3 pl-3 pr-2 text-[12px] text-ink-2 min-[1100px]:gap-4 min-[1100px]:pl-3.5">
      {fake ? (
        <span className="flex items-center gap-1 rounded-lg bg-wait-soft px-2 py-1 font-semibold text-wait" title="가짜 응답으로 시험 중이에요. 실제 호출은 나가지 않아요.">
          <FlaskConical size={13} />
          시험 모드
        </span>
      ) : null}
      <div title="생성 뒤 확인한 실제 크레딧" className="whitespace-nowrap">
        쓴 크레딧
        <b data-stat="credits-actual" className="block text-[14px] font-semibold tabular-nums text-ink">
          {formatNumber(stats.credits.actual)}
        </b>
      </div>
      <div title="대기 중이거나 아직 확인 전인 크레딧" className="hidden whitespace-nowrap min-[1100px]:block">
        예상
        <b data-stat="credits-estimated" className="block text-[14px] font-semibold tabular-nums text-ink">
          {formatNumber(stats.credits.estimated)}
        </b>
      </div>
      {hasMoney ? (
        <div title="제미나이·GPT로 쓴 돈. 추정은 아직 확인 전인 금액이에요" className="whitespace-nowrap">
          제미나이·GPT
          <b data-stat="krw" className="block text-[14px] font-semibold tabular-nums text-ink">
            ₩{formatNumber(stats.krw.actual + stats.krw.estimated)}
          </b>
        </div>
      ) : null}
      {balance ? (
        <div title={`힉스필드 잔액 · ${formatDateTime(balance.at)} 확인`} className="hidden whitespace-nowrap min-[1100px]:block">
          잔액
          <b data-stat="balance" className="block text-[14px] font-semibold tabular-nums text-ink">
            {formatNumber(balance.credits)}
          </b>
        </div>
      ) : null}
      <button
        type="button"
        aria-pressed={queueOpen}
        onClick={onToggleQueue}
        className={`flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-semibold transition-colors ${
          queueOpen ? 'bg-brand-soft text-brand-dark' : 'text-ink hover:bg-white/5'
        }`}
      >
        <ListChecks size={15} />
        대기열
        {pendingCount > 0 ? (
          <span className="flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-white">{pendingCount}</span>
        ) : null}
      </button>
    </div>
  );
}

export function ToolDock({
  tool,
  dockOffset,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onTool,
  onAdd,
  onTidy,
}: {
  tool: 'select' | 'hand';
  dockOffset: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTool: (tool: 'select' | 'hand') => void;
  onAdd: (kind: CellKind, preset?: ImagePreset) => void;
  onTidy: () => void;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div
      data-bar="dock"
      className={`floating thin-scroll absolute bottom-4 z-[6] flex h-12 max-w-[calc(100%-300px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto px-1.5 ${dockOffset ? 'left-[calc(50%+134px)]' : 'left-1/2'}`}
    >
      <button type="button" className="icon-btn" aria-label="범위 선택 도구" title="범위 선택 (빈 곳을 끌기)" aria-pressed={tool === 'select'} onClick={() => onTool('select')}>
        <MousePointer2 size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label="화면 이동 도구" title="화면 이동 (스페이스를 누른 채 끌어도 돼요)" aria-pressed={tool === 'hand'} onClick={() => onTool('hand')}>
        <Hand size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label="다시 하기" title="다시 하기 (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
        <Redo2 size={16} />
      </button>
      <span className="mx-1 h-6 w-px bg-line" />
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="시나리오" title="시나리오" onClick={() => onAdd('scenario')}>
        <FileText size={14} />
        <span className="hidden min-[1280px]:inline">시나리오</span>
      </button>
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="참조 사진" title="참조 사진" onClick={() => onAdd('ref')}>
        <Upload size={14} />
        <span className="hidden min-[1280px]:inline">참조 사진</span>
      </button>
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="캐릭터 시트" title="캐릭터 시트" onClick={() => onAdd('image', 'character')}>
        <UserRound size={14} />
        <span className="hidden min-[1280px]:inline">캐릭터 시트</span>
      </button>
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="배경 시트" title="배경 시트" onClick={() => onAdd('image', 'background')}>
        <Mountain size={14} />
        <span className="hidden min-[1280px]:inline">배경 시트</span>
      </button>
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="스토리보드" title="스토리보드" onClick={() => onAdd('storyboard')}>
        <LayoutGrid size={14} />
        <span className="hidden min-[1280px]:inline">스토리보드</span>
      </button>
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="샷 카드" title="샷 카드" onClick={() => onAdd('shot')}>
        <ListChecks size={14} />
        <span className="hidden min-[1280px]:inline">샷 카드</span>
      </button>
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="장면 그림" title="장면 그림" onClick={() => onAdd('image', 'scene')}>
        <ImageIcon size={14} />
        <span className="hidden min-[1280px]:inline">장면 그림</span>
      </button>
      <button type="button" className="btn btn-ghost flex-none px-2" aria-label="영상 클립" title="영상 클립" onClick={() => onAdd('video')}>
        <Clapperboard size={14} />
        <span className="hidden min-[1280px]:inline">영상 클립</span>
      </button>
      <span className="mx-1 h-6 w-px bg-line" />
      <button type="button" className="icon-btn" aria-label="칸 정렬" title="칸 정렬. 고른 칸이 없으면 전체를 앞뒤 순서대로 정리해요" onClick={onTidy}>
        <AlignStartVertical size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label="축소" onClick={() => void zoomOut({ duration: 120 })}>
        <ZoomOut size={16} />
      </button>
      <span className="w-9 text-center text-[12px] tabular-nums text-ink-2">{Math.round(zoom * 100)}%</span>
      <button type="button" className="icon-btn" aria-label="확대" onClick={() => void zoomIn({ duration: 120 })}>
        <ZoomIn size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label="전체 보기" title="전체 보기" onClick={() => void fitView({ duration: 200, padding: FIT_PADDING, maxZoom: 1 })}>
        <Scan size={16} />
      </button>
    </div>
  );
}

export function SelectionBar({
  count,
  summary,
  canGenerate,
  dockOffset,
  onGenerate,
  onTidy,
  onDelete,
}: {
  count: number;
  summary: string;
  canGenerate: boolean;
  dockOffset: boolean;
  onGenerate: () => void;
  onTidy: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-bar="selection"
      className={`floating absolute bottom-[76px] z-[6] flex h-12 -translate-x-1/2 items-center gap-3 pl-4 pr-1.5 text-[13px] ${dockOffset ? 'left-[calc(50%+134px)]' : 'left-1/2'}`}
    >
      <span className="whitespace-nowrap font-semibold text-ink">{count}칸 선택</span>
      {summary ? <span className="whitespace-nowrap text-ink-2">{summary}</span> : null}
      <button type="button" className="btn btn-primary" disabled={!canGenerate} onClick={onGenerate}>
        생성
      </button>
      <button type="button" className="btn btn-line" onClick={onTidy}>
        정렬
      </button>
      <button type="button" className="icon-btn" aria-label="선택한 칸 지우기" onClick={onDelete}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function QueueDrawer({
  jobs,
  project,
  canvasId,
  onCancel,
  onFocus,
  onClose,
}: {
  jobs: Job[];
  project: Project;
  canvasId: string;
  onCancel: (jobId: string) => void;
  onFocus: (job: Job) => void;
  onClose: () => void;
}) {
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const recent = jobs
    .filter((j) => j.status === 'done' || j.status === 'failed')
    .slice(-8)
    .reverse();
  const queueCredits = active.filter((j) => j.estimate.unit === 'credit').reduce((sum, j) => sum + j.estimate.amount, 0);
  const canvasName = (id: string) => project.canvases.find((c) => c.id === id)?.name;

  const row = (job: Job) => (
    <li key={job.id} className="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onFocus(job)}>
        <span className="block truncate text-[13px] font-medium text-ink">{job.title}</span>
        <span className="block truncate text-[12px] text-ink-3">
          {STATUS_LABEL[cellStatusOf(job)]} · {ENGINE_INFO[job.engine].short}
          {job.actual ? ` · 실제 ${formatCost(job.actual)}` : job.status === 'failed' ? '' : ` · ${formatEstimate(job.estimate)}`}
          {job.canvasId !== canvasId ? ` · ${canvasName(job.canvasId)}` : ''}
        </span>
      </button>
      {job.status === 'queued' ? (
        <button type="button" className="btn btn-line h-7 flex-none px-2 text-[12px]" onClick={() => onCancel(job.id)}>
          취소
        </button>
      ) : null}
    </li>
  );

  return (
    <aside className="floating nowheel absolute bottom-4 right-4 top-[86px] z-[6] flex w-[320px] flex-col" aria-label="대기열">
      <div className="flex items-center border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold">대기열</h2>
        <button type="button" className="icon-btn ml-auto h-7 w-7" aria-label="대기열 닫기" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4">
        {active.length ? <ul>{active.map(row)}</ul> : <p className="py-8 text-center text-[13px] text-ink-3">대기 중인 칸이 없어요.</p>}
        {recent.length ? (
          <>
            <h3 className="mt-3 text-[12px] font-semibold text-ink-3">최근 결과</h3>
            <ul>{recent.map(row)}</ul>
          </>
        ) : null}
      </div>
      <p className="border-t border-line px-4 py-3 text-[12px] leading-[1.55] text-ink-2">
        {queueCredits > 0 ? (
          <>
            힉스필드 예상 <b className="font-semibold text-ink">{formatNumber(queueCredits)}크레딧</b>.{' '}
          </>
        ) : null}
        대화에서 “돌려줘”라고 하면 Claude가 장수·크레딧·잔액을 알리고 승인을 받은 뒤 생성해요.
      </p>
    </aside>
  );
}

export async function patchProject(projectId: string, body: { name?: string; ruleId?: string }): Promise<Project> {
  const { project } = await api<{ project: Project }>(`/api/projects/${projectId}`, { method: 'PATCH', body });
  return project;
}
