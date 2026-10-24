import type { ChamarGitHub } from './github.js';
import { clienteGitHub } from './github.js';
import { encontrarOuCriarIssue } from './issues.js';
import { validarRelato } from './validacao.js';

/**
 * Relé do nfse-nacional: recebe de cada instalação (que consentiu) o relato de uma mudança do ADN,
 * sem dados fiscais, e abre ou atualiza a issue correspondente no GitHub. A credencial do GitHub
 * fica só aqui; as instalações não precisam de token.
 */
export interface Env {
	GITHUB_APP_ID: string;
	GITHUB_APP_CHAVE: string;
	GITHUB_INSTALACAO_ID: string;
	REPOSITORIO: string;
	/** Binding de Rate Limiting do Workers. */
	LIMITE?: { limit: (opcoes: { key: string }) => Promise<{ success: boolean }> };
}

export async function tratar(request: Request, env: Env, github?: ChamarGitHub): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === 'GET' && url.pathname === '/') {
		return Response.json({ servico: 'nfse-nacional relé', repositorio: env.REPOSITORIO, configurado: Boolean(env.GITHUB_APP_ID) });
	}

	if (request.method !== 'POST' || url.pathname !== '/relatos') return Response.json({ erro: 'não encontrado' }, { status: 404 });
	if (Number(request.headers.get('content-length') ?? 0) > 2048) return Response.json({ erro: 'relato grande demais' }, { status: 413 });

	let corpo: unknown;

	try {
		corpo = await request.json();
	}
	catch {
		return Response.json({ erro: 'JSON inválido' }, { status: 400 });
	}

	const validado = await validarRelato(corpo);
	if ('erros' in validado) return Response.json({ erro: validado.erros.join('; ') }, { status: 400 });
	const { relato } = validado;

	const ip = request.headers.get('cf-connecting-ip') ?? 'sem-ip';
	const permitido = await Promise.all([env.LIMITE?.limit({ key: `i:${relato.instalacao}` }), env.LIMITE?.limit({ key: `ip:${ip}` })]);
	if (permitido.some((p) => p && !p.success)) return Response.json({ erro: 'muitos relatos; tente mais tarde' }, { status: 429 });

	if (!github && !env.GITHUB_APP_ID) return Response.json({ erro: 'relé ainda não configurado' }, { status: 503 });

	const chamar = github ?? clienteGitHub({ appId: env.GITHUB_APP_ID, chavePkcs8: env.GITHUB_APP_CHAVE, instalacaoId: env.GITHUB_INSTALACAO_ID });

	try {
		return Response.json(await encontrarOuCriarIssue(chamar, env.REPOSITORIO, relato));
	}
	catch (erro) {
		console.error(erro);
		return Response.json({ erro: 'falha ao falar com o GitHub' }, { status: 502 });
	}
}
