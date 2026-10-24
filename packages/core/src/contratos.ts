import type { Buffer } from 'node:buffer';
import type { Ambiente, ItemDfe } from './adn.js';
import type { Papel, ResumoNfse } from './xml.js';

/**
 * Interfaces separadas (Separated Interface): o núcleo depende só delas; quem usa o núcleo
 * (a extensão do Directus, um script, outro sistema) fornece as implementações.
 */

/** Empresa monitorada, no formato do núcleo (cada repositório converte do seu). */
export interface EmpresaNfse {
	id: string | number;
	cnpj: string;
	ambiente: Ambiente;
	/** Nome da fonte de certificado registrada (ex.: "arquivo", "directus"). */
	origemCertificado: string;
	ultimoNsu: number;
	/** Opções específicas da fonte (ex.: prefixoVariaveis da fonte "arquivo"). */
	opcoes?: Record<string, unknown>;
}

export interface CertificadoBruto {
	pfx: Buffer;
	senha: string;
}

/** Ponto de extensão: de onde vem o certificado A1 de uma empresa. */
export interface FonteDeCertificado {
	obter: (empresa: EmpresaNfse) => Promise<CertificadoBruto>;
}

/** Ponto de extensão: de onde vem a chave-mestra que cifra os certificados em repouso. */
export interface ProvedorDeChave {
	readonly tipo: string;
	obterChaveMestra: () => Promise<Buffer>;
}

/** Documento do ADN já descompactado e, se for NFS-e, lido. */
export interface DocumentoRecebido {
	item: ItemDfe;
	xml: string;
	/** null para eventos ou quando o XML não pôde ser lido. */
	nota: ResumoNfse | null;
	papel: Papel | null;
}

export type SituacaoEmpresa = 'ok' | 'certificado_vencendo' | 'certificado_vencido' | 'sem_certificado' | 'erro';

export interface EstadoEmpresa {
	situacao: SituacaoEmpresa;
	erro: string | null;
	/** Preenchido quando a sincronização termina sem erro. */
	sincronizadoEm?: Date;
}

/** Ponto de extensão: onde as notas e o estado da sincronização são gravados. */
export interface RepositorioNfse {
	/** Deve ser idempotente por empresa + NSU e gravar `ultimoNsu` como novo cursor. */
	gravarLote: (empresa: EmpresaNfse, documentos: DocumentoRecebido[], ultimoNsu: number) => Promise<void>;
	registrarEstado: (empresa: EmpresaNfse, estado: EstadoEmpresa) => Promise<void>;
}

export interface Registrador {
	info: (mensagem: string) => void;
	warn: (mensagem: string) => void;
	error: (mensagem: string) => void;
}
