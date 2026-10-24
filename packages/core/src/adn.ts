import { Agent, request } from 'node:https';
import type { CertificadoAberto } from './certificado.js';

export const URLS_ADN = {
	producao: 'https://adn.nfse.gov.br',
	producao_restrita: 'https://adn.producaorestrita.nfse.gov.br',
} as const;

export type Ambiente = keyof typeof URLS_ADN;

/** Um documento do lote de distribuição. O XML vem em gzip + base64. */
export interface ItemDfe {
	NSU: number;
	ChaveAcesso: string;
	/** "NFSE" ou "EVENTO". */
	TipoDocumento: string;
	TipoEvento?: string | null;
	ArquivoXml: string;
	DataHoraGeracao?: string;
}

export interface RespostaDfe {
	/** Ex.: DOCUMENTOS_LOCALIZADOS, NENHUM_DOCUMENTO_LOCALIZADO. */
	StatusProcessamento: string;
	LoteDFe: ItemDfe[];
	Alertas?: unknown;
	Erros?: unknown;
	TipoAmbiente?: string;
	DataHoraProcessamento?: string;
}

export class ErroAdn extends Error {
	constructor(
		mensagem: string,
		readonly status: number,
		readonly corpo: unknown,
		/** Preenchido no HTTP 429 (Retry-After). */
		readonly esperarSegundos?: number,
	) {
		super(mensagem);
		this.name = 'ErroAdn';
	}
}

export interface OpcoesClienteAdn {
	certificado: Pick<CertificadoAberto, 'chavePem' | 'certificadoPem' | 'cadeiaPem'>;
	ambiente?: Ambiente;
	/** Sobrepõe o ambiente (testes). */
	urlBase?: string;
	/** CA extra para validar o servidor (testes). */
	ca?: string;
	tempoLimiteMs?: number;
}

/** Cliente das APIs de contribuintes do ADN, autenticado por mTLS com o certificado A1. */
export class ClienteAdn {
	private readonly agente: Agent;
	private readonly urlBase: string;
	private readonly tempoLimiteMs: number;

	constructor(opcoes: OpcoesClienteAdn) {
		this.urlBase = opcoes.urlBase ?? URLS_ADN[opcoes.ambiente ?? 'producao'];
		this.tempoLimiteMs = opcoes.tempoLimiteMs ?? 60_000;
		this.agente = new Agent({
			key: opcoes.certificado.chavePem,
			cert: [opcoes.certificado.certificadoPem, ...opcoes.certificado.cadeiaPem].join('\n'),
			ca: opcoes.ca,
			keepAlive: true,
			maxSockets: 1,
		});
	}

	/**
	 * GET /contribuintes/DFe/{NSU}: documentos com NSU posterior ao informado (até 50).
	 * `cnpjConsulta` permite consultar outro CNPJ com a mesma raiz do certificado.
	 */
	async consultarDfe(nsu: number, cnpjConsulta?: string): Promise<RespostaDfe> {
		const parametros = new URLSearchParams({ lote: 'true' });
		if (cnpjConsulta) parametros.set('cnpjConsulta', cnpjConsulta);
		return this.consultar(`/contribuintes/DFe/${nsu}?${parametros}`);
	}

	/** GET /contribuintes/NFSe/{ChaveAcesso}/Eventos. */
	async consultarEventos(chaveAcesso: string): Promise<RespostaDfe> {
		return this.consultar(`/contribuintes/NFSe/${encodeURIComponent(chaveAcesso)}/Eventos`);
	}

	fechar(): void {
		this.agente.destroy();
	}

	private async consultar(caminho: string): Promise<RespostaDfe> {
		const { status, corpo, cabecalhos } = await this.obter(caminho);
		const json = corpo as Partial<RespostaDfe> | null;

		if (status === 200) return { ...(json as RespostaDfe), LoteDFe: json?.LoteDFe ?? [] };
		// Sem documentos novos o ADN responde 404 (com ou sem corpo).
		if (status === 404) {
			return {
				...(json ?? {}),
				StatusProcessamento: json?.StatusProcessamento ?? 'NENHUM_DOCUMENTO_LOCALIZADO',
				LoteDFe: json?.LoteDFe ?? [],
			};
		}
		if (status === 429) {
			const espera = Number(cabecalhos['retry-after']);
			throw new ErroAdn('Limite de consultas do ADN atingido.', status, corpo, Number.isFinite(espera) ? espera : undefined);
		}
		throw new ErroAdn(`ADN respondeu HTTP ${status}${resumoErros(json)}`, status, corpo);
	}

	private obter(caminho: string): Promise<{ status: number; corpo: unknown; cabecalhos: Record<string, string | string[] | undefined> }> {
		const url = new URL(caminho, this.urlBase);
		return new Promise((resolver, rejeitar) => {
			const req = request(
				url,
				{ method: 'GET', agent: this.agente, headers: { Accept: 'application/json' }, timeout: this.tempoLimiteMs },
				(res) => {
					const partes: Buffer[] = [];
					res.on('data', (p: Buffer) => partes.push(p));
					res.on('end', () => {
						const texto = Buffer.concat(partes).toString('utf8');
						let corpo: unknown = null;
						if (texto) {
							try {
								corpo = JSON.parse(texto);
							} catch {
								corpo = texto;
							}
						}
						resolver({ status: res.statusCode ?? 0, corpo, cabecalhos: res.headers });
					});
					res.on('error', rejeitar);
				},
			);
			req.on('timeout', () => req.destroy(new Error(`Tempo esgotado consultando o ADN (${this.tempoLimiteMs} ms).`)));
			req.on('error', rejeitar);
			req.end();
		});
	}
}

function resumoErros(corpo: Partial<RespostaDfe> | null): string {
	const erros = (corpo as { Erros?: Array<{ Codigo?: string; Descricao?: string }> } | null)?.Erros;
	if (!Array.isArray(erros) || erros.length === 0) return '';
	return `: ${erros.map((e) => [e.Codigo, e.Descricao].filter(Boolean).join(' ')).join('; ')}`;
}
