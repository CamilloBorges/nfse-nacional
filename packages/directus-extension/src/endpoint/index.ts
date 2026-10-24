import { defineEndpoint } from '@directus/extensions-sdk';
import { ErroUsuario, lerEmpresa, salvarCertificado, sincronizarEmpresa } from '../shared/servico.js';
import type { Contexto } from '../shared/tipos.js';

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
			} catch (erro) {
				if (erro instanceof ErroUsuario) {
					res.status(erro.status).json({ erro: erro.message });
				} else {
					ctx.logger.error(`[nfse-nacional] ${erro instanceof Error ? erro.message : erro}`);
					res.status(500).json({ erro: erro instanceof Error ? erro.message : 'Erro interno.' });
				}
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
				return salvarCertificado(ctx, Number(req.params.id), Buffer.from(pfx, 'base64'), senha, req.accountability);
			}),
		);

		router.post(
			'/empresas/:id/sincronizar',
			somenteAdmin,
			tratar(async (req) => {
				const empresa = await lerEmpresa(ctx, Number(req.params.id));
				const resultado = await sincronizarEmpresa(ctx, empresa);
				return resultado ?? { aviso: 'Sincronização não executada (em andamento ou certificado vencido).' };
			}),
		);
	},
});
