import type { Metadata } from 'next';
import { GalleryFolders } from '@/components/Gallery';
import { buildGallery } from '@/lib/gallery';
import { listLibrary, listProjects } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '갤러리 · 영상제작' };

export default function GalleryPage() {
  const folders = buildGallery(listLibrary(), listProjects());
  return (
    <>
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">갤러리</h1>
      <p className="mb-6 mt-1 text-[14px] text-ink-2">제작물별로 모아 봅니다. 눌러서 들어가면 완성본과 장면이 나오고, 마음에 드는 작업에 별을 누르면 메인 화면에 걸려요.</p>
      <GalleryFolders folders={folders.map(({ id, group, title, desc, projectId, count, cover }) => ({ id, group, title, desc, projectId, count, cover }))} />
    </>
  );
}
