/** Validação do relato: só passa o formato exato que o plugin envia, sem espaço para dado fiscal. */

export const TIPOS = [
	'leiaute_desconhecido',
	'status_desconhecido',
	'tipo_documento_desconhecido',
	'tipo_evento_desconhecido',
	'campo_ausente',
	'campo_essencial_vazio',
	'xml_ilegivel',
	'rota_alterada',
	'alerta_adn',
] as const;

export interface Relato {
	tipo: (typeof TIPOS)[number];
	detalhe: string;
	assinatura: string;
	versaoPacote: string;
	versaoDirectus?: string;
	ambiente: 'producao' | 'producao_restrita';
	instalacao: string;
}

const VERSAO = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[\w.]{1,20})?$/;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const DETALHE = /^[\w.:/@=#-]{1,80}$/;

/** Devolve o relato limpo ou a lista de problemas. */
export async function validarRelato(corpo: unknown): Promise<{ relato: Relato } | { erros: string[] }> {
	const r = (corpo ?? {}) as Record<string, unknown>;
	const erros: string[] = [];
	const texto = (campo: string) => (typeof r[campo] === 'string' ? (r[campo] as string) : '');

	if (!(TIPOS as readonly string[]).includes(texto('tipo'))) erros.push('tipo inválido');
	if (!DETALHE.test(texto('detalhe'))) erros.push('detalhe inválido');
	// Sequências de 7 ou mais dígitos podem ser CPF, CNPJ ou chave de acesso: nunca entram
	// (códigos oficiais de 6 dígitos, como o do evento, passam).
	if (/\d{7,}/.test(texto('detalhe'))) erros.push('detalhe com dados numéricos');
	if (!VERSAO.test(texto('versaoPacote'))) erros.push('versaoPacote inválida');
	if (r.versaoDirectus !== undefined && !VERSAO.test(texto('versaoDirectus'))) erros.push('versaoDirectus inválida');
	if (!['producao', 'producao_restrita'].includes(texto('ambiente'))) erros.push('ambiente inválido');
	if (!UUID.test(texto('instalacao'))) erros.push('instalacao inválida');

	// A assinatura precisa ser a do próprio tipo + detalhe (ninguém escolhe o título da issue).
	if (erros.length === 0 && texto('assinatura') !== (await assinar(texto('tipo'), texto('detalhe')))) erros.push('assinatura não confere');
	if (erros.length > 0) return { erros };

	return {
		relato: {
			tipo: texto('tipo') as Relato['tipo'],
			detalhe: texto('detalhe'),
			assinatura: texto('assinatura'),
			versaoPacote: texto('versaoPacote'),
			versaoDirectus: r.versaoDirectus === undefined ? undefined : texto('versaoDirectus'),
			ambiente: texto('ambiente') as Relato['ambiente'],
			instalacao: texto('instalacao'),
		},
	};
}

/** Mesma assinatura do nfse-nacional-core: sha256("tipo:detalhe"), 12 primeiros hexadecimais. */
export async function assinar(tipo: string, detalhe: string): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${tipo}:${detalhe}`));
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** a >= b, comparando x.y.z. */
export function versaoMaiorOuIgual(a: string, b: string): boolean {
	const [x, y] = [a, b].map((v) => v.split('-')[0]!.split('.').map(Number));

	for (let i = 0; i < 3; i++) {
		if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) > (y![i] ?? 0);
	}

	return true;
}
