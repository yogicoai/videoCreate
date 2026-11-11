import { route } from '@/lib/http';
import { readCfLibrary } from '@/lib/store';

export const GET = route(() => Response.json(readCfLibrary()));
