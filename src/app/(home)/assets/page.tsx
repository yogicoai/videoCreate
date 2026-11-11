import type { Metadata } from 'next';
import { AssetsView } from '@/components/LibraryGrid';
import { listLibrary } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '자산 · 영상제작' };

export default function AssetsPage() {
  return (
    <>
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">자산</h1>
      <p className="mb-6 mt-1 text-[14px] text-ink-2">내 모델, 시트, 제작 규칙, 내 기획을 모아 두고 캔버스로 가져다 써요.</p>
      <AssetsView library={listLibrary()} />
    </>
  );
}
