import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Criptografia em camadas (envelope): cada segredo é cifrado com uma chave própria (DEK),
 * e a DEK é cifrada com a chave-mestra (KEK), que nunca fica no banco. Trocar a chave-mestra
 * exige só recifrar as DEKs (ver `recifrar`).
 */

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_CHAVE = 32;

export class ErroChave extends Error {
	constructor(mensagem: string) {
		super(mensagem);
		this.name = 'ErroChave';
	}
}

export interface ProvedorDeChave {
	readonly tipo: string;
	obterChaveMestra(): Promise<Buffer>;
}

/** Gera uma chave-mestra (ou uma das partes da chave dividida) em base64. */
export function gerarChaveMestra(): string {
	return randomBytes(TAMANHO_CHAVE).toString('base64');
}

/** Chave-mestra numa variável de ambiente (base64 de 32 bytes). */
export function provedorEnv(valor: string | undefined): ProvedorDeChave {
	return {
		tipo: 'env',
		obterChaveMestra: async () => decodificarChave(valor, 'NFSE_CHAVE_MESTRA'),
	};
}

/** Chave-mestra num arquivo (ex.: secret do Docker). Lido a cada uso, então trocar o arquivo basta. */
export function provedorArquivo(caminho: string | undefined): ProvedorDeChave {
	return {
		tipo: 'arquivo',
		obterChaveMestra: async () => decodificarChave(await lerArquivo(caminho), 'NFSE_CHAVE_MESTRA_ARQUIVO'),
	};
}

/**
 * Chave dividida: uma parte na variável de ambiente e outra num arquivo, combinadas por HKDF.
 * Vazar só o ambiente ou só o arquivo não abre os certificados.
 */
export function provedorDividido(parteEnv: string | undefined, caminhoArquivo: string | undefined): ProvedorDeChave {
	return {
		tipo: 'dividida',
		async obterChaveMestra() {
			const a = decodificarChave(parteEnv, 'NFSE_CHAVE_MESTRA');
			const b = decodificarChave(await lerArquivo(caminhoArquivo), 'NFSE_CHAVE_MESTRA_ARQUIVO');
			return Buffer.from(hkdfSync('sha256', Buffer.concat([a, b]), 'nfse-nacional', 'chave-mestra', TAMANHO_CHAVE));
		},
	};
}

/** Escolhe o provedor pelas variáveis NFSE_CHAVE_PROVEDOR, NFSE_CHAVE_MESTRA e NFSE_CHAVE_MESTRA_ARQUIVO. */
export function criarProvedorDeChave(env: Record<string, unknown>): ProvedorDeChave {
	const tipo = String(env.NFSE_CHAVE_PROVEDOR ?? 'env').toLowerCase();
	const valor = env.NFSE_CHAVE_MESTRA as string | undefined;
	const arquivo = env.NFSE_CHAVE_MESTRA_ARQUIVO as string | undefined;
	switch (tipo) {
		case 'env':
			return provedorEnv(valor);
		case 'arquivo':
			return provedorArquivo(arquivo);
		case 'dividida':
			return provedorDividido(valor, arquivo);
		default:
			throw new ErroChave(`NFSE_CHAVE_PROVEDOR inválido: "${tipo}" (use env, arquivo ou dividida).`);
	}
}

interface Envelope {
	v: 1;
	/** Identificador da chave-mestra usada (não revela a chave). */
	kid: string;
	/** DEK cifrada com a chave-mestra: iv | tag | texto cifrado, em base64. */
	chave: string;
	/** Dados cifrados com a DEK: iv | tag | texto cifrado, em base64. */
	dados: string;
}

/**
 * Cifra `dados`. O `contexto` (ex.: o CNPJ da empresa) entra como dado autenticado:
 * um segredo copiado para outro registro não decifra.
 */
