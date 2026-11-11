'use client';

import {
  addEdge,
  Background,
  BackgroundVariant,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type OnBeforeDelete,
  type OnConnectEnd,
  type Viewport as FlowViewport,
} from '@xyflow/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, ASSET_DRAG_TYPE, pickFiles, videoUrl } from '@/lib/client';
import { canConnect, createsCycle, levels, topoOrder } from '@/lib/graph';
import { boardCellWidth, computeSteps, defaultCellData, ENGINE_INFO, estimateCell, formatNumber, frameSize, promptOf, splitBoardCells } from '@/lib/models';
import type {
  AssetType,
  BalanceInfo,
  Board,
  BoardShot,
  CanvasDoc,
  CellData,
  CellKind,
  CostStats,
  EngineStatus,
  FileEntry,
  ImagePreset,
  Job,
  LibraryVideo,
  LibraryView,
  ModelVariant,
  Project,
  StoredEdge,
  StoredNode,
} from '@/lib/types';
import { Lightbox, type LightboxItem } from '../Lightbox';
import { AssetDock, type AssetPayload } from './AssetDock';
import { MoneyChip, ProjectChip, QueueDrawer, SelectionBar, StepBar, ToolDock, type SaveState } from './Bars';
import { CellNode } from './CellNode';
import { EditorContext, FIT_PADDING, type CellFlowNode, type EditorApi, type PickerTarget } from './context';
import { LinkEdge } from './LinkEdge';
import { ConfirmDialog, NextMenu, RefPicker, Toast, type ConfirmRequest } from './Overlays';
import { PromptPanel, RefPanel, ScenarioPanel, StoryboardPanel } from './PromptPanel';

const nodeTypes = { scenario: CellNode, ref: CellNode, image: CellNode, storyboard: CellNode, shot: CellNode, video: CellNode };
const edgeTypes = { link: LinkEdge };

const HISTORY_LIMIT = 100;
/** 글을 치는 동안은 한 번의 되돌리기로 묶는다 */
const HISTORY_DELAY_MS = 350;

const newLocalId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function toFlowNodes(nodes: StoredNode[]): CellFlowNode[] {
  return nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }));
}

/** 처음 여는 캔버스는 스토리보드를 골라 둔다. 다음에 할 일이 거기 있다 */
function initialNodes(doc: CanvasDoc): CellFlowNode[] {
  const list = toFlowNodes(doc.nodes);
  if (doc.viewport) return list;
  const board = list.find((n) => n.type === 'storyboard');
  return board ? list.map((n) => (n === board ? { ...n, selected: true } : n)) : list;
}

/** 샷이 많으면 전체를 넣지 않고 재료, 시트, 첫 샷까지만 보여 준다 */
function initialFitNodes(doc: CanvasDoc): { id: string }[] | undefined {
  const head = doc.nodes.filter((n) => !(n.data.shotNo && n.data.shotNo > 1));
  return head.length && head.length < doc.nodes.length ? head.map((n) => ({ id: n.id })) : undefined;
}

function toFlowEdges(edges: StoredEdge[]): Edge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'link' }));
}

function payloadOf(nodes: CellFlowNode[], edges: Edge[], viewport: FlowViewport | null) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    viewport: viewport ? { x: Math.round(viewport.x), y: Math.round(viewport.y), zoom: Math.round(viewport.zoom * 1000) / 1000 } : null,
  };
}

/** 저장할 내용이 달라졌는지 견주는 값. 화면 위치(viewport)는 넣지 않는다 */
function canvasKeyOf(nodes: CellFlowNode[], edges: Edge[]): string {
  const { nodes: n, edges: e } = payloadOf(nodes, edges, null);
  return JSON.stringify({ nodes: n, edges: e });
}

/** 샷 표를 항상 같은 순서의 글로 바꾼다. 서버가 돌려준 표와 화면의 표를 내용으로 견주기 위해서다 */
function shotsKey(shots: BoardShot[]): string {
  return JSON.stringify(
    shots.map((s) => [s.seconds, s.scene, s.tension, s.size || '', s.angle || '', s.camera || '', s.action || '', s.speed || '', s.light || '', s.must ?? []]),
  );
}

type Snapshot = { nodes: StoredNode[]; edges: StoredEdge[]; shots: Record<string, BoardShot[]> };

/** 되돌리기 한 칸. 칸·선·샷 표를 함께 담는다. 칸 상태는 생성 기록에서 오므로 담지 않는다 */
function snapshotOf(nodes: CellFlowNode[], edges: Edge[], boards: Record<string, Board>): string {
  const { nodes: n, edges: e } = payloadOf(nodes, edges, null);
  const shots: Record<string, unknown> = {};
  for (const node of n) {
    if (node.type !== 'storyboard') continue;
    const list = boards[node.id]?.shots ?? [];
    shots[node.id] = list.map((s) => ({
      no: s.no,
      seconds: s.seconds,
      scene: s.scene,
      tension: s.tension,
      size: s.size || undefined,
      angle: s.angle || undefined,
      camera: s.camera || undefined,
      action: s.action || undefined,
      speed: s.speed || undefined,
      light: s.light || undefined,
      must: s.must?.length ? s.must : undefined,
    }));
  }
  return JSON.stringify({ nodes: n, edges: e, shots });
}

function connectionProblem(source: CellKind, target: CellKind): string {
  if (source === 'video') return '영상 칸은 아직 뒤 칸으로 이을 수 없어요.';
  if (target === 'ref') return '참조 사진 칸에는 선을 이을 수 없어요. 사진을 직접 올려 주세요.';
  if (target === 'scenario') return '시나리오 칸에는 선을 이을 수 없어요. 글로 적어 주세요.';
  return '이 두 칸은 이을 수 없어요.';
}

