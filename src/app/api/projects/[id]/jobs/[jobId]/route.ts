import { route } from '@/lib/http';
import { cancelJob, jobsView } from '@/lib/store';

export const DELETE = route<{ id: string; jobId: string }>((_req, { id, jobId }) => {
  cancelJob(id, jobId);
  return Response.json(jobsView(id));
});
