import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { mesmaRaizCnpj } from './certificado.js';

/** `ArquivoXml` do ADN: gzip + base64. */
export function descompactarXml(arquivoXml: string): string {
	return gunzipSync(Buffer.from(arquivoXml, 'base64')).toString('utf8');
}

export interface Pessoa {
	/** CNPJ, CPF ou NIF, só dígitos (NIF como veio). */
	documento: string | null;
	nome: string | null;
}

/** Campos principais de uma NFS-e do leiaute nacional (raiz `NFSe`, namespace sped.fazenda.gov.br/nfse). */
export interface ResumoNfse {
	chaveAcesso: string | null;
	numero: string | null;
	situacao: string | null;
	emissao: string | null;
	competencia: string | null;
	valorServico: number | null;
	valorLiquido: number | null;
	valorIss: number | null;
	emitente: Pessoa;
	tomador: Pessoa;
	intermediario: Pessoa;
	municipioPrestacao: string | null;
	codigoServico: string | null;
	descricaoServico: string | null;
	versao: string | null;
}

export type Papel = 'emitente' | 'tomador' | 'intermediario' | 'outro';

const leitor = new XMLParser({
	removeNSPrefix: true,
	ignoreAttributes: false,
	attributeNamePrefix: '@',
	// Mantém tudo como texto: CNPJ, CPF e códigos têm zeros à esquerda.
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
});

export function lerNfse(xml: string): ResumoNfse {
	const raiz = leitor.parse(xml)?.NFSe;
	const inf = raiz?.infNFSe;
	if (!inf) throw new Error('XML não é uma NFS-e do padrão nacional (falta NFSe/infNFSe).');
	const dps = inf.DPS?.infDPS ?? {};
	const valores = dps.valores ?? {};
	const serv = dps.serv ?? {};

	return {
		chaveAcesso: texto(inf['@Id'])?.replace(/^NFS/, '') ?? null,
		numero: texto(inf.nNFSe),
		situacao: texto(inf.cStat),
		emissao: texto(dps.dhEmi),
		competencia: texto(dps.dCompet),
		valorServico: numero(valores.vServPrest?.vServ),
		valorLiquido: numero(inf.valores?.vLiq),
		valorIss: numero(inf.valores?.vISSQN),
		emitente: pessoa(inf.emit ?? dps.prest),
		tomador: pessoa(dps.toma),
		intermediario: pessoa(dps.interm),
		municipioPrestacao: texto(inf.xLocPrestacao) ?? texto(serv.locPrest?.cLocPrestacao),
		codigoServico: texto(serv.cServ?.cTribNac),
		descricaoServico: texto(serv.cServ?.xDescServ),
		versao: texto(raiz['@versao']),
	};
}

/** Em que papel o CNPJ (ou outro da mesma raiz) aparece na nota. */
export function papelNaNota(nota: ResumoNfse, cnpj: string): Papel {
	const confere = (p: Pessoa) => Boolean(p.documento && mesmaRaizCnpj(p.documento, cnpj));
	if (confere(nota.tomador)) return 'tomador';
	if (confere(nota.emitente)) return 'emitente';
	if (confere(nota.intermediario)) return 'intermediario';
	return 'outro';
}

function pessoa(no: Record<string, unknown> | undefined): Pessoa {
	if (!no) return { documento: null, nome: null };
	const documento = texto(no.CNPJ) ?? texto(no.CPF) ?? texto(no.NIF);
	return { documento: documento?.replace(/[^\dA-Za-z]/g, '') ?? null, nome: texto(no.xNome) };
}

function texto(valor: unknown): string | null {
	if (valor === undefined || valor === null || valor === '') return null;
	if (typeof valor === 'object') return texto((valor as Record<string, unknown>)['#text']);
	return String(valor);
}

function numero(valor: unknown): number | null {
	const t = texto(valor);
	if (t === null) return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
}
