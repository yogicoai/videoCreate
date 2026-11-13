'use client';

import { Clapperboard, Film, FolderClosed, Images, MonitorPlay, Plus, ScanSearch } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, formatDateTime } from '@/lib/client';
import { formatNumber } from '@/lib/models';
import type { BalanceInfo, Project } from '@/lib/types';

const NAV = [
  { href: '/', label: '프로젝트', Icon: FolderClosed },
  { href: '/assets', label: '자산', Icon: Images },
  { href: '/gallery', label: '갤러리', Icon: Clapperboard },
  { href: '/cf-refs', label: 'CF 레퍼런스', Icon: MonitorPlay },
  { href: '/analyze', label: '숏츠 가져오기', Icon: ScanSearch },
  { href: '/video-import', label: '영상 가져오기', Icon: Film },
];

export function useCreateProject() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { project } = await api<{ project: Project }>('/api/projects', { method: 'POST', body: {} });
      router.push(`/p/${project.id}`);
    } catch (e) {
      setCreating(false);
      window.alert((e as Error).message);
    }
  };
  return { create, creating };
}

export function Sidebar({ balance }: { balance: BalanceInfo }) {
  const pathname = usePathname();
  const { create, creating } = useCreateProject();

  return (
    <aside className="flex flex-none flex-col border-b border-line px-3 py-2.5 md:w-[232px] md:border-b-0 md:border-r md:py-5">
      <div className="flex items-center justify-between gap-2 md:block">
        <Link href="/" className="px-2 text-[16px] font-bold tracking-[-0.02em] text-ink">
          영상제작
        </Link>
        <button type="button" onClick={create} disabled={creating} className="btn btn-primary h-9 text-[13px] md:mt-5 md:h-10 md:w-full md:text-[14px]">
          <Plus size={16} strokeWidth={2.4} />새 프로젝트
        </button>
      </div>
      <nav className="thin-scroll mt-1.5 flex gap-0.5 overflow-x-auto md:mt-4 md:flex-col md:overflow-visible" aria-label="메뉴">
        {NAV.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-9 flex-none items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors md:h-10 md:gap-2.5 md:text-[14px] ${
                active ? 'bg-fill font-semibold text-ink' : 'text-ink-2 hover:bg-fill-2 hover:text-ink'
              }`}
            >
              <Icon size={18} strokeWidth={1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
      {balance ? (
        <div className="mt-auto hidden px-2.5 md:block">
          <p className="text-[12px] text-ink-3">힉스필드 잔액</p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink">{formatNumber(balance.credits)}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">{formatDateTime(balance.at)} 확인</p>
        </div>
      ) : null}
    </aside>
  );
}