export function FlowCanvas({
  project,
  doc,
  serverRevision,
  jobs,
  stats,
  boards: serverBoards,
  balance,
  engines,
  library,
  onJobs,
  onBoards,
  onSaveShots,
  refreshLibrary,
  onProject,
  onRename,
  onSetRule,
  onSwitchCanvas,
  onCreateCanvas,
  onRenameCanvas,
}: {
  project: Project;
  doc: CanvasDoc;
  /** 저장된 캔버스의 판 번호. 대화에서 칸을 이으면 올라간다 */
  serverRevision?: number;
  jobs: Job[];
  stats: CostStats;
  boards: Record<string, Board>;
  balance: BalanceInfo;
  engines: EngineStatus;
  library: LibraryView | null;
  onJobs: (jobs: Job[], stats: CostStats) => void;
  onBoards: (boards: Record<string, Board>) => void;
  onSaveShots: (nodeId: string, shots: BoardShot[]) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  onProject: (project: Project) => void;
  onRename: (name: string) => void;
  onSetRule: (ruleId: string) => void;
  onSwitchCanvas: (id: string) => void;
  onCreateCanvas: () => void;
  onRenameCanvas: (id: string, name: string) => void;
}) {
  const projectId = project.id;
  const canvasId = doc.id;
  const rf = useReactFlow<CellFlowNode, Edge>();
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<CellFlowNode>(initialNodes(doc));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(doc.edges));
  // 화면에서 고친 샷 표. 저장을 누르기 전에는 서버로 보내지 않는다
  const [shotDrafts, setShotDrafts] = useState<Record<string, BoardShot[]>>({});
  const boards = useMemo(() => {
    const ids = Object.keys(shotDrafts);
    if (!ids.length) return serverBoards;
    const merged: Record<string, Board> = { ...serverBoards };
    for (const id of ids) {
      const saved = serverBoards[id];
      merged[id] = { panels: saved?.panels ?? [], sheetFile: saved?.sheetFile ?? null, updatedAt: saved?.updatedAt ?? '', shots: shotDrafts[id] };
    }
    return merged;
  }, [serverBoards, shotDrafts]);

  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [queueOpen, setQueueOpen] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [toast, setToast] = useState('');
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [nextMenu, setNextMenu] = useState<{ x: number; y: number; sourceId: string; flowPosition?: { x: number; y: number } } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [stepFocus, setStepFocus] = useState<number | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const clearToast = useCallback(() => setToast(''), []);

  const confirm = useCallback((request: Omit<ConfirmRequest, 'resolve'>) => {
    return new Promise<boolean>((resolve) => {
      setConfirmRequest({
        ...request,
        resolve: (ok) => {
          setConfirmRequest(null);
          resolve(ok);
        },
      });
    });
  }, []);

  // ─── 저장 ───────────────────────────────────────────────
  // 건드린다고 바로 저장하지 않는다. 「저장」이나 Ctrl+S를 누를 때 보낸다.
  // 생성을 누를 때도 저장한다. 대기열은 저장된 칸 내용을 읽기 때문이다.
  const latest = useRef({ nodes, edges, drafts: shotDrafts, boards, serverBoards });
  useEffect(() => {
    latest.current = { nodes, edges, drafts: shotDrafts, boards, serverBoards };
  }, [boards, edges, nodes, serverBoards, shotDrafts]);

  const viewportRef = useRef<FlowViewport | null>(doc.viewport);
  const revisionRef = useRef(doc.revision);
  const [savedKey, setSavedKey] = useState(() => canvasKeyOf(toFlowNodes(doc.nodes), toFlowEdges(doc.edges)));
  const savedKeyRef = useRef(savedKey);
  const savedViewport = useRef(JSON.stringify(payloadOf([], [], doc.viewport).viewport));
  const inFlight = useRef<Promise<void> | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveFailure, setSaveFailure] = useState<'error' | 'conflict' | null>(null);

  const canvasKey = useMemo(() => canvasKeyOf(nodes, edges), [nodes, edges]);
  const shotsDirty = useMemo(
    () => Object.entries(shotDrafts).some(([id, shots]) => shotsKey(shots) !== shotsKey(serverBoards[id]?.shots ?? [])),
    [serverBoards, shotDrafts],
  );
  const dirty = canvasKey !== savedKey || shotsDirty;
  const saveState: SaveState =
    saveFailure === 'conflict' ? 'conflict' : saveBusy ? 'saving' : saveFailure === 'error' && dirty ? 'error' : dirty ? 'dirty' : 'saved';

  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const saveNow = useCallback(async (): Promise<void> => {
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    const { nodes: currentNodes, edges: currentEdges, drafts } = latest.current;
    const payload = payloadOf(currentNodes, currentEdges, viewportRef.current);
    const key = JSON.stringify({ nodes: payload.nodes, edges: payload.edges });
    const viewportKey = JSON.stringify(payload.viewport);
    const request = (async () => {
      setSaveBusy(true);
      try {
        for (const [nodeId, shots] of Object.entries(drafts)) await onSaveShots(nodeId, shots);
        if (key !== savedKeyRef.current || viewportKey !== savedViewport.current) {
          const res = await api<{ revision: number }>(`/api/projects/${projectId}/canvases/${canvasId}`, {
            method: 'PUT',
            body: { ...payload, revision: revisionRef.current },
          });
          revisionRef.current = res.revision;
          savedKeyRef.current = key;
          savedViewport.current = viewportKey;
          setSavedKey(key);
        }
        // 저장하는 사이에 또 고친 샷 표는 남겨 둔다
        setShotDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id, shots]) => shots !== drafts[id])));
        setSaveFailure(null);
      } catch (e) {
        setSaveFailure((e as ApiError).status === 409 ? 'conflict' : 'error');
        throw e;
      } finally {
        setSaveBusy(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = request;
    await request;
  }, [canvasId, onSaveShots, projectId]);

  const saveFromButton = useCallback(() => {
    void saveNow().catch((e: Error) => setToast(e.message));
  }, [saveNow]);

  /** 사용자가 「저장 안 함」을 고르고 나갈 때 켠다. 고치던 내용을 맡겨 두지 않는다 */
  const discardOnLeave = useRef(false);

  /** 저장 안 된 변경이 있으면 물어보고 참을 돌려준다. 없으면 거짓이고 바로 넘어가면 된다 */
  const askBeforeLeaving = useCallback(
    (go: () => void): boolean => {
      if (!dirtyRef.current) return false;
      setConfirmRequest({
        title: '저장하지 않은 변경이 있어요',
        body: '저장하고 넘어갈까요?\n저장하지 않으면 마지막으로 저장한 상태로 돌아가요.',
        confirmLabel: '저장하고 넘어가기',
        cancelLabel: '저장 안 함',
        resolve: async (ok, dismissed) => {
          setConfirmRequest(null);
          if (dismissed) return;
          if (ok) {
            try {
              await saveNow();
            } catch (e) {
              setToast((e as Error).message);
              return;
            }
          }
          discardOnLeave.current = true;
          go();
        },
      });
      return true;
    },
    [saveNow],
  );

  const switchCanvasGuarded = (id: string) => {
    if (!askBeforeLeaving(() => onSwitchCanvas(id))) onSwitchCanvas(id);
  };
  const createCanvasGuarded = () => {
    if (!askBeforeLeaving(onCreateCanvas)) onCreateCanvas();
  };

  // 창을 닫거나 새로고침할 때는 브라우저가 묻는다
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // 브라우저의 뒤로 가기는 묻지 못한다. 고치던 내용을 잠시 맡겨 뒀다가 다시 들어오면 되살린다
  const stashUnsaved = useCallback(() => {
    if (!dirtyRef.current || discardOnLeave.current) return;
    try {
      const { nodes: stashNodes, edges: stashEdges, drafts } = latest.current;
      sessionStorage.setItem(
        `videocreate:unsaved:${canvasId}`,
        JSON.stringify({ revision: revisionRef.current, ...payloadOf(stashNodes, stashEdges, null), drafts }),
      );
    } catch {
      // 맡겨 두지 못해도 화면은 그대로 돌아간다
    }
  }, [canvasId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const key = `videocreate:unsaved:${canvasId}`;
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return;
        sessionStorage.removeItem(key);
        const stash = JSON.parse(raw) as { revision: number; nodes: StoredNode[]; edges: StoredEdge[]; drafts: Record<string, BoardShot[]> };
        if (stash.revision !== revisionRef.current) return;
        setNodes(toFlowNodes(stash.nodes));
        setEdges(toFlowEdges(stash.edges));
        setShotDrafts(stash.drafts);
        setToast('저장하지 않은 변경을 되살렸어요. 필요 없으면 새로고침할 때 「저장 안 함」을 고르세요.');
      } catch {
        // 맡겨 둔 내용을 못 읽으면 저장된 상태로 연다
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      stashUnsaved();
    };
  }, [canvasId, setEdges, setNodes, stashUnsaved]);

  // 대화에서 칸을 이었거나 다른 창에서 저장했으면 따라간다. 고치는 중이면 새 칸과 선만 더한다
  useEffect(() => {
    if (!serverRevision || serverRevision <= revisionRef.current) return;
    let alive = true;
    void api<{ canvas: CanvasDoc }>(`/api/projects/${projectId}/canvases/${canvasId}`)
      .then(({ canvas }) => {
        if (!alive || canvas.revision <= revisionRef.current) return;
        const before = JSON.parse(savedKeyRef.current) as { nodes: StoredNode[]; edges: StoredEdge[] };
        const knownNodes = new Set(before.nodes.map((n) => n.id));
        const knownEdges = new Set(before.edges.map((e) => e.id));
        const freshNodes = canvas.nodes.filter((n) => !knownNodes.has(n.id));
        const freshEdges = canvas.edges.filter((e) => !knownEdges.has(e.id));
        const key = canvasKeyOf(toFlowNodes(canvas.nodes), toFlowEdges(canvas.edges));
        revisionRef.current = canvas.revision;
        savedKeyRef.current = key;
        setSavedKey(key);
        if (dirtyRef.current) {
          setNodes((list) => [...list, ...toFlowNodes(freshNodes)]);
          setEdges((list) => [...list, ...toFlowEdges(freshEdges)]);
        } else {
          setNodes((list) => {
            const prior = new Map(list.map((n) => [n.id, n]));
            return canvas.nodes.map((n) => {
              const existing = prior.get(n.id);
              return existing ? { ...existing, position: n.position, data: n.data } : { id: n.id, type: n.type, position: n.position, data: n.data };
            });
          });
          setEdges(toFlowEdges(canvas.edges));
        }
        if (freshNodes.length) setToast(`'${freshNodes[0].data.title}' 칸이 들어왔어요.`);
        // 요기보 제품을 이으면 규칙도 바뀐다. 화면의 규칙 표시를 맞춘다
        void api<{ project: Project }>(`/api/projects/${projectId}`)
          .then((res) => onProject(res.project))
          .catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [canvasId, onProject, projectId, serverRevision, setEdges, setNodes]);

  const editShots = useCallback((nodeId: string, shots: BoardShot[]) => {
    setShotDrafts((current) => ({ ...current, [nodeId]: shots.map((shot, index) => ({ ...shot, no: index + 1 })) }));
  }, []);

  // ─── 생성 기록 찾기 ──────────────────────────────────────
  const jobIndex = useMemo(() => {
    const latestByNode = new Map<string, Job>();
    const doneByNode = new Map<string, Job>();
    for (const job of jobs) {
      if (job.canvasId !== canvasId) continue;
      if (job.status !== 'cancelled') latestByNode.set(job.nodeId, job);
      if (job.status === 'done' && job.result) doneByNode.set(job.nodeId, job);
    }
    return { latestByNode, doneByNode };
  }, [jobs, canvasId]);

  const setStage = useCallback(
    (nodeId: string, stage: 'edit' | 'final') => {
      rf.updateNodeData(nodeId, { stage });
      setStepFocus(stage === 'final' ? 6 : 5);
      setToast(stage === 'final' ? '완성본으로 등록했어요. 갤러리의 이 프로젝트 맨 위에 보여요.' : '완성 등록을 풀었어요.');
      // 등록은 사용자가 직접 누른 확정이라 바로 저장한다
      setTimeout(saveFromButton, 150);
    },
    [rf, saveFromButton],
  );

  // ─── 되돌리기 ───────────────────────────────────────────
  const history = useRef({ past: [] as string[], future: [] as string[], current: '' });
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false, version: 0 });

  const commitHistory = useCallback(() => {
    const h = history.current;
    const next = snapshotOf(latest.current.nodes, latest.current.edges, latest.current.boards);
    if (!h.current) {
      h.current = next;
      return;
    }
    if (next === h.current) return;
    h.past.push(h.current);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.current = next;
    h.future = [];
    setHistoryState((s) => ({ ...s, canUndo: true, canRedo: false }));
  }, []);

  useEffect(() => {
    // 끄는 동안은 기록하지 않고, 놓은 뒤에 한 번만 남긴다
    if (nodes.some((n) => n.dragging)) return;
    const timer = setTimeout(commitHistory, HISTORY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [boards, commitHistory, edges, nodes]);

  const moveInHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      commitHistory();
      const h = history.current;
      const from = direction === 'undo' ? h.past : h.future;
      const to = direction === 'undo' ? h.future : h.past;
      const target = from[from.length - 1];
      if (!target) return;
      const snapshot = JSON.parse(target) as Snapshot;
      const keep = new Set(snapshot.nodes.map((n) => n.id));
      const busy = latest.current.nodes.some((n) => {
        if (keep.has(n.id)) return false;
        const status = jobIndex.latestByNode.get(n.id)?.status;
        return status === 'queued' || status === 'running';
      });
      if (busy) {
        setToast('대기 중이거나 생성 중인 칸이 사라지게 돼서 되돌릴 수 없어요. 대기를 먼저 취소해 주세요.');
        return;
      }
      from.pop();
      to.push(h.current);
      h.current = target;
      setNodes((list) => {
        const before = new Map(list.map((n) => [n.id, n]));
        return snapshot.nodes.map((n) => {
          const existing = before.get(n.id);
          return existing ? { ...existing, position: n.position, data: n.data } : { ...n };
        });
      });
      setEdges((list) => {
        const before = new Map(list.map((e) => [e.id, e]));
        return snapshot.edges.map((e) => before.get(e.id) ?? { ...e, type: 'link' });
      });
      const saved = latest.current.serverBoards;
      setShotDrafts(
        Object.fromEntries(Object.entries(snapshot.shots).filter(([id, shots]) => shotsKey(shots) !== shotsKey(saved[id]?.shots ?? []))),
      );
      setHistoryState((s) => ({ canUndo: h.past.length > 0, canRedo: h.future.length > 0, version: s.version + 1 }));
    },
    [commitHistory, jobIndex, setEdges, setNodes],
  );

  const undo = useCallback(() => moveInHistory('undo'), [moveInHistory]);
  const redo = useCallback(() => moveInHistory('redo'), [moveInHistory]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // 한글 입력 상태에서도 잡히도록 글자 대신 키 자리로 본다
      if (e.code === 'KeyS') {
        e.preventDefault();
        saveFromButton();
        return;
      }
      if (e.code !== 'KeyZ' && e.code !== 'KeyY') return;
      // 입력창 안에서는 글자 되돌리기를 그대로 쓴다
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="alertdialog"], [role="dialog"]')) return;
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [redo, saveFromButton, undo]);

  // ─── 칸 만들기 ──────────────────────────────────────────
  /** 다른 칸과 겹치지 않는 자리를 찾는다. 새 칸은 옆으로, 이어 붙이는 칸은 아래로 비켜 놓는다 */
  const placeFree = useCallback(
    (x: number, y: number, axis: 'x' | 'y') => {
      const size = frameSize(9 / 16);
      const width = size.width;
      const height = size.height + 60;
      const gap = 32;
      const hit = (left: number, top: number) =>
        rf.getNodes().some((n) => {
          const w = n.measured?.width ?? width;
          const h = n.measured?.height ?? height;
          return left < n.position.x + w + gap && left + width + gap > n.position.x && top < n.position.y + h + gap && top + height + gap > n.position.y;
        });
      let left = x;
      let top = y;
      for (let i = 0; i < 200 && hit(left, top); i++) {
        if (axis === 'x') left += 40;
        else top += 40;
      }
      return { x: Math.round(left), y: Math.round(top) };
    },
    [rf],
  );

  const centerPosition = useCallback(() => {
    const box = wrapperRef.current?.getBoundingClientRect();
    const size = frameSize(9 / 16);
    const center = rf.screenToFlowPosition({
      x: (box?.left ?? 0) + ((box?.width ?? 800) + 268) / 2,
      y: (box?.top ?? 0) + (box?.height ?? 600) * 0.42,
    });
    return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  }, [rf]);

  const makeNode = useCallback(
    (kind: CellKind, position: { x: number; y: number }, preset?: ImagePreset, patch?: Partial<CellData>): CellFlowNode => {
      const existing = rf.getNodes();
      const titles = new Set(existing.map((n) => n.data.title));
      let index = existing.filter((n) => n.type === kind && (kind !== 'image' || (n.data.preset ?? 'scene') === (preset ?? 'scene'))).length + 1;
      while (titles.has(defaultCellData(kind, index, preset).title)) index++;
      return { id: newLocalId('n_'), type: kind, position, selected: true, data: { ...defaultCellData(kind, index, preset), ...patch } };
    },
    [rf],
  );

  const addCell = useCallback(
    (
      kind: CellKind,
      options?: {
        position?: { x: number; y: number };
        preset?: ImagePreset;
        patch?: Partial<CellData>;
        connect?: { source?: string; target?: string };
      },
    ) => {
      const base = options?.position ?? centerPosition();
      const node = makeNode(kind, placeFree(base.x, base.y, options?.connect ? 'y' : 'x'), options?.preset, options?.patch);
      setNodes((list) => [...list.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
      if (options?.connect) {
        const source = options.connect.source ?? node.id;
        const target = options.connect.target ?? node.id;
        setEdges((list) => [...list, { id: newLocalId('e_'), source, target, type: 'link' }]);
      }
      return node;
    },
    [centerPosition, makeNode, placeFree, setEdges, setNodes],
  );

  // ─── 선 잇기 ────────────────────────────────────────────
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const source = rf.getNode(c.source);
      const target = rf.getNode(c.target);
      if (!source || !target || !source.type || !target.type) return false;
      if (!canConnect(source.type, target.type)) return false;
      const all = rf.getEdges();
      if (all.some((e) => e.source === c.source && e.target === c.target)) return false;
      return !createsCycle(all, c.source, c.target);
    },
    [rf],
  );

  const connect = useCallback(
    (source: string, target: string) => {
      setEdges((list) => addEdge({ id: newLocalId('e_'), source, target, type: 'link' }, list));
    },
    [setEdges],
  );

  const onConnect = useCallback((c: Connection) => connect(c.source, c.target), [connect]);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid || !state.fromNode || !state.fromHandle) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const under = document.elementFromPoint(point.clientX, point.clientY);
      const nodeEl = under?.closest<HTMLElement>('.react-flow__node');
      const fromIsSource = state.fromHandle.type === 'source';

      if (nodeEl?.dataset.id) {
        // 연결점이 아니라 칸 위에 놓아도 이어 준다
        const otherId = nodeEl.dataset.id;
        const source = fromIsSource ? state.fromNode.id : otherId;
        const target = fromIsSource ? otherId : state.fromNode.id;
        if (source === target) return;
        if (isValidConnection({ source, target, sourceHandle: null, targetHandle: null })) {
          connect(source, target);
          return;
        }
        const a = rf.getNode(source);
        const b = rf.getNode(target);
        if (rf.getEdges().some((e) => e.source === source && e.target === target)) {
          setToast('이미 이어져 있어요.');
        } else if (a?.type && b?.type && canConnect(a.type, b.type)) {
          setToast('뒤 칸에서 앞 칸으로 되돌아가게 이을 수는 없어요.');
        } else if (a?.type && b?.type) {
          setToast(connectionProblem(a.type, b.type));
        }
        return;
      }
      if (!under?.closest('.react-flow__pane')) return;
      if (fromIsSource) {
        setNextMenu({
          x: point.clientX,
          y: point.clientY,
          sourceId: state.fromNode.id,
          flowPosition: rf.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        });
      } else {
        setPicker({ mode: 'connect', targetId: state.fromNode.id });
      }
    },
    [connect, isValidConnection, rf],
  );

  const removeEdge = useCallback((edgeId: string) => setEdges((list) => list.filter((e) => e.id !== edgeId)), [setEdges]);

  const reorderRefs = useCallback(
    (targetId: string, from: number, to: number) => {
      setEdges((list) => {
        const mine = list.filter((e) => e.target === targetId);
        const moved = [...mine];
        const [item] = moved.splice(from, 1);
        moved.splice(to, 0, item);
        let cursor = 0;
        return list.map((e) => (e.target === targetId ? moved[cursor++] : e));
      });
    },
    [setEdges],
  );

  // ─── 참조 사진 ──────────────────────────────────────────
  const fileToCell = (entry: FileEntry) => ({ name: entry.name, originalName: entry.originalName, width: entry.width, height: entry.height });

  const uploadFile = useCallback(
    async (file: File): Promise<FileEntry> => {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ file: FileEntry }>(`/api/projects/${projectId}/files`, { method: 'POST', body: form });
      return res.file;
    },
    [projectId],
  );

  const refPositionFor = useCallback(
    (targetId: string) => {
      const target = rf.getNode(targetId);
      if (!target) return centerPosition();
      const count = rf.getEdges().filter((e) => e.target === targetId).length;
      return { x: target.position.x - 240 - 120, y: target.position.y + count * 56 };
    },
    [centerPosition, rf],
  );

  const placeRef = useCallback(
    (patch: Partial<CellData>, target: PickerTarget | null, position?: { x: number; y: number }) => {
      if (target?.mode === 'fill') {
        rf.updateNodeData(target.nodeId, patch);
        return;
      }
      if (target?.mode === 'connect') {
        addCell('ref', { position: refPositionFor(target.targetId), patch, connect: { target: target.targetId } });
        return;
      }
      addCell('ref', { position, patch });
    },
    [addCell, refPositionFor, rf],
  );

  const uploadInto = useCallback(
    (target: PickerTarget | null, multiple: boolean) => {
      pickFiles(multiple, async (files) => {
        for (const file of files) {
          try {
            placeRef({ file: fileToCell(await uploadFile(file)) }, target);
          } catch (e) {
            setToast((e as Error).message);
          }
        }
      });
    },
    [placeRef, uploadFile],
  );

  // ─── 자산 쓰기 ──────────────────────────────────────────
  type CopyResponse = {
    file: FileEntry;
    asset?: { type: AssetType; title: string };
    video?: { libraryId: string; title: string };
    talent?: { libraryId: string; title: string; variant: ModelVariant };
  };

  const applyAsset = useCallback(
    async (payload: AssetPayload, target: PickerTarget | null, position?: { x: number; y: number }) => {
      try {
        if (payload.kind === 'rule') {
          onSetRule(payload.rule.id);
          setToast(`이 프로젝트는 '${payload.rule.title}' 규칙을 따라요.`);
          return;
        }
        if (payload.kind === 'idea' || payload.kind === 'storyboard') {
          const scenarioPatch: Partial<CellData> =
            payload.kind === 'idea'
              ? {
                  title: payload.idea.title,
                  logline: payload.idea.logline,
                  scenario: [payload.idea.hook && `훅: ${payload.idea.hook}`, ...payload.idea.beats].filter(Boolean).join('\n'),
                  total: parseFloat(payload.idea.length) || 15,
                }
              : { title: payload.board.title, scenario: payload.board.scenario, total: payload.board.total };
          const scenario = addCell('scenario', { position, patch: scenarioPatch });
          if (payload.kind === 'storyboard') {
            const board = addCell('storyboard', {
              position: { x: scenario.position.x + 320, y: scenario.position.y },
              patch: { cuts: payload.board.shots.length, total: payload.board.total, aspect: payload.board.aspect },
              connect: { source: scenario.id },
            });
            editShots(
              board.id,
              payload.board.shots.map((shot, index) => ({
                no: index + 1,
                seconds: shot.seconds,
                scene: shot.scene,
                action: shot.action,
                camera: shot.camera,
                tension: 30,
                must: [],
              })),
            );
          }
          return;
        }
        const body =
          payload.kind === 'model'
            ? { fromModel: payload.model.id, variant: 'rep' }
            : payload.kind === 'video'
              ? { fromVideo: payload.video.id }
              : payload.asset.libraryId
                ? { fromLibrary: payload.asset.libraryId }
                : { fromProject: payload.asset.projectId, name: payload.asset.name };
        const res = await api<CopyResponse>(`/api/projects/${projectId}/files`, { method: 'POST', body });
        const patch: Partial<CellData> = { file: fileToCell(res.file) };
        if (payload.kind === 'model') {
          patch.talent = res.talent;
          patch.role = 'character';
          patch.title = payload.model.title;
        } else if (payload.kind === 'video') {
          patch.video = res.video;
          patch.title = payload.video.title.slice(0, 24);
        } else {
          patch.role = payload.asset.type;
          patch.title = payload.asset.title.slice(0, 24);
        }
        placeRef(patch, target, position);
      } catch (e) {
        setToast((e as Error).message);
      }
    },
    [addCell, editShots, onSetRule, placeRef, projectId],
  );

  const setModelVariant = useCallback(
    async (nodeId: string, variant: ModelVariant) => {
      const node = rf.getNode(nodeId);
      if (!node?.data.talent) return;
      try {
        const res = await api<CopyResponse>(`/api/projects/${projectId}/files`, {
          method: 'POST',
          body: { fromModel: node.data.talent.libraryId, variant },
        });
        rf.updateNodeData(nodeId, { file: fileToCell(res.file), talent: res.talent });
      } catch (e) {
        setToast((e as Error).message);
      }
    },
    [projectId, rf],
  );

  const saveAsset = useCallback(
    async (fileName: string, title: string, type: AssetType) => {
      try {
        await api('/api/library', { method: 'POST', body: { fromProject: projectId, name: fileName, type, title } });
        await refreshLibrary();
        setToast('자산으로 저장했어요. 왼쪽 자산 판에서 다시 쓸 수 있어요.');
      } catch (e) {
        setToast((e as Error).message);
      }
    },
    [projectId, refreshLibrary],
  );

  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes(ASSET_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (!types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setFileOver(true);
  };

  const onDrop = async (e: React.DragEvent) => {
    setFileOver(false);
    const nodeEl = (e.target as Element).closest<HTMLElement>('.react-flow__node');
    const overNode = nodeEl?.dataset.id ? rf.getNode(nodeEl.dataset.id) : undefined;
    const drop = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

    const assetJson = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetJson) {
      e.preventDefault();
      const payload = JSON.parse(assetJson) as AssetPayload;
      const media = payload.kind === 'image' || payload.kind === 'model' || payload.kind === 'video';
      if (media && overNode?.type === 'ref' && !overNode.data.file) {
        await applyAsset(payload, { mode: 'fill', nodeId: overNode.id });
      } else if (media && overNode && (overNode.type === 'image' || overNode.type === 'storyboard' || overNode.type === 'video')) {
        await applyAsset(payload, { mode: 'connect', targetId: overNode.id });
      } else {
        await applyAsset(payload, null, drop);
      }
      return;
    }

    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) {
      setToast('JPG, PNG, WEBP 사진만 올릴 수 있어요.');
      return;
    }
    let offset = 0;
    for (const file of files) {
      try {
        const patch = { file: fileToCell(await uploadFile(file)) };
        if (overNode?.type === 'ref' && !overNode.data.file && offset === 0) {
          placeRef(patch, { mode: 'fill', nodeId: overNode.id });
        } else if (overNode && overNode.type !== 'ref' && overNode.type !== 'scenario' && overNode.type !== 'shot') {
          placeRef(patch, { mode: 'connect', targetId: overNode.id });
        } else {
          placeRef(patch, null, { x: drop.x + offset, y: drop.y + offset });
        }
        offset += 36;
      } catch (err) {
        setToast((err as Error).message);
      }
    }
  };

  // ─── 대기열 ─────────────────────────────────────────────
  const queueNodes = useCallback(
    async (ids: string[], allowDirect: boolean) => {
      try {
        await saveNow();
        const res = await api<{
          created: Job[];
          skipped: { title: string; reason: string }[];
          errors: { title: string; message: string }[];
          jobs: Job[];
          stats: CostStats;
          boards: Record<string, Board>;
        }>(`/api/projects/${projectId}/jobs`, { method: 'POST', body: { canvasId, nodeIds: ids, allowDirect } });
        onJobs(res.jobs, res.stats);
        onBoards(res.boards);
        if (res.errors.length) {
          setToast(res.errors.length > 1 ? `${res.errors[0].message} 외 ${res.errors.length - 1}칸` : res.errors[0].message);
        } else if (!res.created.length && res.skipped.length) {
          setToast(res.skipped[0].reason);
        }
      } catch (e) {
        setToast((e as Error).message);
      }
    },
    [canvasId, onBoards, onJobs, projectId, saveNow],
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      try {
        const res = await api<{ jobs: Job[]; stats: CostStats }>(`/api/projects/${projectId}/jobs/${jobId}`, { method: 'DELETE' });
        onJobs(res.jobs, res.stats);
      } catch (e) {
        setToast((e as Error).message);
      }
    },
    [onJobs, projectId],
  );

  const onBeforeDelete = useCallback<OnBeforeDelete<CellFlowNode, Edge>>(
    async ({ nodes: removing }) => {
      if (!removing.length) return true;
      const states = removing.map((n) => jobIndex.latestByNode.get(n.id));
      if (states.some((job) => job?.status === 'running')) {
        setToast('생성 중인 칸은 지울 수 없어요.');
        return false;
      }
      const queued = states.filter((job): job is Job => job?.status === 'queued');
      const withResult = removing.filter((n) => jobIndex.doneByNode.has(n.id));
      if (queued.length || withResult.length) {
        const lines: string[] = [];
        if (withResult.length) lines.push('결과 파일은 지워지지 않고 갤러리에 남아요.');
        if (queued.length) lines.push(`대기 중인 ${queued.length}칸은 취소돼요.`);
        const ok = await confirm({ title: `${removing.length}칸을 지울까요?`, body: lines.join('\n'), confirmLabel: '지우기', danger: true });
        if (!ok) return false;
        for (const job of queued) await cancelJob(job.id);
      }
      return true;
    },
    [cancelJob, confirm, jobIndex],
  );

  // ─── 스토리보드를 샷으로 나누기 ───────────────────────────
  const shotNodesOf = useCallback((boardId: string) => rf.getNodes().filter((n) => n.type === 'shot' && n.data.boardId === boardId), [rf]);

  const focusShots = useCallback(
    (boardId: string) => {
      const row = rf.getNodes().filter((n) => n.id === boardId || (n.data.boardId === boardId && n.data.shotNo === 1));
      void rf.fitView({ nodes: row.map((n) => ({ id: n.id })), duration: 260, padding: FIT_PADDING, maxZoom: 1 });
    },
    [rf],
  );

  const splitBoard = useCallback(
    (boardId: string) => {
      const boardNode = rf.getNode(boardId);
      const shots = boards[boardId]?.shots ?? [];
      if (!boardNode || !shots.length) {
        setToast('샷 표를 먼저 채워 주세요.');
        return;
      }
      if (shotNodesOf(boardId).length) {
        focusShots(boardId);
        return;
      }
      const width = boardNode.measured?.width ?? boardCellWidth(shots.length, boardNode.data.aspect);
      const split = splitBoardCells({ id: boardId, position: boardNode.position, width, data: boardNode.data }, shots, newLocalId);
      setNodes((list) => [...list.map((n) => (n.selected ? { ...n, selected: false } : n)), ...split.nodes]);
      setEdges((list) => [...list, ...split.edges.map((e) => ({ ...e, type: 'link' }))]);
      setStepFocus(3);
      setTimeout(() => focusShots(boardId), 80);
    },
    [boards, focusShots, rf, setEdges, setNodes, shotNodesOf],
  );

  // ─── 정렬 ───────────────────────────────────────────────
  const tidy = useCallback(() => {
    const all = rf.getNodes();
    const picked = all.filter((n) => n.selected);
    const target = picked.length >= 2 ? picked : all;
    if (target.length < 2) return;
    const ids = target.map((n) => n.id);
    const allEdges = rf.getEdges();
    const level = levels(ids, allEdges);
    const order = new Map(topoOrder(ids, allEdges).map((id, index) => [id, index]));
    const columns = new Map<number, CellFlowNode[]>();
    for (const node of target) {
      const column = level.get(node.id) ?? 0;
      columns.set(column, [...(columns.get(column) ?? []), node]);
    }
    const originX = Math.min(...target.map((n) => n.position.x));
    const originY = Math.min(...target.map((n) => n.position.y));
    const placed = new Map<string, { x: number; y: number }>();
    let x = originX;
    for (const column of [...columns.keys()].sort((a, b) => a - b)) {
      const list = (columns.get(column) as CellFlowNode[]).sort(
        (a, b) => (a.data.shotNo ?? 0) - (b.data.shotNo ?? 0) || a.position.y - b.position.y || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
      let y = originY;
      let widest = 0;
      for (const node of list) {
        placed.set(node.id, { x, y });
        y += (node.measured?.height ?? 300) + 44;
        widest = Math.max(widest, node.measured?.width ?? 240);
      }
      x += widest + 110;
    }
    setNodes((list) => list.map((n) => (placed.has(n.id) ? { ...n, position: placed.get(n.id) as { x: number; y: number } } : n)));
    if (picked.length < 2) setTimeout(() => void rf.fitView({ duration: 240, padding: FIT_PADDING, maxZoom: 1 }), 60);
  }, [rf, setNodes]);

  // ─── 7단계 ──────────────────────────────────────────────
  const steps = useMemo(() => {
    const scenarios = nodes.filter((n) => n.type === 'scenario');
    const sheets = nodes.filter((n) => n.type === 'ref' || (n.type === 'image' && (n.data.preset === 'character' || n.data.preset === 'background')));
    const storyboards = nodes.filter((n) => n.type === 'storyboard');
    const cards = nodes.filter((n) => n.type === 'shot' || (n.type === 'image' && !!n.data.shotNo));
    const clips = nodes.filter((n) => n.type === 'video' && !n.data.stage);
    const edits = nodes.filter((n) => !!n.data.stage);
    const finals = nodes.filter((n) => n.data.stage === 'final');
    const done = computeSteps(nodes, (id) => jobIndex.doneByNode.has(id), boards);
    return { done, groups: [scenarios, sheets, storyboards, cards, clips, edits, finals.length ? finals : edits] };
  }, [boards, jobIndex, nodes]);

  const firstOpenStep = steps.done.findIndex((value) => !value);
  const currentStep = stepFocus ?? (firstOpenStep < 0 ? steps.done.length - 1 : firstOpenStep);

  const goStep = (index: number) => {
    setStepFocus(index);
    const group = steps.groups[index];
    if (group.length) {
      void rf.fitView({ nodes: group.map((n) => ({ id: n.id })), duration: 260, padding: FIT_PADDING, maxZoom: 1 });
      // 편집·완성은 할 일이 칸의 창에 있어서 바로 골라 둔다
      if (index >= 5) setNodes((list) => list.map((n) => ({ ...n, selected: n.id === group[group.length - 1].id })));
      return;
    }
    if (index === 0) addCell('scenario');
    else if (index === 1) addCell('image', { preset: 'character' });
    else if (index === 2) {
      const sources = nodes.filter((n) => n.type === 'scenario' || n.type === 'ref' || (n.type === 'image' && n.data.preset !== 'scene'));
      const board = addCell('storyboard');
      if (sources.length) setEdges((list) => [...list, ...sources.map((s) => ({ id: newLocalId('e_'), source: s.id, target: board.id, type: 'link' }))]);
    } else if (index === 3 || index === 4) setToast('스토리보드를 먼저 뽑아 확인한 뒤 샷으로 나눠 주세요.');
    else if (index === 5) setToast('대화에서 “합쳐 줘”라고 하시면 영상, 음악, 로고를 합쳐 편집본 칸을 만들어 드려요.');
    else setToast('편집본이 생기면 여기서 완성으로 등록할 수 있어요.');
  };

  // ─── 선택 ───────────────────────────────────────────────
  const selected = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const single = selected.length === 1 && !selected[0].dragging ? selected[0] : null;
  const generable = useMemo(
    () =>
      selected.filter((n) => {
        if (n.type === 'ref' || n.type === 'scenario' || n.type === 'shot') return false;
        const status = jobIndex.latestByNode.get(n.id)?.status;
        if (status === 'queued' || status === 'running') return false;
        if (n.data.boardId && n.data.shotNo) return true;
        if (n.type === 'storyboard') return (boards[n.id]?.shots.length ?? 0) > 0 || !!n.data.prompt?.trim();
        return promptOf(n.type as CellKind, n.data).length > 0;
      }),
    [boards, jobIndex, selected],
  );

  const selectionSummary = useMemo(() => {
    let credits = 0;
    let krw = 0;
    for (const node of generable) {
      const cost = estimateCell(node.type as CellKind, node.data);
      if (cost?.unit === 'credit') credits += cost.amount;
      if (cost?.unit === 'krw') krw += cost.amount;
    }
    const parts: string[] = [];
    if (credits) parts.push(`예상 ${formatNumber(credits)}크레딧`);
    if (krw) parts.push(`약 ₩${formatNumber(krw)}`);
    return parts.join(' · ');
  }, [generable]);

  const generateSelection = async () => {
    const ids = generable.map((n) => n.id);
    const direct = generable.filter((n) => n.type !== 'video' && ENGINE_INFO[n.data.engine ?? 'higgsfield'].direct);
    if (direct.length) {
      const krw = direct.reduce((sum, n) => sum + (estimateCell(n.type as CellKind, n.data)?.amount ?? 0), 0);
      const queued = generable.length - direct.length;
      const ok = await confirm({
        title: '바로 생성할까요?',
        body: `제미나이·GPT ${direct.length}장, 약 ₩${formatNumber(krw)}이 바로 결제돼요.` + (queued ? `\n힉스필드 대기열 ${queued}칸은 대화에서 승인받은 뒤 생성돼요.` : ''),
        confirmLabel: '생성',
      });
      if (!ok) return;
    }
    await queueNodes(ids, direct.length > 0);
  };

  const activeRule = useMemo(() => library?.rules.find((r) => r.id === project.ruleId) ?? library?.rules[0] ?? null, [library, project.ruleId]);

  const editorApi = useMemo<EditorApi>(
    () => ({
      projectId,
      canvasId,
      engines,
      balance,
      rule: activeRule,
      rules: library?.rules ?? [],
      setRule: onSetRule,
      latestJob: (id) => jobIndex.latestByNode.get(id),
      latestDone: (id) => jobIndex.doneByNode.get(id),
      board: (id) => boards[id],
      setShots: editShots,
      historyVersion: historyState.version,
      openLightbox: setLightbox,
      openPicker: setPicker,
      openNextMenu: (sourceId, x, y) => setNextMenu({ x, y, sourceId }),
      uploadTo: (nodeId) => uploadInto({ mode: 'fill', nodeId }, false),
      queueNodes,
      cancelJob,
      splitBoard,
      focusShots,
      hasShots: (id) => shotNodesOf(id).length > 0,
      saveAsset,
      setModelVariant: (nodeId, variant) => void setModelVariant(nodeId, variant),
      setStage,
    }),
    [activeRule, balance, boards, canvasId, cancelJob, editShots, engines, focusShots, historyState.version, jobIndex, library, onSetRule, projectId, queueNodes, saveAsset, setModelVariant, setStage, shotNodesOf, splitBoard, uploadInto],
  );

  const nextOptions = (sourceId: string | undefined): ('shot' | 'image' | 'video')[] => {
    const kind = sourceId ? rf.getNode(sourceId)?.type : undefined;
    if (kind === 'storyboard') return ['shot', 'image', 'video'];
    return ['image', 'video'];
  };

  const chooseNext = (kind: 'shot' | 'image' | 'video') => {
    if (!nextMenu) return;
    const source = rf.getNode(nextMenu.sourceId);
    if (!source) return;
    const sourceWidth = source.measured?.width ?? frameSize(9 / 16).width;
    const position = nextMenu.flowPosition ?? { x: source.position.x + sourceWidth + 140, y: source.position.y };
    addCell(kind, { position, preset: kind === 'image' ? 'scene' : undefined, connect: { source: source.id } });
    setNextMenu(null);
  };

  const focusJob = (job: Job) => {
    if (job.canvasId !== canvasId) {
      switchCanvasGuarded(job.canvasId);
      return;
    }
    if (!rf.getNode(job.nodeId)) {
      setToast('이 칸은 지워졌어요.');
      return;
    }
    setNodes((list) => list.map((n) => ({ ...n, selected: n.id === job.nodeId })));
    void rf.fitView({ nodes: [{ id: job.nodeId }], duration: 240, maxZoom: 1, padding: 0.6 });
  };

  const openVideo = (video: LibraryVideo) =>
    setLightbox({ url: videoUrl(video.id), kind: 'video', title: video.title, poster: video.poster || undefined, meta: video.project, note: video.summary });

  const draft = project.modelDraft;
  const saveModel = async () => {
    try {
      await saveNow();
      const res = await api<{ model: { title: string } }>(`/api/projects/${projectId}/save-model`, { method: 'POST' });
      const fresh = await api<{ project: Project }>(`/api/projects/${projectId}`);
      onProject(fresh.project);
      await refreshLibrary();
      setToast(`'${res.model.title}'을 내 모델로 저장했어요. 자산의 캐릭터에서 쓸 수 있어요.`);
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const dockOpen = true;

  return (
    <EditorContext.Provider value={editorApi}>
      <div
        ref={wrapperRef}
        className="relative h-full w-full overflow-hidden bg-[#08080b]"
        onDragOver={onDragOver}
        onDrop={(e) => void onDrop(e)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false);
        }}
      >
        <ReactFlow<CellFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode="dark"
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onBeforeDelete={onBeforeDelete}
          isValidConnection={isValidConnection}
          onMoveEnd={(_, viewport) => {
            viewportRef.current = viewport;
          }}
          defaultViewport={doc.viewport ?? { x: 0, y: 0, zoom: 1 }}
          fitView={!doc.viewport && doc.nodes.length > 0}
          fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1, nodes: initialFitNodes(doc) }}
          minZoom={0.1}
          maxZoom={3}
          className={tool === 'hand' ? 'hand-tool' : ''}
          selectionOnDrag={tool === 'select'}
          panOnDrag={tool === 'select' ? [1, 2] : true}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
          selectionKeyCode={tool === 'hand' ? 'Shift' : null}
          panActivationKeyCode="Space"
          deleteKeyCode={['Backspace', 'Delete']}
          selectNodesOnDrag={false}
          connectOnClick={false}
          zoomOnDoubleClick={false}
          nodeClickDistance={4}
          paneClickDistance={4}
          nodeDragThreshold={3}
          connectionRadius={28}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
          {selected.length >= 2 ? (
            <SelectionBar
              count={selected.length}
              summary={selectionSummary}
              canGenerate={generable.length > 0}
              dockOffset={dockOpen}
              onGenerate={() => void generateSelection()}
              onTidy={tidy}
              onDelete={() => void rf.deleteElements({ nodes: selected.map((n) => ({ id: n.id })) })}
            />
          ) : null}
          {single && (single.type === 'image' || single.type === 'video') ? (
            <PromptPanel key={`${single.id}:${historyState.version}`} node={single} nodes={nodes} edges={edges} container={wrapperRef} onRemoveEdge={removeEdge} onReorderRefs={reorderRefs} />
          ) : null}
          {single && single.type === 'storyboard' ? (
            <StoryboardPanel key={`${single.id}:${historyState.version}`} node={single} nodes={nodes} edges={edges} container={wrapperRef} onRemoveEdge={removeEdge} onReorderRefs={reorderRefs} />
          ) : null}
          {single && single.type === 'scenario' ? <ScenarioPanel key={`${single.id}:${historyState.version}`} node={single} container={wrapperRef} /> : null}
          {single && single.type === 'ref' ? <RefPanel key={`${single.id}:${historyState.version}`} node={single} container={wrapperRef} /> : null}
        </ReactFlow>

        {/* 캔버스 메뉴가 자산 판 위로 펼쳐지도록 자산 판보다 위에 둔다 */}
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-[7] flex gap-3 [&>*]:pointer-events-auto">
          <ProjectChip
            project={project}
            canvasId={canvasId}
            saveState={saveState}
            onSave={saveFromButton}
            onLeave={() => askBeforeLeaving(() => router.push('/'))}
            onRename={onRename}
            onSwitchCanvas={switchCanvasGuarded}
            onCreateCanvas={createCanvasGuarded}
            onRenameCanvas={onRenameCanvas}
          />
          <StepBar done={steps.done} current={currentStep} onStep={goStep} />
          <MoneyChip
            stats={stats}
            balance={balance}
            fake={engines.fake}
            pendingCount={pending}
            queueOpen={queueOpen}
            onToggleQueue={() => setQueueOpen((open) => !open)}
          />
        </div>

        <AssetDock
          library={library}
          activeRuleId={activeRule?.id}
          onUse={(payload) => void applyAsset(payload, null)}
          onOpenVideo={openVideo}
        />

        <ToolDock
          tool={tool}
          dockOffset={dockOpen}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onUndo={undo}
          onRedo={redo}
          onTool={setTool}
          onAdd={(kind, preset) => {
            addCell(kind, { preset });
          }}
          onTidy={tidy}
        />

        {draft ? (
          <div className="floating absolute left-[calc(50%+134px)] top-[86px] z-[6] flex -translate-x-1/2 items-center gap-3 py-2 pl-4 pr-2 text-[13px]" data-bar="model-draft">
            <span className="whitespace-nowrap text-ink-2">
              새 모델 <b className="font-semibold text-ink">{draft.title}</b> · 모델 시트를 뽑은 뒤 저장하면 칸별로 잘라 내 모델이 돼요
            </span>
            <button type="button" className="btn btn-primary h-8" onClick={() => void saveModel()}>
              {draft.savedId ? '모델 다시 저장' : '모델로 저장'}
            </button>
          </div>
        ) : null}

        {nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center pl-[268px]">
            <div className="text-center">
              <p className="text-[16px] font-semibold text-ink">시나리오부터 시작해 보세요</p>
              <p className="mt-1.5 text-[14px] leading-[1.6] text-ink-2">
                위쪽 7단계를 차례로 누르면 칸이 만들어져요.
                <br />
                왼쪽 자산을 끌어다 놓거나, 사진 파일을 끌어다 놓아도 돼요.
              </p>
            </div>
          </div>
        ) : null}

        {queueOpen ? (
          <QueueDrawer jobs={jobs} project={project} canvasId={canvasId} onCancel={(id) => void cancelJob(id)} onFocus={focusJob} onClose={() => setQueueOpen(false)} />
        ) : null}

        {fileOver ? (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#818cf8] bg-brand-soft">
            <p className="floating px-4 py-2 text-[14px] font-semibold text-brand-dark">여기에 놓으면 참조 사진이 돼요</p>
          </div>
        ) : null}
      </div>

      {/* 칸을 끌고 잇는 일은 작은 화면에서 어렵다. 태블릿부터 연다 */}
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[#08080b] p-6 text-center md:hidden">
        <p className="text-[15px] font-semibold text-ink">캔버스는 태블릿 이상에서 열어 주세요</p>
        <p className="text-[13px] leading-[1.6] text-ink-2">폰에서는 프로젝트 목록과 갤러리, CF 레퍼런스를 볼 수 있어요.</p>
        <button type="button" className="btn btn-line h-10 px-5" onClick={() => router.push('/')}>
          프로젝트 목록으로
        </button>
      </div>

      {nextMenu ? <NextMenu x={nextMenu.x} y={nextMenu.y} options={nextOptions(nextMenu.sourceId)} onChoose={chooseNext} onClose={() => setNextMenu(null)} /> : null}
      {picker ? (
        <RefPicker
          onUpload={() => {
            const target = picker;
            setPicker(null);
            uploadInto(target, target.mode === 'connect');
          }}
          onPickAsset={(asset) => {
            const target = picker;
            setPicker(null);
            void applyAsset({ kind: 'image', asset }, target);
          }}
          onPickModel={(model) => {
            const target = picker;
            setPicker(null);
            void applyAsset({ kind: 'model', model }, target);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {lightbox ? <Lightbox item={lightbox} onClose={() => setLightbox(null)} /> : null}
      {confirmRequest ? <ConfirmDialog request={confirmRequest} /> : null}
      {toast ? <Toast message={toast} onDone={clearToast} /> : null}
    </EditorContext.Provider>
  );
}
