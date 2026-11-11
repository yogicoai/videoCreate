import { Sidebar } from '@/components/Sidebar';
import { getBalance } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col md:flex-row">
      <Sidebar balance={getBalance()} />
      <main className="thin-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
