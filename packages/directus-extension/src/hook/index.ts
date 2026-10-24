import type { Contexto } from '../shared/tipos.js';
import { defineHook } from '@directus/extensions-sdk';
import { obterAplicacao } from '../shared/aplicacao.js';
import { garantirEsquema } from '../shared/esquema.js';

export default defineHook(({ init, schedule }, contexto) => {
	const ctx = contexto as unknown as Contexto;

	init('app.after', async () => {
		try {
			await garantirEsquema(ctx);
			await obterAplicacao(ctx);
		}
		catch (erro) {
			ctx.logger.error(`[nfse-nacional] falha ao iniciar: ${erro instanceof Error ? erro.message : erro}`);
		}
	});

	// Padrão: a cada 4 horas. NFSE_AGENDA aceita qualquer expressão cron; "false" desliga.
	const agenda = String(ctx.env.NFSE_AGENDA ?? '0 */4 * * *');

	if (agenda !== 'false') {
		schedule(agenda, async () => {
			try {
				const app = await obterAplicacao(ctx);
				await app.sincronizarTodas();
				// Issues relatadas por esta instalação: avisa quando forem corrigidas.
				await app.acompanharIssues();
			}
			catch (erro) {
				ctx.logger.error(`[nfse-nacional] ${erro instanceof Error ? erro.message : erro}`);
			}
		});
	}
});
