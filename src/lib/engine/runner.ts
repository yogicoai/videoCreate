import fs from 'node:fs';
import sharp from 'sharp';
import { ENGINE_INFO } from '../models.ts';
import * as store from '../store.ts';
import type { Job } from '../types.ts';
import { directEngine, isFakeMode } from './registry.ts';
import { EngineError, type InlineImage } from './types.ts';

/**
 * 제미나이·GPT 작업을 실제로 돌리는 곳.
 *
 * 요청을 붙잡아 두지 않으려고 서버 안에서 뒤로 돌리고, 화면은 기록을 읽어 상태를 본다.
 * 앞 칸이 같은 대기열에 있으면 앞 칸이 끝난 뒤 시작한다. 화면이 몇 초마다 kick 을 부른다.
 */

const MAX_PARALLEL = 2;
const DEFAULT_GEMINI_LIMIT = 300;

// 개발 서버가 코드를 다시 읽어도 진행 중인 작업을 잊지 않도록 전역에 둔다
const shared = globalThis as unknown as { __videoCreateRunner?: { inFlight: Set<string> } };
const state = (shared.__videoCreateRunner ??= { inFlight: new Set<string>() });

async function loadReferences(projectId: string, job: Job, jobs: Job[]): Promise<InlineImage[]> {
  const references: InlineImage[] = [];
  for (const ref of job.refs) {
    const file = store.resolveRefFile(jobs, ref);
    if (!file) throw new EngineError(`'${ref.sourceTitle}'의 파일을 찾지 못했어요.`);
    const raw = fs.readFileSync(store.filePath(projectId, file));
    // 형태와 얼굴을 알아볼 크기만 남긴다. 원본 그대로 보내면 요청이 너무 커진다
    const buffer = await sharp(raw)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    references.push({ mimeType: 'image/jpeg', data: buffer.toString('base64') });
  }
  return references;
}

function geminiLimitReached(): number | null {
  const limit = Number(process.env.GEMINI_USAGE_LIMIT) || DEFAULT_GEMINI_LIMIT;
  return store.getGeminiUsed() >= limit ? limit : null;
}

async function run(projectId: string, job: Job, jobs: Job[]): Promise<void> {
  try {
    const engine = directEngine(job.engine);
    if (!engine) throw new EngineError('이 칸은 앱에서 바로 뽑을 수 없어요.');
    if (!engine.configured()) throw new EngineError(`${ENGINE_INFO[job.engine].label} 키가 없어요 (.env.local).`, 503);
    if (job.engine === 'gemini' && !isFakeMode()) {
      const limit = geminiLimitReached();
      if (limit) throw new EngineError(`이 앱의 제미나이 한도 ${limit}장에 닿았어요. .env.local 의 GEMINI_USAGE_LIMIT 를 올리면 이어서 쓸 수 있어요.`);
    }
    const references = await loadReferences(projectId, job, jobs);
    const output = await engine.generate({
      prompt: job.finalPrompt,
      references,
      aspect: job.options.aspect,
      resolution: job.options.resolution,
    });
    await store.completeJob(projectId, job.id, { bytes: output.bytes, actual: output.actual, model: output.model });
    if (job.engine === 'gemini' && !isFakeMode()) store.addGeminiUsed(1);
  } catch (e) {
    const err = e as EngineError;
    store.failJob(projectId, job.id, { message: err.message || '생성에 실패했어요.', status: err.status });
  } finally {
    state.inFlight.delete(job.id);
    kick(projectId);
  }
}

export function kick(projectId: string): void {
  let jobs: Job[];
  try {
    jobs = store.readJobs(projectId);
  } catch {
    return;
  }
  for (const job of jobs) {
    if (!ENGINE_INFO[job.engine].direct) continue;
    // 서버가 다시 켜지면서 끊긴 작업은 결과를 받을 길이 없다
    if (job.status === 'running' && !state.inFlight.has(job.id)) {
      store.failJob(projectId, job.id, {
        message: '서버가 다시 시작되어 결과를 받지 못했어요. 비용이 이미 나갔을 수 있어요.',
      });
      continue;
    }
    if (job.status !== 'queued') continue;
    if (state.inFlight.size >= MAX_PARALLEL) break;
    const upstream = store.upstreamState(store.readJobs(projectId), job);
    if (upstream === 'waiting') continue;
    if (upstream === 'broken') {
      store.failJob(projectId, job.id, { message: '앞 칸이 실패하거나 취소돼서 멈췄어요.' });
      continue;
    }
    state.inFlight.add(job.id);
    try {
      const started = store.startJob(projectId, job.id);
      void run(projectId, started, store.readJobs(projectId));
    } catch {
      state.inFlight.delete(job.id);
    }
  }
}
