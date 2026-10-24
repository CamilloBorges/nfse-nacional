import { ErroAdn, type ClienteAdn, type ItemDfe } from './adn.js';

/** O ADN devolve no máximo 50 documentos por consulta. */
export const TAMANHO_MAXIMO_LOTE = 50;

export interface OpcoesSincronizacao {
	cliente: Pick<ClienteAdn, 'consultarDfe'>;
	/** Último NSU já gravado (0 na primeira vez). */
	ultimoNsu: number;
	cnpjConsulta?: string;
	/** Lotes por execução; a próxima execução continua de onde parou. */
	maxLotes?: number;
	/** Pausa entre consultas, para não estourar o limite do ADN. */
	pausaMs?: number;
	/**
	 * Grava o lote. Só depois que ela termina o cursor avança: se falhar, a próxima
	 * execução pede o mesmo lote de novo (grave de forma idempotente, por NSU).
	 */
	aoReceberLote(itens: ItemDfe[], ultimoNsu: number): Promise<void>;
	dormir?: (ms: number) => Promise<void>;
}

export interface ResultadoSincronizacao {
	ultimoNsu: number;
	documentos: number;
	lotes: number;
	/** true quando chegou ao fim da fila; false quando parou em `maxLotes`. */
	concluido: boolean;
}

export async function sincronizar(opcoes: OpcoesSincronizacao): Promise<ResultadoSincronizacao> {
	const maxLotes = opcoes.maxLotes ?? 20;
	const pausaMs = opcoes.pausaMs ?? 1_000;
	const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

	let ultimoNsu = opcoes.ultimoNsu;
	let documentos = 0;
	let lotes = 0;
	let esperouLimite = false;

	while (lotes < maxLotes) {
		let resposta;
		try {
			resposta = await opcoes.cliente.consultarDfe(ultimoNsu, opcoes.cnpjConsulta);
		} catch (erro) {
			// Um 429 por vez é tolerado: espera e tenta de novo; o segundo seguido interrompe.
			if (erro instanceof ErroAdn && erro.status === 429 && !esperouLimite) {
				esperouLimite = true;
				await dormir(Math.min(erro.esperarSegundos ?? 30, 120) * 1_000);
				continue;
			}
			throw erro;
		}
		esperouLimite = false;

		const recebidos = resposta.LoteDFe ?? [];
		const novos = recebidos.filter((i) => Number(i.NSU) > ultimoNsu).sort((a, b) => Number(a.NSU) - Number(b.NSU));
		if (novos.length === 0) return { ultimoNsu, documentos, lotes, concluido: true };

		const maiorNsu = Number(novos[novos.length - 1].NSU);
		await opcoes.aoReceberLote(novos, maiorNsu);
		ultimoNsu = maiorNsu;
		documentos += novos.length;
		lotes++;

		if (recebidos.length < TAMANHO_MAXIMO_LOTE) return { ultimoNsu, documentos, lotes, concluido: true };
		await dormir(pausaMs);
	}
	return { ultimoNsu, documentos, lotes, concluido: false };
}
