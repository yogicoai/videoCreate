import type { Metadata } from 'next';
import { CfRefsView } from '@/components/CfRefs';

export const metadata: Metadata = { title: 'CF 레퍼런스 · 영상제작' };

export default function CfRefsPage() {
  return <CfRefsView />;
}
