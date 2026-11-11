/** 화면에서 쓰는 작은 도구들 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(url: string, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T> {
  const { body, ...rest } = init ?? {};
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    ...rest,
    headers: isForm || body === undefined ? rest.headers : { 'content-type': 'application/json', ...rest.headers },
    body: isForm ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error || '요청을 처리하지 못했어요.', res.status);
  return json as T;
}

export function fileUrl(projectId: string, name: string, width?: number): string {
  const base = `/api/projects/${projectId}/files/${encodeURIComponent(name)}`;
  return width ? `${base}?w=${width}` : base;
}

export const videoUrl = (itemId: string) => `/api/library/videos/${itemId}`;

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function pickFiles(multiple: boolean, onPick: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = multiple;
  input.onchange = () => {
    if (input.files?.length) onPick(Array.from(input.files));
  };
  input.click();
}

/** 자산을 캔버스로 끌 때 쓰는 자료 형식 */
export const ASSET_DRAG_TYPE = 'application/x-videocreate-asset';
