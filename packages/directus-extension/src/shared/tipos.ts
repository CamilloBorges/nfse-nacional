import type { Registrador } from 'nfse-nacional-core';

/** O que o plugin usa do contexto das extensões de API do Directus. */
export interface Contexto {
	// Os serviços internos não têm tipos estáveis entre versões (ver notas da 11.10.1).
	services: any;
	getSchema: () => Promise<any>;
	database: any;
	env: Record<string, unknown>;
	logger: Registrador;
}

/** Registro da coleção nfse_empresas. */
export interface LinhaEmpresa {
	id: number;
	cnpj: string;
	nome: string | null;
	ativo: boolean;
	ambiente: 'producao' | 'producao_restrita' | null;
	origem_certificado: string | null;
	prefixo_variaveis: string | null;
	ultimo_nsu: number | string | null;
}
