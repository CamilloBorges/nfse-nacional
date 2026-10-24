import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Padrão Plugin (Fowler, PoEAA): o núcleo define as interfaces e um registro por ponto de extensão;
 * as implementações são registradas por nome e a escolha acontece na configuração, em tempo de
 * execução, nunca no código. Um pacote externo estende o sistema registrando novas implementações.
 */

export class ErroPlugin extends Error {
	constructor(mensagem: string) {
		super(mensagem);
		this.name = 'ErroPlugin';
	}
}

export type Fabrica<T> = (config: Record<string, unknown>) => T;

export class RegistroDePlugins<T> {
	private readonly fabricas = new Map<string, Fabrica<T>>();

	/** `tipo` só aparece nas mensagens de erro (ex.: "provedor de chave"). */
	constructor(readonly tipo: string) {}

	registrar(nome: string, fabrica: Fabrica<T>): void {
		const chave = nome.trim().toLowerCase();
		if (!chave) throw new ErroPlugin(`Nome de ${this.tipo} vazio.`);
		if (this.fabricas.has(chave)) throw new ErroPlugin(`${this.tipo} "${chave}" já registrado.`);
		this.fabricas.set(chave, fabrica);
	}

	criar(nome: string, config: Record<string, unknown> = {}): T {
		const fabrica = this.fabricas.get(nome.trim().toLowerCase());

		if (!fabrica) {
			throw new ErroPlugin(`${this.tipo} "${nome}" não registrado (disponíveis: ${this.nomes().join(', ') || 'nenhum'}).`);
		}

		return fabrica(config);
	}

	tem(nome: string): boolean {
		return this.fabricas.has(nome.trim().toLowerCase());
	}

	nomes(): string[] {
		return [...this.fabricas.keys()].toSorted((a, b) => a.localeCompare(b));
	}
}

/** Contrato de um pacote de plugins: export default (ou `plugin`) com este formato. */
export interface PluginNfse<R = unknown> {
	nome: string;
	registrar: (registros: R) => void | Promise<void>;
}

/**
 * Carrega pacotes de plugins listados na configuração (ex.: NFSE_PLUGINS="pacote-a,/opt/plugin-b.js").
 * Aceita nome de pacote npm ou caminho absoluto. Devolve os nomes dos plugins carregados.
 */
export async function carregarPlugins<R>(
	especificadores: string[],
	registros: R,
	importar: (especificador: string) => Promise<unknown> = (e) => import(e),
): Promise<string[]> {
	const carregados: string[] = [];

	for (const bruto of especificadores) {
		const especificador = bruto.trim();
		if (!especificador) continue;
		const alvo = path.isAbsolute(especificador) ? pathToFileURL(especificador).href : especificador;

		let modulo: Record<string, unknown>;

		try {
			modulo = (await importar(alvo)) as Record<string, unknown>;
		}
		catch (erro) {
			throw new ErroPlugin(`Não foi possível carregar o plugin "${especificador}": ${erro instanceof Error ? erro.message : erro}`);
		}

		const plugin = (modulo.default ?? modulo.plugin) as Partial<PluginNfse<R>> | undefined;

		if (!plugin || typeof plugin.registrar !== 'function' || typeof plugin.nome !== 'string') {
			throw new ErroPlugin(`"${especificador}" não exporta um plugin válido ({ nome, registrar }).`);
		}

		await plugin.registrar(registros);
		carregados.push(plugin.nome);
	}

	return carregados;
}

/** Lê uma lista separada por vírgula da configuração. */
export function listaDaConfig(valor: unknown): string[] {
	return String(valor ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}
