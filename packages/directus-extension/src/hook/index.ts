import { defineHook } from '@directus/extensions-sdk';
import { garantirEsquema } from '../shared/esquema.js';
import { sincronizarTodas } from '../shared/servico.js';
import type { Contexto } from '../shared/tipos.js';

export default defineHook(({ init, schedule }, contexto) => {
	const ctx = contexto as unknown as Contexto;

	init('app.after', async () => {
		try {
			await garantirEsquema(ctx);
		} catch (erro) {
			ctx.logger.error(`[nfse-nacional] não consegui criar as coleções: ${erro instanceof Error ? erro.message : erro}`);
		}
	});

	// Padrão: a cada 4 horas. NFSE_AGENDA aceita qualquer expressão cron.
	const agenda = String(ctx.env.NFSE_AGENDA ?? '0 */4 * * *');
	if (agenda !== 'false') {
		schedule(agenda, () => sincronizarTodas(ctx));
	}
});
