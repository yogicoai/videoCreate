'use client';

import type { Node } from '@xyflow/react';
import { createContext, useContext } from 'react';
import type { BalanceInfo, Board, BoardShot, CellData, CellKind, EngineStatus, Job, LibraryRule, ModelVariant } from '@/lib/types';
import type { LightboxItem } from '../Lightbox';

export type CellFlowNode = Node<CellData, CellKind>;

/** 전체 보기 여백. 위아래 막대와 왼쪽 자산 판에 칸이 가려지지 않게 비워 둔다 */
export const FIT_PADDING = { top: '96px', right: '40px', bottom: '84px', left: '290px' } as const;

/** 참조를 어디에 넣을지. 뒤 칸에 잇기 · 빈 참조 칸 채우기 */
export type PickerTarget = { mode: 'connect'; targetId: string } | { mode: 'fill'; nodeId: string };

export type EditorApi = {
  projectId: string;
  canvasId: string;
  engines: EngineStatus;
  balance: BalanceInfo;
  rule: LibraryRule | null;
  rules: LibraryRule[];
  setRule: (ruleId: string) => void;
  latestJob: (nodeId: string) => Job | undefined;
  latestDone: (nodeId: string) => Job | undefined;
  board: (nodeId: string) => Board | undefined;
  setShots: (nodeId: string, shots: BoardShot[]) => void;
  openLightbox: (item: LightboxItem) => void;
  openPicker: (target: PickerTarget) => void;
  openNextMenu: (sourceId: string, x: number, y: number) => void;
  /** 내 PC에서 사진을 골라 참조 칸을 채운다 */
  uploadTo: (nodeId: string) => void;
  queueNodes: (ids: string[], allowDirect: boolean) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  /** 시트를 샷 카드·장면·영상 칸으로 나눈다 */
  splitBoard: (nodeId: string) => void;
  focusShots: (nodeId: string) => void;
  hasShots: (nodeId: string) => boolean;
  /** 사진을 자산으로 저장한다 */
  saveAsset: (fileName: string, title: string, type: 'character' | 'product' | 'background' | 'other') => Promise<void>;
  setModelVariant: (nodeId: string, variant: ModelVariant) => void;
  /** 편집본을 완성본으로 올리거나 되돌린다 */
  setStage: (nodeId: string, stage: 'edit' | 'final') => void;
  /** 되돌리기·다시 하기를 할 때마다 오른다. 입력창이 자기 글을 다시 읽게 한다 */
  historyVersion: number;
};

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const value = useContext(EditorContext);
  if (!value) throw new Error('EditorContext 가 없습니다');
  return value;
}
