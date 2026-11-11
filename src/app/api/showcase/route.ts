import { readBody, route } from '@/lib/http';
import { setShowcase, StoreError } from '@/lib/store';

/** 작업물을 메인 화면에 걸거나 내린다 */
export const POST = route(async (req) => {
  const body = await readBody<{ key?: string; on?: boolean }>(req);
  if (!body.key) throw new StoreError('작업물을 알려 주세요.');
  return Response.json({ keys: setShowcase(body.key, body.on === true) });
});