export function cifrar(dados: Buffer, chaveMestra: Buffer, contexto: string): string {
	validarTamanho(chaveMestra);
	const dek = randomBytes(TAMANHO_CHAVE);
	const envelope: Envelope = {
		v: 1,
		kid: identificadorDaChave(chaveMestra),
		chave: cifrarBloco(dek, chaveMestra, contexto),
		dados: cifrarBloco(dados, dek, contexto),
	};
	return JSON.stringify(envelope);
}

export function decifrar(texto: string, chaveMestra: Buffer, contexto: string): Buffer {
	validarTamanho(chaveMestra);
	const envelope = lerEnvelope(texto);
	if (envelope.kid !== identificadorDaChave(chaveMestra)) {
		throw new ErroChave('O segredo foi cifrado com outra chave-mestra.');
	}
	try {
		const dek = decifrarBloco(envelope.chave, chaveMestra, contexto);
		return decifrarBloco(envelope.dados, dek, contexto);
	} catch {
		throw new ErroChave('Não foi possível decifrar o segredo (contexto diferente ou dado adulterado).');
	}
}

/** Troca a chave-mestra de um segredo sem decifrar os dados (só a DEK é recifrada). */
export function recifrar(texto: string, chaveAntiga: Buffer, chaveNova: Buffer, contexto: string): string {
	validarTamanho(chaveNova);
	const envelope = lerEnvelope(texto);
	if (envelope.kid !== identificadorDaChave(chaveAntiga)) {
		throw new ErroChave('O segredo não foi cifrado com a chave antiga informada.');
	}
	const dek = decifrarBloco(envelope.chave, chaveAntiga, contexto);
	return JSON.stringify({ ...envelope, kid: identificadorDaChave(chaveNova), chave: cifrarBloco(dek, chaveNova, contexto) });
}

export function identificadorDaChave(chaveMestra: Buffer): string {
	return createHash('sha256').update('nfse-nacional:kid').update(chaveMestra).digest('hex').slice(0, 16);
}

function cifrarBloco(dados: Buffer, chave: Buffer, contexto: string): string {
	const iv = randomBytes(12);
	const cifra = createCipheriv(ALGORITMO, chave, iv);
	cifra.setAAD(Buffer.from(contexto, 'utf8'));
	const cifrado = Buffer.concat([cifra.update(dados), cifra.final()]);
	return Buffer.concat([iv, cifra.getAuthTag(), cifrado]).toString('base64');
}

function decifrarBloco(texto: string, chave: Buffer, contexto: string): Buffer {
	const bruto = Buffer.from(texto, 'base64');
	const decifra = createDecipheriv(ALGORITMO, chave, bruto.subarray(0, 12));
	decifra.setAAD(Buffer.from(contexto, 'utf8'));
	decifra.setAuthTag(bruto.subarray(12, 28));
	return Buffer.concat([decifra.update(bruto.subarray(28)), decifra.final()]);
}

function lerEnvelope(texto: string): Envelope {
	let envelope: Envelope;
	try {
		envelope = JSON.parse(texto);
	} catch {
		throw new ErroChave('Segredo armazenado em formato inválido.');
	}
	if (envelope?.v !== 1) throw new ErroChave('Versão de segredo não suportada.');
	return envelope;
}

function decodificarChave(valor: string | undefined, origem: string): Buffer {
	if (!valor?.trim()) throw new ErroChave(`${origem} não definida.`);
	const chave = Buffer.from(valor.trim(), 'base64');
	if (chave.length !== TAMANHO_CHAVE) {
		throw new ErroChave(`${origem} deve ter 32 bytes em base64 (gere com: npx nfse-nacional-core gerar-chave).`);
	}
	return chave;
}

async function lerArquivo(caminho: string | undefined): Promise<string> {
	if (!caminho) throw new ErroChave('NFSE_CHAVE_MESTRA_ARQUIVO não definida.');
	try {
		return await readFile(caminho, 'utf8');
	} catch {
		throw new ErroChave(`Não foi possível ler o arquivo da chave-mestra (${caminho}).`);
	}
}

function validarTamanho(chave: Buffer): void {
	if (chave.length !== TAMANHO_CHAVE) throw new ErroChave('A chave-mestra deve ter 32 bytes.');
}
