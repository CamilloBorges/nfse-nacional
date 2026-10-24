import type { Contexto } from '../shared/tipos.js';
import { Buffer } from 'node:buffer';
import { defineEndpoint } from '@directus/extensions-sdk';
import { obterAplicacao } from '../shared/aplicacao.js';
import { ErroUsuario } from '../shared/repositorio-directus.js';

/**
 * Rotas em /nfse-nacional. Só administradores: enviar certificado e disparar sincronização
 * são operações sensíveis. A leitura das notas é pelas rotas normais do Directus (/items, GraphQL, MCP).
 */
export default defineEndpoint({
	id: 'nfse-nacional',
	handler: (router, contexto) => {
		const ctx = contexto as unknown as Contexto;

		const somenteAdmin = (req: any, res: any, next: () => void) => {
			if (req.accountability?.admin === true) return next();
			res.status(403).json({ erro: 'Apenas administradores.' });
		};

		const tratar = (fn: (req: any) => Promise<unknown>) => async (req: any, res: any) => {
			try {
				res.json(await fn(req));
			}
			catch (erro) {
				const texto = erro instanceof Error ? erro.message : 'Erro interno.';
				if (erro instanceof ErroUsuario) return res.status(erro.status).json({ erro: texto });
				ctx.logger.error(`[nfse-nacional] ${texto}`);
				res.status(500).json({ erro: texto });
			}
		};

		/** Corpo: { pfx: "<base64 do .pfx>", senha: "..." }. Resposta: só os metadados. */
		router.post(
			'/empresas/:id/certificado',
			somenteAdmin,
			tratar(async (req) => {
				const { pfx, senha } = req.body ?? {};

				if (typeof pfx !== 'string' || !pfx || typeof senha !== 'string') {
					throw new ErroUsuario('Envie "pfx" (base64) e "senha".');
				}

				const app = await obterAplicacao(ctx);
				return app.salvarCertificado(Number(req.params.id), Buffer.from(pfx, 'base64'), senha, req.accountability);
			}),
		);

		router.post(
			'/empresas/:id/sincronizar',
			somenteAdmin,
			tratar(async (req) => {
				const resultado = await (await obterAplicacao(ctx)).sincronizar(Number(req.params.id));
				return resultado ?? { aviso: 'Sincronização não executada (em andamento ou certificado vencido).' };
			}),
		);
	},
});
