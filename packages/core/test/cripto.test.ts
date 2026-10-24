import { Buffer } from 'node:buffer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cifrar, decifrar, ErroChave, gerarChaveMestra, recifrar } from '../src/cripto.js';
import { ErroPlugin } from '../src/plugins.js';
import { criarRegistros, provedorDeChaveConfigurado } from '../src/registros.js';

const criarProvedorDeChave = (env: Record<string, unknown>) => provedorDeChaveConfigurado(criarRegistros(), env);

const chave = () => Buffer.from(gerarChaveMestra(), 'base64');

describe('envelope', () => {
	it('cifra e decifra', () => {
		const k = chave();
		const segredo = cifrar(Buffer.from('pfx e senha'), k, '12345678000195');
		expect(segredo).not.toContain('pfx e senha');
		expect(decifrar(segredo, k, '12345678000195').toString()).toBe('pfx e senha');
	});

	it('não decifra com outra chave-mestra', () => {
		const segredo = cifrar(Buffer.from('x'), chave(), 'c');
		expect(() => decifrar(segredo, chave(), 'c')).toThrow(/outra chave-mestra/);
	});

	it('não decifra se o segredo for copiado para outro contexto (empresa)', () => {
		const k = chave();
		const segredo = cifrar(Buffer.from('x'), k, '12345678000195');
		expect(() => decifrar(segredo, k, '99999999000199')).toThrow(ErroChave);
	});

	it('detecta adulteração', () => {
		const k = chave();
		const envelope = JSON.parse(cifrar(Buffer.from('dados'), k, 'c'));
		const bruto = Buffer.from(envelope.dados, 'base64');
		bruto[bruto.length - 1] ^= 1;
		envelope.dados = bruto.toString('base64');
		expect(() => decifrar(JSON.stringify(envelope), k, 'c')).toThrow(ErroChave);
	});

	it('troca a chave-mestra sem perder o segredo', () => {
		const antiga = chave();
		const nova = chave();
		const segredo = recifrar(cifrar(Buffer.from('x'), antiga, 'c'), antiga, nova, 'c');
		expect(decifrar(segredo, nova, 'c').toString()).toBe('x');
		expect(() => decifrar(segredo, antiga, 'c')).toThrow(ErroChave);
	});
});

describe('provedores de chave', () => {
	const pasta = mkdtempSync(path.join(tmpdir(), 'nfse-chave-'));
	const arquivo = path.join(pasta, 'parte');
	const parteArquivo = gerarChaveMestra();
	writeFileSync(arquivo, `${parteArquivo}\n`);
	const parteEnv = gerarChaveMestra();

	it('env (padrão)', async () => {
		const k = await criarProvedorDeChave({ NFSE_CHAVE_MESTRA: parteEnv }).obterChaveMestra();
		expect(k.toString('base64')).toBe(parteEnv);
	});

	it('arquivo', async () => {
		const k = await criarProvedorDeChave({ NFSE_CHAVE_PROVEDOR: 'arquivo', NFSE_CHAVE_MESTRA_ARQUIVO: arquivo }).obterChaveMestra();
		expect(k.toString('base64')).toBe(parteArquivo);
	});

	it('dividida: precisa das duas partes e não é igual a nenhuma delas', async () => {
		const provedor = criarProvedorDeChave({
			NFSE_CHAVE_PROVEDOR: 'dividida',
			NFSE_CHAVE_MESTRA: parteEnv,
			NFSE_CHAVE_MESTRA_ARQUIVO: arquivo,
		});
		const k = await provedor.obterChaveMestra();
		expect(k).toHaveLength(32);
		expect(k.toString('base64')).not.toBe(parteEnv);
		expect(k.toString('base64')).not.toBe(parteArquivo);
		expect((await provedor.obterChaveMestra()).equals(k)).toBe(true);

		await expect(criarProvedorDeChave({ NFSE_CHAVE_PROVEDOR: 'dividida', NFSE_CHAVE_MESTRA: parteEnv }).obterChaveMestra()).rejects.toThrow(ErroChave);
	});

	it('recusa chave curta ou ausente e provedor desconhecido', async () => {
		await expect(criarProvedorDeChave({ NFSE_CHAVE_MESTRA: 'curta' }).obterChaveMestra()).rejects.toThrow(/32 bytes/);
		await expect(criarProvedorDeChave({}).obterChaveMestra()).rejects.toThrow(/não definida/);
		expect(() => criarProvedorDeChave({ NFSE_CHAVE_PROVEDOR: 'cpu' })).toThrow(ErroPlugin);
	});
});
