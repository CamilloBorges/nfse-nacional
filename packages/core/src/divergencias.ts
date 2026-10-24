import type { Divergencia } from './contrato-adn.js';
import type { Registrador } from './contratos.js';
import { semRepeticao } from './contrato-adn.js';

/** Relé oficial do projeto: recebe o relato (sem dados fiscais) e abre ou atualiza a issue. */
export const URL_RELE_PADRAO = 'https://nfse-rele.bomgado.net';
export const REPOSITORIO_GITHUB = 'CamilloBorges/nfse-nacional';

export interface InfoIssue {
	numero: number;
	url: string;
	estado: 'aberta' | 'fechada';
	/** Versão que corrigiu (milestone da issue), quando fechada. */
	corrigidaNaVersao: string | null;
}

/** O que sai da instalação: a divergência e versões. Nada de CNPJ, XML, valores ou nomes. */
export interface RelatoDivergencia extends Divergencia {
	versaoPacote: string;
	versaoDirectus?: string;
	ambiente: string;
	/** Identificador aleatório da instalação (limite de envios no relé). */
	instalacao: string;
}

/** Ponto de extensão: para onde vão os relatos (relé oficial, outro relé, nenhum). */
export interface RelatorDeDivergencias {
	relatar: (relato: RelatoDivergencia) => Promise<InfoIssue>;
}

export interface DivergenciaRegistrada extends Divergencia {
	ocorrencias: number;
	issue: InfoIssue | null;
}

/** Ponto de extensão: onde a instalação guarda as divergências e as issues que acompanha. */
export interface RepositorioDivergencias {
	/** Insere as novas e soma ocorrência nas já conhecidas (por assinatura). */
	registrar: (divergencias: Divergencia[]) => Promise<DivergenciaRegistrada[]>;
	registrarIssue: (assinatura: string, issue: InfoIssue) => Promise<void>;
	comIssueAberta: () => Promise<DivergenciaRegistrada[]>;
}

export interface ContextoDoRelato {
	versaoPacote: string;
	versaoDirectus?: string;
	ambiente: string;
	instalacao: string;
}

/**
 * Registra as divergências e, se houver relator (consentimento dado), relata as que ainda não têm
 * issue. Falhas no relato só vão para o log: nunca interrompem a sincronização.
 */
export async function tratarDivergencias(
	divergencias: Divergencia[],
	deps: { repositorio: RepositorioDivergencias; relator?: RelatorDeDivergencias | null; contexto: ContextoDoRelato; log?: Registrador },
): Promise<DivergenciaRegistrada[]> {
	const unicas = semRepeticao(divergencias);
	if (unicas.length === 0) return [];
	const registradas = await deps.repositorio.registrar(unicas);

	for (const registrada of registradas) {
		deps.log?.warn(`[nfse-nacional] o ADN mudou: ${registrada.tipo} ${registrada.detalhe} (${registrada.assinatura})`);
		if (!deps.relator || registrada.issue) continue;

		try {
			const { tipo, detalhe, assinatura } = registrada;
			registrada.issue = await deps.relator.relatar({ tipo, detalhe, assinatura, ...deps.contexto });
			await deps.repositorio.registrarIssue(assinatura, registrada.issue);
		}
		catch (erro) {
			deps.log?.warn(`[nfse-nacional] não consegui relatar ${registrada.assinatura}: ${erro instanceof Error ? erro.message : erro}`);
		}
	}

	return registradas;
}

/** Relator que envia ao relé (POST /relatos) e recebe a issue criada ou já existente. */
export function relatorRele(url: string, fazerFetch: typeof fetch = fetch): RelatorDeDivergencias {
	return {
		async relatar(relato) {
			const resposta = await fazerFetch(`${url.replace(/\/$/, '')}/relatos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(relato),
				signal: AbortSignal.timeout(15_000),
			});

			if (!resposta.ok) throw new Error(`relé respondeu HTTP ${resposta.status}`);
			return (await resposta.json()) as InfoIssue;
		},
	};
}

/** Consulta uma issue pela API pública do GitHub (sem token; limite de 60 consultas por hora). */
export async function consultarIssuePublica(numero: number, fazerFetch: typeof fetch = fetch): Promise<InfoIssue> {
	const resposta = await fazerFetch(`https://api.github.com/repos/${REPOSITORIO_GITHUB}/issues/${numero}`, {
		headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'nfse-nacional' },
		signal: AbortSignal.timeout(15_000),
	});

	if (!resposta.ok) throw new Error(`GitHub respondeu HTTP ${resposta.status}`);
	const issue = (await resposta.json()) as { number: number; html_url: string; state: string; milestone?: { title?: string } | null };
	const versao = issue.milestone?.title?.match(/^v?(\d+\.\d+\.\d+)$/)?.[1] ?? null;
	return { numero: issue.number, url: issue.html_url, estado: issue.state === 'closed' ? 'fechada' : 'aberta', corrigidaNaVersao: versao };
}

/** Acompanha as issues abertas: quando fecham, a instalação fica sabendo em que versão foi corrigido. */
export async function acompanharIssues(deps: {
	repositorio: RepositorioDivergencias;
	consultar?: (numero: number) => Promise<InfoIssue>;
	log?: Registrador;
}): Promise<DivergenciaRegistrada[]> {
	const consultar = deps.consultar ?? ((n: number) => consultarIssuePublica(n));
	const fechadas: DivergenciaRegistrada[] = [];

	for (const registrada of await deps.repositorio.comIssueAberta()) {
		if (!registrada.issue) continue;

		try {
			const atual = await consultar(registrada.issue.numero);
			if (atual.estado !== 'fechada') continue;
			await deps.repositorio.registrarIssue(registrada.assinatura, atual);
			fechadas.push({ ...registrada, issue: atual });

			deps.log?.info(
				`[nfse-nacional] issue #${atual.numero} (${registrada.tipo}) foi fechada${atual.corrigidaNaVersao ? `: corrigida na versão ${atual.corrigidaNaVersao}` : ''}.`,
			);
		}
		catch (erro) {
			deps.log?.warn(`[nfse-nacional] não consegui consultar a issue #${registrada.issue.numero}: ${erro instanceof Error ? erro.message : erro}`);
		}
	}

	return fechadas;
}
