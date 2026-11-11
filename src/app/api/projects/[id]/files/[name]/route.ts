import fs from 'node:fs';
import { Readable } from 'node:stream';
import { route } from '@/lib/http';
import { ensureThumb, fileInfo } from '@/lib/store';

function streamFile(path: string, start?: number, end?: number): ReadableStream {
  return Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream;
}

/** 파일 내려주기. ?w= 는 줄인 그림, Range 는 영상 앞뒤로 옮기기에 쓴다 */
export const GET = route<{ id: string; name: string }>(async (req, { id, name }) => {
  const width = Number(new URL(req.url).searchParams.get('w'));
  const source = fileInfo(id, name);
  // 이름이 내용이나 작업마다 달라 파일이 바뀔 일이 없다
  const cache = { 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' };

  if (width > 0 && source.isImage) {
    const thumb = await ensureThumb(id, name, width);
    return new Response(streamFile(thumb.path), {
      headers: { ...cache, 'content-type': thumb.mime, 'content-length': String(thumb.size) },
    });
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start: number;
    let end: number;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), source.size - 1) : source.size - 1;
    } else {
      const suffix = Number(range[2]);
      start = Math.max(source.size - suffix, 0);
      end = source.size - 1;
    }
    if (start > end || start >= source.size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${source.size}` } });
    }
    return new Response(streamFile(source.path, start, end), {
      status: 206,
      headers: {
        ...cache,
        'content-type': source.mime,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${source.size}`,
        'content-length': String(end - start + 1),
      },
    });
  }

  return new Response(streamFile(source.path), {
    headers: { ...cache, 'content-type': source.mime, 'accept-ranges': 'bytes', 'content-length': String(source.size) },
  });
});
