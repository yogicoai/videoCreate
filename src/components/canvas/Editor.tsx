'use client';

import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import type { BalanceInfo, Board, BoardShot, CanvasDoc, CostStats, EngineStatus, Job, LibraryView, Project } from '@/lib/types';
import { patchProject } from './Bars';
import { FlowCanvas } from './FlowCanvas';

const POLL_MS = 2500;

/** 프로젝트 화면. 캔버스 전환과 생성 상태·샷 표·자산 읽기를 맡는다 */
export function Editor({
  initialProject,
  initialCanvas,
  initialJobs,
  initialStats,
  initialBoards,
  initialBalance,
  engines,
}: {
  initialProject: Project;
  initialCanvas: CanvasDoc;
  initialJobs: Job[];
  initialStats: CostStats;
  initialBoards: Record<string, Board>;
  initialBalance: BalanceInfo;
  engines: EngineStatus;
}) {
  const [project, setProject] = useState(initialProject);
  const [canvas, setCanvas] = useState(initialCanvas);
  const [jobs, setJobs] = useState(initialJobs);
  const [stats, setStats] = useState(initialStats);
  const [boards, setBoards] = useState(initialBoards);
  const [balance, setBalance] = useState(initialBalance);
  const [library, setLibrary] = useState<LibraryView | null>(null);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const lastJobsJson = useRef(JSON.stringify(initialJobs));

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await api<LibraryView>('/api/library'));
    } catch {
      // 다음에 다시 읽는다
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refreshLibrary(), 0);
    return () => clearTimeout(timer);
  }, [refreshLibrary]);

  const applyJobs = useCallback((nextJobs: Job[], nextStats: CostStats) => {
    const json = JSON.stringify(nextJobs);
    if (json === lastJobsJson.current) return; // 그대로면 칸을 다시 그리지 않는다
    lastJobsJson.current = json;
    setJobs(nextJobs);
    setStats(nextStats);
  }, []);

  // 저장한 샷 표와 시트 조각이다. 화면에서 고치는 중인 샷 표는 캔버스 쪽에 따로 있어서 덮이지 않는다
  const applyBoards = useCallback((next: Record<string, Board>) => {
    setBoards((current) => {
      let changed = false;
      const merged = { ...current };
      for (const [nodeId, board] of Object.entries(next)) {
        if (current[nodeId]?.updatedAt !== board.updatedAt) {
          merged[nodeId] = board;
          changed = true;
        }
      }
      return changed ? merged : current;
    });
  }, []);

  // 생성 결과와 샷 표는 서버나 대화 쪽에서 들어오므로 몇 초마다 읽는다
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await api<{ jobs: Job[]; stats: CostStats; boards: Record<string, Board>; balance: BalanceInfo; revisions: Record<string, number> }>(`/api/projects/${project.id}/jobs`);
        if (stopped) return;
        applyJobs(res.jobs, res.stats);
        applyBoards(res.boards);
        setRevisions((current) => (JSON.stringify(current) === JSON.stringify(res.revisions) ? current : res.revisions));
        setBalance((current) => (JSON.stringify(current) === JSON.stringify(res.balance) ? current : res.balance));
      } catch {
        // 다음 차례에 다시 읽는다
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [applyBoards, applyJobs, project.id]);

  const saveShots = useCallback(
    async (nodeId: string, shots: BoardShot[]) => {
      const { board } = await api<{ board: Board }>(`/api/projects/${project.id}/boards/${nodeId}`, { method: 'PUT', body: { shots } });
      setBoards((current) => ({ ...current, [nodeId]: board }));
    },
    [project.id],
  );

  const switchCanvas = useCallback(
    async (canvasId: string) => {
      const res = await api<{ canvas: CanvasDoc }>(`/api/projects/${project.id}/canvases/${canvasId}`);
      setCanvas(res.canvas);
      window.history.replaceState(null, '', `/p/${project.id}?c=${canvasId}`);
    },
    [project.id],
  );

  const createCanvas = useCallback(async () => {
    const res = await api<{ project: Project }>(`/api/projects/${project.id}/canvases`, { method: 'POST', body: {} });
    setProject(res.project);
    await switchCanvas(res.project.canvases[res.project.canvases.length - 1].id);
  }, [project.id, switchCanvas]);

  const renameCanvas = useCallback(
    async (canvasId: string, name: string) => {
      const res = await api<{ project: Project }>(`/api/projects/${project.id}/canvases/${canvasId}`, { method: 'PATCH', body: { name } });
      setProject(res.project);
    },
    [project.id],
  );

  const renameProject = useCallback(
    async (name: string) => {
      const next = await patchProject(project.id, { name });
      setProject(next);
      document.title = `${next.name} · 영상제작`;
    },
    [project.id],
  );

  const setRule = useCallback(
    async (ruleId: string) => {
      setProject(await patchProject(project.id, { ruleId }));
    },
    [project.id],
  );

  return (
    <div className="h-full w-full">
      <ReactFlowProvider key={canvas.id}>
        <FlowCanvas
          key={canvas.id}
          project={project}
          doc={canvas}
          serverRevision={revisions[canvas.id]}
          jobs={jobs}
          stats={stats}
          boards={boards}
          balance={balance}
          engines={engines}
          library={library}
          onJobs={applyJobs}
          onBoards={applyBoards}
          onSaveShots={saveShots}
          refreshLibrary={refreshLibrary}
          onProject={setProject}
          onRename={(name) => void renameProject(name)}
          onSetRule={(id) => void setRule(id)}
          onSwitchCanvas={(id) => void switchCanvas(id)}
          onCreateCanvas={() => void createCanvas()}
          onRenameCanvas={(id, name) => void renameCanvas(id, name)}
        />
      </ReactFlowProvider>
    </div>
  );
}
