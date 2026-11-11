import { readBody, route } from '@/lib/http';
import { saveBoardShots } from '@/lib/store';

/** 스토리보드의 샷 표를 저장한다 */
export const PUT = route<{ id: string; nodeId: string }>(async (req, { id, nodeId }) => {
  const body = await readBody<{ shots?: unknown }>(req);
  return Response.json({ board: saveBoardShots(id, nodeId, body.shots ?? []) });
});
