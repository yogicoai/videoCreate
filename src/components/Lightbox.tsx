'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export type LightboxItem = {
  url: string;
  kind: 'image' | 'video';
  title: string;
  meta?: string;
  /** 영상이 뜨기 전에 보여 줄 대표 그림 */
  poster?: string;
  /** 아래에 덧붙이는 설명 */
  note?: string;
};

export function Lightbox({ item, onClose }: { item: LightboxItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-14 flex-none items-center gap-3 px-5 text-white">
        <p className="truncate text-[14px] font-semibold">{item.title}</p>
        {item.meta ? <p className="truncate text-[13px] text-white/60">{item.meta}</p> : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="ml-auto flex h-9 w-9 flex-none items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-5 pb-5"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {item.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.title} className="max-h-full max-w-full rounded-lg object-contain" />
        ) : (
          <video src={item.url} poster={item.poster} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg bg-black" />
        )}
      </div>
      {item.note ? (
        <p className="thin-scroll mx-auto mb-5 max-h-[96px] w-full max-w-[860px] flex-none overflow-y-auto whitespace-pre-line px-5 text-[13px] leading-[1.6] text-white/70">
          {item.note}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
