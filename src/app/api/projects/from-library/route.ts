import { readBody, route } from '@/lib/http';
import { startFromLibrary, StoreError } from '@/lib/store';

/** 내 기획이나 스토리보드로 새 프로젝트를 만든다. 생성은 하지 않는다 */
export const POST = route(async (req) => {
  const body = await readBody<{ itemId?: string }>(req);
  if (!body.itemId) throw new StoreError('가져올 기획을 알려 주세요.');
  return Response.json({ project: await startFromLibrary(body.itemId) }, { status: 201 });
});
