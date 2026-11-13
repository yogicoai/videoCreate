import fs from 'node:fs';
import path from 'node:path';

/**
 * 온라인 보기 전용 판. VIDEOCREATE_ONLINE=1 이거나 Vercel 위에서 돌면 켜진다(이 PC에서 쓸 때는 꺼져 있다).
 *
 * - 기록은 함께 올라간 사본(online-data/ 또는 VIDEOCREATE_DATA_DIR)에서 읽기만 한다.
 * - 그림과 영상은 카페24에 올려 둔 것을 흘려보낸다. 올리지 않은 것은 보이지 않는다.
 * - 고치는 요청은 모두 막는다. 로그인이 없으니 누구도 고치거나 생성하지 못하게 한다.
 *
 * Vercel은 서버 파일에 쓰는 것을 막는다. 환경 변수를 빠뜨려 일반 모드로 켜지면 첫 화면에서
 * 기록 파일을 만들려다 서버 오류가 나서(2026-11-12), Vercel이 넣어 주는 VERCEL 변수만으로도 켜지게 했다.
 */
const onVercel = () => Boolean(process.env.VERCEL);
export const isOnline = () => process.env.VIDEOCREATE_ONLINE === '1' || onVercel();

/** 기록 폴더. 따로 정하지 않으면 이 PC는 data/, Vercel은 함께 올라간 사본 online-data/ 를 쓴다 */
export const dataRootDir = () => process.env.VIDEOCREATE_DATA_DIR || path.join(process.cwd(), onVercel() ? 'online-data' : 'data');

export type RemoteFile = { url: string; kind: 'image' | 'video'; mime: string; bytes: number };
type IndexItem = RemoteFile & { projectId: string; file?: string };

let cached: Map<string, RemoteFile> | null = null;

/** 카페24에 올린 파일 찾기. 기록은 data/library/cafe24.json 에 있다 */
export function remoteFile(projectId: string, name: string): RemoteFile | null {
  // 이 PC에서는 올릴 때마다 기록이 바뀌니 매번 읽고, 온라인에서는 한 번만 읽는다
  if (!cached || !isOnline()) {
    const file = path.join(dataRootDir(), 'library', 'cafe24.json');
    const map = new Map<string, RemoteFile>();
    try {
      const items = (JSON.parse(fs.readFileSync(file, 'utf8')).items ?? {}) as Record<string, IndexItem>;
      for (const item of Object.values(items)) {
        if (item.file) map.set(`${item.projectId}/${item.file}`, { url: item.url, kind: item.kind, mime: item.mime, bytes: item.bytes });
      }
    } catch {
      // 기록이 없으면 올린 것이 없는 것으로 본다
    }
    cached = map;
  }
  return cached.get(`${projectId}/${name}`) ?? null;
}
