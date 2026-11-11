import { Home } from '@/components/Home';
import { buildShowcase } from '@/lib/gallery';
import { getBalance, listLibrary, listProjects, readCfLibrary } from '@/lib/store';

export const dynamic = 'force-dynamic';

const PICK_COUNT = 4;

export default function ProjectsPage() {
  const library = listLibrary();
  const cf = readCfLibrary();
  const ideas = library.ideas.filter((idea) => idea.images.length).slice(0, PICK_COUNT);
  const trends = cf.refs
    .filter((r) => r.fit === 5 && r.trend && r.thumbUrl && r.checked)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, PICK_COUNT);

  return (
    <Home
      projects={listProjects()}
      balance={getBalance()}
      showcase={buildShowcase(library)}
      counts={{ models: library.models.length, plans: library.ideas.length + library.boards.length, videos: library.videos.length, cf: cf.refs.length }}
      ideas={ideas}
      trends={trends}
    />
  );
}
