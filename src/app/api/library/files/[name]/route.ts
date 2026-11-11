import fs from 'node:fs';
import { Readable } from 'node:stream';
import { route } from '@/lib/http';
import { ensureLibraryThumb, libraryFileInfo } from '@/lib/store';

function streamFile(path: string): ReadableStream {
  return Readable.toWeb(fs.createReadStream(path)) as ReadableStream;
}

/** 자산 파일 내려주기. ?w= 는 줄인 그림 */
export const GET = route<{ name: string }>(async (req, { name }) => {
  const width = Number(new URL(req.url).searchParams.get('w'));
  const source = libraryFileInfo(name);
  const cache = { 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' };
  if (width > 0 && source.isImage) {
    const thumb = await ensureLibraryThumb(name, width);
    return new Response(streamFile(thumb.path), {
      headers: { ...cache, 'content-type': thumb.mime, 'content-length': String(thumb.size) },
    });
  }
  return new Response(streamFile(source.path), {
    headers: { ...cache, 'content-type': source.mime, 'content-length': String(source.size) },
  });
});
