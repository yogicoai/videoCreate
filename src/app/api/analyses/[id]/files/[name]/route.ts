import fs from 'node:fs';
import { analysisFilePath } from '@/lib/analyze';
import { route } from '@/lib/http';

export const GET = route<{ id: string; name: string }>((_req, { id, name }) => {
  const bytes = fs.readFileSync(analysisFilePath(id, name));
  return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
});
