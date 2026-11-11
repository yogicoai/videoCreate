import { readBody, route } from '@/lib/http';
import { deleteProject, getProject, updateProject } from '@/lib/store';

export const GET = route<{ id: string }>((_req, { id }) => Response.json({ project: getProject(id) }));

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const body = await readBody<{ name?: string; ruleId?: string }>(req);
  return Response.json({ project: updateProject(id, body) });
});

/** 프로젝트 지우기. 휴지통 폴더로 옮긴다 */
export const DELETE = route<{ id: string }>((_req, { id }) => {
  deleteProject(id);
  return Response.json({ ok: true });
});
