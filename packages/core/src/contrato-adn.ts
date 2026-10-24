import type { ItemDfe, RespostaDfe } from './adn.js';
import type { ResumoEvento } from './eventos.js';
import type { ResumoNfse } from './xml.js';
import { createHash } from 'node:crypto';
import { TIPOS_EVENTO } from './eventos.js';

/**
 * O que esta versão do pacote sabe ler do ADN. Quando o ADN muda (nova versão de leiaute, status novo,
 * campo renomeado ou movido), a sincronização continua, mas gera uma divergência: assim quem usa é
 * avisado e, se consentir, o projeto recebe o relato. Fonte: gov.br/nfse → Documentação técnica.
 */
export const CONTRATO_ADN = {
	versoesLeiaute: ['1.00', '1.01'],
	statusProcessamento: ['DOCUMENTOS_LOCALIZADOS', 'NENHUM_DOCUMENTO_LOCALIZADO'],
	tiposDocumento: ['NFSE', 'EVENTO'],
	camposItem: ['NSU', 'ChaveAcesso', 'TipoDocumento', 'ArquivoXml'] as const,
	camposEssenciaisNota: ['chaveAcesso', 'numero', 'competencia', 'valorServico', 'emitente'] as const,
	camposEssenciaisEvento: ['chaveNfse', 'codigo', 'dataEvento'] as const,
} as const;

export type TipoDivergencia =
	| 'leiaute_desconhecido'
	| 'status_desconhecido'
	| 'tipo_documento_desconhecido'
	| 'tipo_evento_desconhecido'
	| 'campo_ausente'
	| 'campo_essencial_vazio'
	| 'xml_ilegivel'
	| 'rota_alterada'
	| 'alerta_adn';

/**
 * Uma diferença entre o que o ADN entregou e o contrato acima. Nunca carrega dado fiscal:
 * só nomes de campos, códigos e versões (ver `detalheSeguro`).
 */
export interface Divergencia {
	tipo: TipoDivergencia;
	detalhe: string;
	/** Identifica a mesma divergência em qualquer instalação (deduplicação das issues). */
	assinatura: string;
}

export function divergencia(tipo: TipoDivergencia, detalhe: string): Divergencia {
	const seguro = detalheSeguro(detalhe);
	return { tipo, detalhe: seguro, assinatura: createHash('sha256').update(`${tipo}:${seguro}`).digest('hex').slice(0, 12) };
}

/**
 * Deixa só caracteres de identificador e corta sequências de 7 ou mais dígitos (CPF, CNPJ, chave de
 * acesso); códigos oficiais de 6 dígitos, como o do evento, passam: o detalhe de uma divergência pode sair da instalação.
 */
export function detalheSeguro(texto: string): string {
	return texto
		.replaceAll(/[^\w.:/@=-]/g, '_')
		.replaceAll(/\d{7,}/g, '#')
		.slice(0, 80);
}

export function verificarResposta(resposta: RespostaDfe): Divergencia[] {
	const achadas: Divergencia[] = [];
	const status = String(resposta.StatusProcessamento ?? '');

	if (!(CONTRATO_ADN.statusProcessamento as readonly string[]).includes(status)) {
		achadas.push(divergencia('status_desconhecido', status || '(vazio)'));
	}

	for (const alerta of listaDeCodigos(resposta.Alertas)) achadas.push(divergencia('alerta_adn', alerta));
	return achadas;
}

export function verificarItem(item: ItemDfe): Divergencia[] {
	const achadas: Divergencia[] = [];

	for (const campo of CONTRATO_ADN.camposItem) {
		const valor = (item as unknown as Record<string, unknown>)[campo];
		if (valor === undefined || valor === null || valor === '') achadas.push(divergencia('campo_ausente', `LoteDFe.${campo}`));
	}

	if (item.TipoDocumento && !(CONTRATO_ADN.tiposDocumento as readonly string[]).includes(item.TipoDocumento)) {
		achadas.push(divergencia('tipo_documento_desconhecido', item.TipoDocumento));
	}

	return achadas;
}

export function verificarNota(nota: ResumoNfse): Divergencia[] {
	const achadas: Divergencia[] = [];

	if (!nota.versao || !(CONTRATO_ADN.versoesLeiaute as readonly string[]).includes(nota.versao)) {
		achadas.push(divergencia('leiaute_desconhecido', `NFSe@versao=${nota.versao ?? '(vazio)'}`));
	}

	for (const campo of CONTRATO_ADN.camposEssenciaisNota) {
		const valor = campo === 'emitente' ? nota.emitente.documento : nota[campo];
		if (valor === null || valor === undefined) achadas.push(divergencia('campo_essencial_vazio', `NFSe.${campo}`));
	}

	return achadas;
}

export function verificarEvento(evento: ResumoEvento): Divergencia[] {
	const achadas: Divergencia[] = [];

	for (const campo of CONTRATO_ADN.camposEssenciaisEvento) {
		if (evento[campo] === null) achadas.push(divergencia('campo_essencial_vazio', `evento.${campo}`));
	}

	if (evento.codigo && !TIPOS_EVENTO[evento.codigo]) achadas.push(divergencia('tipo_evento_desconhecido', `e${evento.codigo}`));
	return achadas;
}

/** Remove repetidas (mesma assinatura), mantendo a ordem. */
export function semRepeticao(divergencias: Divergencia[]): Divergencia[] {
	const vistas = new Set<string>();
	return divergencias.filter((d) => !vistas.has(d.assinatura) && vistas.add(d.assinatura));
}

/** Só os códigos dos alertas (a descrição pode citar dados do contribuinte). */
function listaDeCodigos(alertas: unknown): string[] {
	if (!Array.isArray(alertas)) return [];
	return alertas.map((a) => String((a as { Codigo?: unknown })?.Codigo ?? 'sem_codigo'));
}
