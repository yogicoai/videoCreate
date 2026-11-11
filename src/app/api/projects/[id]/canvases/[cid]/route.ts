import { readBody, route } from '@/lib/http';
import { getCanvas, renameCanvas, saveCanvas } from '@/lib/store';
import type { Viewport } from '@/lib/types';

type Params = { id: string; cid: string };

export const GET = route<Params>((_req, { id, cid }) => Response.json({ canvas: getCanvas(id, cid) }));

export const PUT = route<Params>(async (req, { id, cid }) => {
  const body = await readBody<{ nodes: unknown; edges: unknown; viewport?: Viewport | null; revision: number }>(req);
  return Response.json(saveCanvas(id, cid, body));
});

export const PATCH = route<Params>(async (req, { id, cid }) => {
  const body = await readBody<{ name?: string }>(req);
  return Response.json({ project: renameCanvas(id, cid, body.name ?? '') });
});
