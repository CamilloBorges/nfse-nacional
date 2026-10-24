import { XMLParser } from 'fast-xml-parser';

/**
 * Eventos da NFS-e Nacional (Anexo II do leiaute, v1.01): o XML traz um grupo cujo nome é o código do
 * evento (ex.: `evento/infEvento/pedRegEvento/infPedReg/e101101`). Cada evento aponta para a nota pela
 * chave de acesso (`chNFSe`); os de cancelamento, substituição e bloqueio mudam o estado da nota.
 */

export type EstadoNota = 'ativa' | 'cancelada' | 'substituida' | 'bloqueada';

type Efeito = 'cancelada' | 'substituida' | 'bloqueada' | 'desbloqueada' | null;

export const TIPOS_EVENTO: Record<string, { descricao: string; efeito: Efeito }> = {
	101_101: { descricao: 'Cancelamento de NFS-e', efeito: 'cancelada' },
	105_102: { descricao: 'Cancelamento de NFS-e por Substituição', efeito: 'substituida' },
	101_103: { descricao: 'Solicitação de Análise Fiscal para Cancelamento de NFS-e', efeito: null },
	105_104: { descricao: 'Cancelamento de NFS-e Deferido por Análise Fiscal', efeito: 'cancelada' },
	105_105: { descricao: 'Cancelamento de NFS-e Indeferido por Análise Fiscal', efeito: null },
	202_201: { descricao: 'Manifestação de NFS-e - Confirmação do Prestador', efeito: null },
	203_202: { descricao: 'Manifestação de NFS-e - Confirmação do Tomador', efeito: null },
	204_203: { descricao: 'Manifestação de NFS-e - Confirmação do Intermediário', efeito: null },
	205_204: { descricao: 'Manifestação de NFS-e - Confirmação Tácita', efeito: null },
	202_205: { descricao: 'Manifestação de NFS-e - Rejeição do Prestador', efeito: null },
	203_206: { descricao: 'Manifestação de NFS-e - Rejeição do Tomador', efeito: null },
	204_207: { descricao: 'Manifestação de NFS-e - Rejeição do Intermediário', efeito: null },
	205_208: { descricao: 'Manifestação de NFS-e - Anulação da Rejeição', efeito: null },
	305_101: { descricao: 'Cancelamento de NFS-e por Ofício', efeito: 'cancelada' },
	305_102: { descricao: 'Bloqueio de NFS-e por Ofício', efeito: 'bloqueada' },
	305_103: { descricao: 'Desbloqueio de NFS-e por Ofício', efeito: 'desbloqueada' },
};

export interface ResumoEvento {
	/** Chave de acesso da NFS-e a que o evento se refere. */
	chaveNfse: string | null;
	/** Código do evento, 6 dígitos (ex.: "101101"). */
	codigo: string | null;
	descricao: string | null;
	codigoMotivo: string | null;
	motivo: string | null;
	/** Chave da nota substituta (cancelamento por substituição). */
	chaveSubstituta: string | null;
	dataEvento: string | null;
	processadoEm: string | null;
	sequencia: number | null;
	autorDocumento: string | null;
}

const leitor = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: true });

export function lerEvento(xml: string): ResumoEvento {
	const inf = leitor.parse(xml)?.evento?.infEvento;
	const ped = inf?.pedRegEvento?.infPedReg;
	if (!ped) throw new Error('XML não é um evento da NFS-e nacional (falta evento/infEvento/pedRegEvento/infPedReg).');

	const grupo = Object.keys(ped).find((k) => /^e\d{6}$/.test(k));
	const dados = (grupo ? ped[grupo] : {}) as Record<string, unknown>;

	return {
		chaveNfse: texto(ped.chNFSe),
		codigo: grupo ? grupo.slice(1) : null,
		descricao: texto(dados.xDesc),
		codigoMotivo: texto(dados.cMotivo),
		motivo: texto(dados.xMotivo),
		chaveSubstituta: texto(dados.chSubstituta),
		dataEvento: texto(ped.dhEvento),
		processadoEm: texto(inf.dhProc),
		sequencia: inteiro(inf.nSeqEvento),
		autorDocumento: texto(ped.CNPJAutor) ?? texto(ped.CPFAutor),
	};
}

/**
 * Estado da nota a partir dos seus eventos. Cancelamento (inclusive por substituição ou de ofício) é
 * definitivo; bloqueio vale até um desbloqueio posterior.
 */
export function estadoDaNota(eventos: Array<{ codigo: string | null; dataEvento: string | null }>): EstadoNota {
	const efeitos = eventos
		.map((e) => ({ efeito: TIPOS_EVENTO[e.codigo ?? '']?.efeito ?? null, data: e.dataEvento ?? '' }))
		.filter((e) => e.efeito !== null);

	if (efeitos.some((e) => e.efeito === 'substituida')) return 'substituida';
	if (efeitos.some((e) => e.efeito === 'cancelada')) return 'cancelada';
	const bloqueios = efeitos.filter((e) => e.efeito === 'bloqueada' || e.efeito === 'desbloqueada').toSorted((a, b) => a.data.localeCompare(b.data));
	return bloqueios.at(-1)?.efeito === 'bloqueada' ? 'bloqueada' : 'ativa';
}

function texto(valor: unknown): string | null {
	if (valor === undefined || valor === null || valor === '') return null;
	return String(valor);
}

function inteiro(valor: unknown): number | null {
	const n = Number(texto(valor));
	return Number.isInteger(n) ? n : null;
}
