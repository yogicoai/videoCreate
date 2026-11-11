import { filePath, libraryVideoPath, resolveRefFile } from '../store.ts';
import type { Job } from '../types.ts';

/**
 * 힉스필드 월 크레딧은 대화의 MCP로만 쓸 수 있다. 앱은 호출하지 않고,
 * 대기열 스크립트가 이 값을 보여 주면 대화 쪽 Claude가 그대로 부른다.
 */

export type HiggsCall = {
  tool: 'mcp__claude_ai_higgs__generate_image' | 'mcp__claude_ai_higgs__generate_video';
  params: Record<string, unknown>;
  /** 먼저 올려야 하는 로컬 파일. placeholder 자리에 media_id 를 넣는다 */
  uploads: { placeholder: string; path: string; order: number; title: string }[];
  /** 앞 칸이 아직 안 끝나 준비되지 않은 참조 */
  waitingFor: string[];
};

export function buildHiggsCall(job: Job, jobs: Job[]): HiggsCall {
  const uploads: HiggsCall['uploads'] = [];
  const waitingFor: string[] = [];
  const medias: { value: string; role: string }[] = [];

  for (const ref of job.refs) {
    const source = ref.sourceJobId ? jobs.find((j) => j.id === ref.sourceJobId) : null;
    if (source?.engine === 'higgsfield' && source.externalId) {
      // 앞 칸이 힉스필드 결과면 다시 올리지 않고 job id 를 그대로 넘긴다
      medias.push({ value: source.externalId, role: ref.role });
      continue;
    }
    if (ref.videoLibraryId) {
      const placeholder = `UPLOAD_${ref.order}`;
      uploads.push({ placeholder, path: libraryVideoPath(ref.videoLibraryId), order: ref.order, title: ref.sourceTitle });
      medias.push({ value: placeholder, role: ref.role });
      continue;
    }
    const file = resolveRefFile(jobs, ref);
    if (!file) {
      waitingFor.push(ref.sourceTitle);
      continue;
    }
    const placeholder = `UPLOAD_${ref.order}`;
    uploads.push({ placeholder, path: filePath(job.projectId, file), order: ref.order, title: ref.sourceTitle });
    medias.push({ value: placeholder, role: ref.role });
  }

  const prompt = job.finalPrompt;
  if (job.kind === 'image') {
    return {
      tool: 'mcp__claude_ai_higgs__generate_image',
      params: {
        model: job.model,
        prompt,
        aspect_ratio: job.options.aspect,
        resolution: job.options.resolution ?? '2k',
        ...(medias.length ? { medias } : {}),
      },
      uploads,
      waitingFor,
    };
  }
  const quality = job.options.quality ?? 'draft';
  return {
    tool: 'mcp__claude_ai_higgs__generate_video',
    params: {
      model: job.model,
      prompt,
      aspect_ratio: job.options.aspect,
      duration: job.options.duration ?? 5,
      mode: medias.length ? 'omni_reference' : 't2v',
      ...(quality === 'draft' ? { draft: true } : { resolution: quality }),
      ...(medias.length ? { medias } : {}),
    },
    uploads,
    waitingFor,
  };
}
