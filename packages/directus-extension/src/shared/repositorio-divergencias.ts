import type { Divergencia, DivergenciaRegistrada, InfoIssue, RepositorioDivergencias } from 'nfse-nacional-core';
import type { Contexto } from './tipos.js';
import { CONFIGURACOES, DIVERGENCIAS } from './esquema.js';

interface LinhaDivergencia {
	id: number;
	assinatura: string;
	tipo: Divergencia['tipo'];
	detalhe: string;
	ocorrencias: number;
	issue_numero: number | null;
	issue_url: string | null;
	issue_estado: InfoIssue['estado'] | null;
	corrigida_na_versao: string | null;
}

export interface Configuracao {
	relatarDivergencias: boolean;
	urlRele: string | null;
	instalacao: string;
}

/** Implementação de RepositorioDivergencias sobre a coleção nfse_divergencias. */
export class RepositorioDivergenciasDirectus implements RepositorioDivergencias {
	constructor(private readonly ctx: Contexto) {}

	async registrar(divergencias: Divergencia[]): Promise<DivergenciaRegistrada[]> {
		const servico = await this.itens(DIVERGENCIAS);
		const agora = new Date().toISOString();
		const registradas: DivergenciaRegistrada[] = [];

		for (const d of divergencias) {
			const [existente]: LinhaDivergencia[] = await servico.readByQuery({ filter: { assinatura: { _eq: d.assinatura } }, limit: 1 });

			if (existente) {
				await servico.updateOne(existente.id, { ocorrencias: existente.ocorrencias + 1, ultima_ocorrencia: agora });
				registradas.push(paraRegistrada({ ...existente, ocorrencias: existente.ocorrencias + 1 }));
			}
			else {
				await servico.createOne({ ...d, ocorrencias: 1, ultima_ocorrencia: agora });
				registradas.push({ ...d, ocorrencias: 1, issue: null });
			}
		}

		return registradas;
	}

	async registrarIssue(assinatura: string, issue: InfoIssue): Promise<void> {
		const servico = await this.itens(DIVERGENCIAS);

		await servico.updateByQuery(
			{ filter: { assinatura: { _eq: assinatura } } },
			{ issue_numero: issue.numero, issue_url: issue.url, issue_estado: issue.estado, corrigida_na_versao: issue.corrigidaNaVersao },
		);
	}

	async comIssueAberta(): Promise<DivergenciaRegistrada[]> {
		const linhas: LinhaDivergencia[] = await (await this.itens(DIVERGENCIAS)).readByQuery({ filter: { issue_estado: { _eq: 'aberta' } }, limit: -1 });
		return linhas.map(paraRegistrada);
	}

	async todas(): Promise<DivergenciaRegistrada[]> {
		const linhas: LinhaDivergencia[] = await (await this.itens(DIVERGENCIAS)).readByQuery({ sort: ['-ultima_ocorrencia'], limit: 50 });
		return linhas.map(paraRegistrada);
	}

	/** Lida a cada uso: mudar o consentimento na tela vale na próxima sincronização. */
	async configuracao(): Promise<Configuracao> {
		const linha = await (await this.itens(CONFIGURACOES)).readSingleton({});

		return {
			relatarDivergencias: linha?.relatar_divergencias === true,
			urlRele: linha?.url_rele || null,
			instalacao: linha?.instalacao ?? 'desconhecida',
		};
	}

	private async itens(colecao: string) {
		return new this.ctx.services.ItemsService(colecao, { schema: await this.ctx.getSchema(), accountability: null });
	}
}

function paraRegistrada(linha: LinhaDivergencia): DivergenciaRegistrada {
	return {
		assinatura: linha.assinatura,
		tipo: linha.tipo,
		detalhe: linha.detalhe,
		ocorrencias: linha.ocorrencias,
		issue: linha.issue_numero
			? { numero: linha.issue_numero, url: linha.issue_url ?? '', estado: linha.issue_estado ?? 'aberta', corrigidaNaVersao: linha.corrigida_na_versao }
			: null,
	};
}
