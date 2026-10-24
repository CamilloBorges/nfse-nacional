import type { Divergencia } from '../src/contrato-adn.js';
import type { DivergenciaRegistrada, InfoIssue, RelatoDivergencia, RelatorDeDivergencias, RepositorioDivergencias } from '../src/divergencias.js';

/** Repositório de divergências em memória (Service Stub). */
export class DivergenciasEmMemoria implements RepositorioDivergencias {
	readonly porAssinatura = new Map<string, DivergenciaRegistrada>();

	async registrar(divergencias: Divergencia[]): Promise<DivergenciaRegistrada[]> {
		return divergencias.map((d) => {
			const existente = this.porAssinatura.get(d.assinatura);
			const registrada = existente ? { ...existente, ocorrencias: existente.ocorrencias + 1 } : { ...d, ocorrencias: 1, issue: null };
			this.porAssinatura.set(d.assinatura, registrada);
			return { ...registrada };
		});
	}

	async registrarIssue(assinatura: string, issue: InfoIssue): Promise<void> {
		const registrada = this.porAssinatura.get(assinatura);
		if (registrada) this.porAssinatura.set(assinatura, { ...registrada, issue });
	}

	async comIssueAberta(): Promise<DivergenciaRegistrada[]> {
		return [...this.porAssinatura.values()].filter((d) => d.issue?.estado === 'aberta');
	}
}

/** Relator que só anota o que recebeu e devolve uma issue numerada. */
export class RelatorFalso implements RelatorDeDivergencias {
	readonly relatos: RelatoDivergencia[] = [];

	async relatar(relato: RelatoDivergencia): Promise<InfoIssue> {
		this.relatos.push(relato);
		return { numero: 100 + this.relatos.length, url: `https://github.com/x/y/issues/${100 + this.relatos.length}`, estado: 'aberta', corrigidaNaVersao: null };
	}
}

export const CONTEXTO_RELATO = { versaoPacote: '0.3.0', versaoDirectus: '12.4.1', ambiente: 'producao_restrita', instalacao: 'inst-teste' };
