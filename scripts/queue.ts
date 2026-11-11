/**
 * 힉스필드 대기열과 스토리보드 샷 표를 다루는 스크립트. 사용자가 대화에서 "돌려줘", "샷 나눠줘"라고 하면 Claude가 쓴다.
 * 순서와 승인 규칙은 CLAUDE.md 를 따른다.
 *
 *   npm run queue                      대기 목록과 합계
 *   npm run queue -- show <job>        호출 값 전체(JSON)
 *   npm run queue -- start <job>       생성 중으로 표시
 *   npm run queue -- done <job> --url <result_url> --higgs-job <id> --credits <n>
 *   npm run queue -- done <job> --file <경로> --higgs-job <id> --credits <n>
 *   npm run queue -- fail <job> --error "<사유>" [--credits <n>]
 *   npm run queue -- requeue <job>     생성 중에 멈춘 칸을 대기로 되돌림
 *   npm run queue -- balance <잔액>    화면에 보여 줄 잔액 기록
 *   npm run queue -- boards            스토리보드 목록
 *   npm run queue -- board <칸 id>     샷을 나눌 때 읽는 시나리오·규칙·재료(JSON)
 *   npm run queue -- board-set <칸 id> --file <샷 표 JSON>   샷 표 넣기
 *   npm run queue -- use <프로젝트> "<제품·모델 이름>" [--to "<칸 이름>"]   요기보 제품이나 모델을 칸으로 잇기
 *   npm run queue -- analyses          분석한 레퍼런스 영상 목록
 *   npm run queue -- analysis <분석 id>  컷 표(JSON)와 격자 그림 경로
 */
import fs from 'node:fs';
import { analysisFilePath, getAnalysis, listAnalyses } from '../src/lib/analyze.ts';
import { buildHiggsCall } from '../src/lib/engine/higgsfield.ts';
import { formatCost, formatNumber } from '../src/lib/models.ts';
import * as store from '../src/lib/store.ts';
import type { Cost } from '../src/lib/types.ts';

const [command, ...rest] = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : undefined;
}

function die(message: string): never {
  console.error(`오류: ${message}`);
  process.exit(1);
}

function lookup(jobId: string | undefined) {
  if (!jobId || jobId.startsWith('--')) die('job id 를 적어 주세요.');
  const found = store.findJob(jobId);
  if (!found) die(`생성 기록을 찾지 못했어요: ${jobId}`);
  return found;
}

function parseCredits(required: boolean): Cost | null {
  const raw = option('credits');
  if (raw === undefined) {
    if (required) die('--credits <실제 크레딧> 을 적어 주세요. 모르면 --credits-unknown 을 붙이세요.');
    return null;
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) die(`크레딧 값이 이상해요: ${raw}`);
  return { unit: 'credit', amount };
}

