import { readBody, route } from '@/lib/http';
import { createCanvas } from '@/lib/store';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readBody<{ name?: string }>(req);
  return Response.json({ project: createCanvas(id, body.name) }, { status: 201 });
});
