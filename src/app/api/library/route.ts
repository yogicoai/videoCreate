import { readBody, route } from '@/lib/http';
import { listLibrary, saveProjectFileAsAsset, StoreError } from '@/lib/store';
import type { AssetType } from '@/lib/types';

export const GET = route(() => Response.json(listLibrary()));

/** 프로젝트의 사진을 자산으로 저장한다 */
export const POST = route(async (req) => {
  const body = await readBody<{ fromProject?: string; name?: string; type?: AssetType; title?: string }>(req);
  if (!body.fromProject || !body.name) throw new StoreError('저장할 사진을 알려 주세요.');
  const item = await saveProjectFileAsAsset(body.fromProject, body.name, body.type ?? 'other', body.title ?? '');
  return Response.json({ item }, { status: 201 });
});
