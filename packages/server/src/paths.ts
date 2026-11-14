// Filesystem locations resolved from this file so they work from any cwd (npm workspaces run in the package dir).
import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const DATA_DIR = resolve(REPO_ROOT, 'data');
export const WEB_DIST = resolve(REPO_ROOT, 'packages/web/dist');
