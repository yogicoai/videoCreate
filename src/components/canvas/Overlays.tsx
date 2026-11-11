'use client';

import { Clapperboard, ImageIcon, ListChecks, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/client';
import type { AssetView, CellKind, LibraryModel, LibraryView } from '@/lib/types';

/** 다음 칸 만들기 메뉴 */
export function NextMenu({
  x,
  y,
  options,
  onChoose,
  onClose,
}: {
  x: number;
  y: number;
  options: Exclude<CellKind, 'ref' | 'scenario' | 'storyboard'>[];
  onChoose: (kind: Exclude<CellKind, 'ref' | 'scenario' | 'storyboard'>) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const left = Math.min(x, window.innerWidth - 190);
  const top = Math.min(y, window.innerHeight - 170);
  const items = { shot: { label: '샷 카드', Icon: ListChecks }, image: { label: '장면 그림', Icon: ImageIcon }, video: { label: '영상 클립', Icon: Clapperboard } };
  return createPortal(
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <div role="menu" aria-label="다음 칸 만들기" className="floating absolute w-[172px] p-1" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
        <p className="px-2.5 pb-1 pt-1.5 text-[12px] text-ink-3">다음 칸 만들기</p>
        {options.map((kind) => {
          const { label, Icon } = items[kind];
          return (
            <button key={kind} type="button" role="menuitem" className="btn btn-ghost h-9 w-full justify-start font-medium" onClick={() => onChoose(kind)}>
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

/** 참조 고르기: 내 PC에서 올리거나 내 모델·자산에서 고른다 */
export function RefPicker({
  onUpload,
  onPickAsset,
  onPickModel,
  onClose,
}: {
  onUpload: () => void;
  onPickAsset: (asset: AssetView) => void;
  onPickModel: (model: LibraryModel) => void;
  onClose: () => void;
}) {
  const [library, setLibrary] = useState<LibraryView | null>(null);
  const [error, setError] = useState('');
  useEscape(onClose);

  useEffect(() => {
    let alive = true;
    api<LibraryView>('/api/library')
      .then((res) => {
        if (alive) setLibrary(res);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const empty = library && !library.images.length && !library.models.length;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="참조 고르기" className="floating flex max-h-[80vh] w-[680px] max-w-full flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">참조 고르기</h2>
          <button type="button" className="btn btn-primary ml-auto" onClick={onUpload}>
            <Upload size={14} />내 PC에서 올리기
          </button>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="thin-scroll min-h-[220px] flex-1 overflow-y-auto p-4">
          {error ? <p className="text-[13px] text-bad">{error}</p> : null}
          {!library && !error ? <p className="text-[13px] text-ink-3">자산을 불러오고 있어요.</p> : null}
          {empty ? <p className="py-12 text-center text-[13px] text-ink-2">아직 올린 사진이 없어요. 오른쪽 위에서 올려 주세요.</p> : null}
          {library?.models.length ? (
            <>
              <h3 className="mb-2 text-[13px] font-semibold">내 모델</h3>
              <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
                {library.models.map((model) => (
                  <button key={model.id} type="button" onClick={() => onPickModel(model)} aria-label={`${model.title} 고르기`} title={model.identity} className="min-w-0 rounded-lg text-left">
                    <span className="block aspect-[3/4] overflow-hidden rounded-lg bg-inset ring-1 ring-line transition-shadow hover:ring-2 hover:ring-[#818cf8]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={model.rep} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </span>
                    <span className="mt-1.5 block truncate text-[12px] text-ink-2">{model.title}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {library?.images.length ? (
            <>
              <h3 className="mb-2 text-[13px] font-semibold">올린 사진 · 시트</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
                {library.images.map((asset) => (
                  <button key={asset.key} type="button" onClick={() => onPickAsset(asset)} aria-label={`${asset.title} 고르기`} className="min-w-0 rounded-lg text-left">
                    <span className="block aspect-square overflow-hidden rounded-lg bg-inset ring-1 ring-line transition-shadow hover:ring-2 hover:ring-[#818cf8]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={asset.thumb} alt="" loading="lazy" className="h-full w-full object-contain" />
                    </span>
                    <span className="mt-1.5 block truncate text-[12px] text-ink-2">{asset.title}</span>
                    <span className="block truncate text-[11px] text-ink-3">{asset.projectName ?? '자산'}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  /** 왼쪽 버튼 이름. 없으면 취소 */
  cancelLabel?: string;
  danger?: boolean;
  /** Esc나 바깥을 눌러 그냥 닫으면 dismissed 가 참이다 */
  resolve: (ok: boolean, dismissed?: boolean) => void;
};

export function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  useEscape(() => request.resolve(false, true));
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) request.resolve(false, true);
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-label={request.title} className="floating w-[400px] max-w-full p-5">
        <h2 className="text-[16px] font-semibold">{request.title}</h2>
        <p className="mt-2 whitespace-pre-line text-[14px] leading-[1.6] text-ink-2">{request.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-line h-9" onClick={() => request.resolve(false)}>
            {request.cancelLabel ?? '취소'}
          </button>
          <button type="button" autoFocus className={`btn h-9 ${request.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => request.resolve(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4200);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div
      role="status"
      className="floating fixed bottom-[84px] left-1/2 z-40 max-w-[560px] -translate-x-1/2 px-4 py-2.5 text-[13px] font-medium leading-[1.5] text-ink"
    >
      {message}
    </div>
  );
}

function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);
}
