import { readBody, route } from '@/lib/http';
import { createProject, listProjects } from '@/lib/store';

export const GET = route(() => Response.json({ projects: listProjects() }));

export const POST = route(async (req) => {
  const body = await readBody<{ name?: string }>(req);
  return Response.json({ project: createProject(body.name) }, { status: 201 });
});
