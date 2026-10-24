import type { Env } from './index.js';
import { tratar } from './index.js';

export { MemoriaDeAssinaturas } from './memoria.js';

/** Ponto de entrada do Worker: o handler e a classe do Durable Object (os únicos exports que o Workers aceita). */
export default { fetch: (request: Request, env: Env) => tratar(request, env) };
