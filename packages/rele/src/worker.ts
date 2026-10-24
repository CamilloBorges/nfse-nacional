import type { Env } from './index.js';
import { tratar } from './index.js';

/** Ponto de entrada do Worker: só o handler, sem outros exports (que o Workers trataria como entrypoints). */
export default { fetch: (request: Request, env: Env) => tratar(request, env) };
