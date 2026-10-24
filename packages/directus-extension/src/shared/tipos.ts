/** O que o plugin usa do contexto das extensões de API do Directus. */
export interface Contexto {
	// Os serviços internos não têm tipos estáveis entre versões (ver notas da 11.10.1).
	services: any;
	getSchema: () => Promise<any>;
	database: any;
	env: Record<string, unknown>;
	logger: {
		info: (msg: string) => void;
		warn: (msg: string) => void;
		error: (msg: string) => void;
	};
}

export interface Empresa {
	id: number;
	cnpj: string;
	nome: string | null;
	ativo: boolean;
	ambiente: 'producao' | 'producao_restrita';
	origem_certificado: 'directus' | 'arquivo';
	prefixo_variaveis: string | null;
	ultimo_nsu: number | string;
}
