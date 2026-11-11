import { readBody, route } from '@/lib/http';
import { startFromCf, StoreError } from '@/lib/store';

/** CF 레퍼런스의 구조로 새 프로젝트를 만든다. 생성은 하지 않는다 */
export const POST = route(async (req) => {
  const body = await readBody<{ refId?: string }>(req);
  if (!body.refId) throw new StoreError('레퍼런스를 알려 주세요.');
  return Response.json({ project: startFromCf(body.refId) }, { status: 201 });
});
