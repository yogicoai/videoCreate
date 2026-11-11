import type { CellKind, StoredEdge } from './types.ts';

/**
 * 어떤 칸에서 어떤 칸으로 이을 수 있는지. 앞 칸의 결과가 뒤 칸의 재료가 된다.
 * 시나리오는 글로, 참조·시트·그림은 그림으로 들어간다.
 * 영상 → 영상(이어 뽑기)을 넣을 때는 이 표와 대기열의 호출 값만 늘리면 된다.
 */
export const CONNECTIONS: Record<CellKind, CellKind[]> = {
  scenario: ['storyboard', 'image', 'video'],
  ref: ['image', 'storyboard', 'video'],
  image: ['image', 'storyboard', 'video'],
  storyboard: ['shot', 'image', 'video'],
  shot: ['image', 'video'],
  video: [],
};

export function canConnect(source: CellKind, target: CellKind): boolean {
  return CONNECTIONS[source]?.includes(target) ?? false;
}

export function createsCycle(edges: Pick<StoredEdge, 'source' | 'target'>[], source: string, target: string): boolean {
  if (source === target) return true;
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop() as string;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) if (edge.source === current) stack.push(edge.target);
  }
  return false;
}

/** 앞 칸부터 먼저 나오도록 정렬한다. 한꺼번에 대기열에 넣을 때 쓴다 */
export function topoOrder(ids: string[], edges: Pick<StoredEdge, 'source' | 'target'>[]): string[] {
  const wanted = new Set(ids);
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const edge of edges) if (edge.target === id && wanted.has(edge.source)) visit(edge.source);
    ordered.push(id);
  };
  ids.forEach(visit);
  return ordered;
}

/** 칸마다 앞에 몇 단계가 있는지. 정렬할 때 왼쪽에서 몇 번째 줄에 놓을지 정한다 */
export function levels(ids: string[], edges: Pick<StoredEdge, 'source' | 'target'>[]): Map<string, number> {
  const wanted = new Set(ids);
  const level = new Map<string, number>();
  for (const id of topoOrder(ids, edges)) {
    let value = 0;
    for (const edge of edges) {
      if (edge.target === id && wanted.has(edge.source)) value = Math.max(value, (level.get(edge.source) ?? 0) + 1);
    }
    level.set(id, value);
  }
  return level;
}