async function resultBytes(): Promise<Buffer> {
  const file = option('file');
  const url = option('url');
  if (file) {
    if (!fs.existsSync(file)) die(`파일이 없어요: ${file}`);
    return fs.readFileSync(file);
  }
  if (url) {
    if (!/^https?:\/\//i.test(url)) die('주소는 http(s) 여야 해요.');
    const res = await fetch(url);
    if (!res.ok) die(`내려받지 못했어요 (HTTP ${res.status}). result_url 을 그대로 썼는지 확인해 주세요.`);
    return Buffer.from(await res.arrayBuffer());
  }
  return die('--url 또는 --file 이 필요해요.');
}

function printList(): void {
  const pending = store.pendingHiggsfieldJobs();
  if (!pending.length) {
    console.log('대기 중인 칸이 없어요.');
    return;
  }
  let images = 0;
  let videos = 0;
  let credits = 0;
  for (const { projectName, job, jobs } of pending) {
    if (job.kind === 'image') images++;
    else videos++;
    credits += job.estimate.amount;
    const state = job.status === 'running' ? '생성 중' : '대기';
    const upstream = store.upstreamState(jobs, job);
    const note = upstream === 'waiting' ? ' · 앞 칸 대기' : upstream === 'broken' ? ' · 앞 칸 실패' : '';
    console.log(`${job.id}  [${state}${note}]  ${projectName} / ${job.title}  ${job.kind === 'image' ? '그림' : '영상'}  ${formatCost(job.estimate)}`);
  }
  console.log(`\n합계: 그림 ${images}장 · 영상 ${videos}개 · 예상 ${formatNumber(credits)}크레딧`);
  console.log('앞 칸부터 위에서 아래로 처리합니다. 호출 값은 show <job> 으로 봅니다.');
}

function findBoard(nodeId: string | undefined) {
  if (!nodeId || nodeId.startsWith('--')) die('스토리보드 칸 id 를 적어 주세요. 목록은 boards 로 봅니다.');
  const board = store.storyboardsForPlanning().find((b) => b.nodeId === nodeId);
  if (!board) die(`스토리보드를 찾지 못했어요: ${nodeId}`);
  return board;
}

async function main(): Promise<void> {
  switch (command) {
    case undefined:
    case 'list':
      printList();
      return;
    case 'show': {
      const { job, jobs } = lookup(rest[0]);
      // 내 영상을 참조로 넘기려면 파일이 있어야 한다
      for (const ref of job.refs) if (ref.videoLibraryId) await store.ensureLibraryVideoFile(ref.videoLibraryId);
      console.log(
        JSON.stringify({ id: job.id, title: job.title, status: job.status, estimate: job.estimate, call: buildHiggsCall(job, jobs) }, null, 2),
      );
      return;
    }
    case 'start': {
      const { projectId, job } = lookup(rest[0]);
      if (job.engine !== 'higgsfield') die('앱에서 바로 뽑는 칸은 여기서 처리하지 않아요.');
      store.startJob(projectId, job.id);
      console.log(`생성 중으로 표시했어요: ${job.title}`);
      return;
    }
    case 'done': {
      const { projectId, job } = lookup(rest[0]);
      if (job.engine !== 'higgsfield') die('앱에서 바로 뽑는 칸은 여기서 처리하지 않아요.');
      const externalId = option('higgs-job');
      if (!externalId) die('--higgs-job <job id> 를 적어 주세요.');
      const actual = rest.includes('--credits-unknown') ? null : parseCredits(true);
      const bytes = await resultBytes();
      const updated = await store.completeJob(projectId, job.id, { bytes, actual, externalId });
      console.log(
        `결과를 넣었어요: ${updated.title} (${updated.result?.width}×${updated.result?.height}, ${
          updated.actual ? `실제 ${formatCost(updated.actual)}` : `추정 ${formatCost(updated.estimate)}`
        })`,
      );
      console.log(store.filePath(projectId, updated.result?.file as string));
      if (updated.preset === 'storyboard') {
        const panels = store.readBoards(projectId)[updated.nodeId]?.panels.length ?? 0;
        console.log(`시트를 ${panels}칸으로 잘랐어요.`);
      }
      return;
    }
    case 'fail': {
      const { projectId, job } = lookup(rest[0]);
      const message = option('error');
      if (!message) die('--error "<사유>" 를 적어 주세요.');
      store.failJob(projectId, job.id, { message }, parseCredits(false));
      console.log(`실패로 표시했어요: ${job.title}`);
      return;
    }
    case 'requeue': {
      const { projectId, job } = lookup(rest[0]);
      store.requeueJob(projectId, job.id);
      console.log(`대기로 되돌렸어요: ${job.title}`);
      return;
    }
    case 'balance': {
      const credits = Number(rest[0]);
      if (!Number.isFinite(credits) || credits < 0) die('잔액 숫자를 적어 주세요.');
      store.setBalance(credits);
      console.log(`잔액을 기록했어요: ${formatNumber(credits)}`);
      return;
    }
    case 'analyses': {
      for (const a of listAnalyses()) console.log(`${a.id}  ${a.status}  ${a.cuts.length}컷  ${Math.round(a.duration)}초  ${a.title || a.url}`);
      break;
    }
    case 'analysis': {
      const analysis = getAnalysis(rest[0] ?? '');
      console.log(JSON.stringify({ grid: analysis.status === 'done' ? analysisFilePath(analysis.id, 'grid.jpg') : null, ...analysis }, null, 2));
      break;
    }
    case 'use': {
      const [projectId, name] = rest;
      if (!projectId || !name) die('npm run queue -- use <프로젝트> "<제품·모델 이름>" [--to "<칸 이름>"]');
      const linked = await store.connectAsset(projectId, { name, toTitle: option('to') });
      console.log(linked.target ? `'${linked.title}'을 '${linked.target}'에 이었어요.` : `'${linked.title}' 칸을 만들었어요. 이을 스토리보드가 없어요.`);
      break;
    }
    case 'boards': {
      const boards = store.storyboardsForPlanning();
      if (!boards.length) {
        console.log('스토리보드 칸이 없어요.');
        return;
      }
      for (const b of boards) {
        console.log(`${b.nodeId}  ${b.projectName} / ${b.title}  ${b.cuts}컷 ${b.total}초 ${b.aspect}  샷 ${b.shots.length}줄  재료 ${b.sources.length}개  시나리오 ${b.scenario ? '있음' : '없음'}`);
      }
      return;
    }
    case 'board': {
      console.log(JSON.stringify(findBoard(rest[0]), null, 2));
      return;
    }
    case 'board-set': {
      const board = findBoard(rest[0]);
      const file = option('file');
      if (!file || !fs.existsSync(file)) die('--file <샷 표 JSON> 이 필요해요.');
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const shots = Array.isArray(parsed) ? parsed : parsed.shots;
      const saved = store.saveBoardShots(board.projectId, board.nodeId, shots);
      const seconds = saved.shots.reduce((sum, s) => sum + s.seconds, 0);
      console.log(`샷 표를 넣었어요: ${saved.shots.length}줄, 합계 ${formatNumber(seconds)}초 (목표 ${board.total}초)`);
      return;
    }
    default:
      die(`모르는 명령이에요: ${command}`);
  }
}

main().catch((e: Error) => die(e.message));
