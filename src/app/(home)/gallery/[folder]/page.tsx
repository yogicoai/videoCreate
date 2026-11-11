import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GalleryFolderView } from '@/components/Gallery';
import { buildGallery } from '@/lib/gallery';
import { listLibrary, listProjects, readShowcase } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ folder: string }> };

function find(id: string) {
  return buildGallery(listLibrary(), listProjects()).find((f) => f.id === id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const folder = find((await params).folder);
  return { title: folder ? `${folder.title} · 갤러리` : '갤러리 · 영상제작' };
}

export default async function GalleryFolderPage({ params }: Props) {
  const folder = find((await params).folder);
  if (!folder) notFound();
  return <GalleryFolderView folder={folder} showcase={readShowcase()} />;
}
