import type { Env } from './index.js';
import type { Relato } from './validacao.js';
import { processar } from './index.js';

/**
 * Durable Object da assinatura (um por mudança do ADN). Processa um relato de cada vez e guarda o número
 * da issue: o segundo relato encontra a issue na hora, mesmo que a listagem do GitHub ainda não a mostre.
 */
export class MemoriaDeAssinaturas {
	constructor(
		private readonly estado: DurableObjectState,
		private readonly env: Env,
	) {}

	async fetch(request: Request): Promise<Response> {
		const relato = (await request.json()) as Relato;
		const armazenamento = this.estado.storage;

		// Bloqueia outros relatos desta assinatura até terminar (inclusive durante as chamadas ao GitHub).
		return this.estado.blockConcurrencyWhile(() =>
			processar(relato, this.env, undefined, {
				obter: () => armazenamento.get<number>('issue'),
				guardar: (numero) => armazenamento.put('issue', numero),
			}),
		);
	}
}
