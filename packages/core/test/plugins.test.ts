import type { FonteDeCertificado } from '../src/contratos.js';
import type { PluginNfse } from '../src/plugins.js';
import type { RegistrosNfse } from '../src/registros.js';
import { Buffer } from 'node:buffer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { carregarPlugins, ErroPlugin, listaDaConfig, RegistroDePlugins } from '../src/plugins.js';
import { criarRegistros, fonteArquivo } from '../src/registros.js';

describe('RegistroDePlugins', () => {
	it('cria a implementação escolhida por nome, com a configuração', () => {
		const registro = new RegistroDePlugins<{ valor: unknown }>('teste');
		registro.registrar('Eco', (c) => ({ valor: c.X }));
		expect(registro.criar(' eco ', { X: 1 })).toEqual({ valor: 1 });
		expect(registro.nomes()).toEqual(['eco']);
	});

	it('recusa nome duplicado ou desconhecido, listando os disponíveis', () => {
		const registro = new RegistroDePlugins<number>('provedor de chave');
		registro.registrar('env', () => 1);
		expect(() => registro.registrar('ENV', () => 2)).toThrow(ErroPlugin);
		expect(() => registro.criar('vault')).toThrow('provedor de chave "vault" não registrado (disponíveis: env).');
	});

	it('vem com as implementações embutidas', () => {
		const r = criarRegistros();
		expect(r.provedoresDeChave.nomes()).toEqual(['arquivo', 'dividida', 'env']);
		expect(r.fontesDeCertificado.nomes()).toEqual(['arquivo']);
	});
});

describe('carregarPlugins', () => {
	const pluginCofre: PluginNfse<RegistrosNfse> = {
		nome: 'cofre-de-teste',
		registrar(r) {
			r.provedoresDeChave.registrar('cofre', () => ({ tipo: 'cofre', obterChaveMestra: async () => Buffer.alloc(32) }));
		},
	};

	it('liga a implementação de um pacote externo pela configuração, sem mudar o núcleo', async () => {
		const registros = criarRegistros();
		const importar = async (e: string) => (e === 'nfse-plugin-cofre' ? { default: pluginCofre } : Promise.reject(new Error('não achei')));
		const nomes = await carregarPlugins(listaDaConfig(' nfse-plugin-cofre , '), registros, importar);
		expect(nomes).toEqual(['cofre-de-teste']);
		expect(registros.provedoresDeChave.criar('cofre').tipo).toBe('cofre');
	});

	it('carrega de um caminho absoluto (import real)', async () => {
		const pasta = mkdtempSync(path.join(tmpdir(), 'nfse-plugin-'));
		const arquivo = path.join(pasta, 'plugin.mjs');

		writeFileSync(
			arquivo,
			`export default { nome: 'fonte-fixa', registrar(r) { r.fontesDeCertificado.registrar('fixa', () => ({ obter: async () => ({ pfx: Buffer.from('x'), senha: 'y' }) })); } };`,
		);

		const registros = criarRegistros();
		await carregarPlugins([arquivo], registros);
		const fonte: FonteDeCertificado = registros.fontesDeCertificado.criar('fixa');
		expect((await fonte.obter({ id: 1, cnpj: '1', ambiente: 'producao', origemCertificado: 'fixa', ultimoNsu: 0 })).senha).toBe('y');
	});

	it('explica quando o pacote não existe ou não é um plugin', async () => {
		await expect(carregarPlugins(['nao-existe-xyz'], criarRegistros())).rejects.toThrow(/Não foi possível carregar o plugin "nao-existe-xyz"/);
		await expect(carregarPlugins(['x'], criarRegistros(), async () => ({ default: { nome: 'sem registrar' } }))).rejects.toThrow(/não exporta um plugin válido/);
	});
});

describe('fonte "arquivo"', () => {
	const pasta = mkdtempSync(path.join(tmpdir(), 'nfse-fonte-'));
	writeFileSync(path.join(pasta, 'cert.pfx'), 'conteudo');
	writeFileSync(path.join(pasta, 'senha'), 's3nha\n');
	const empresa = { id: 1, cnpj: '12345678000195', ambiente: 'producao' as const, origemCertificado: 'arquivo', ultimoNsu: 0, opcoes: { prefixoVariaveis: 'NFSE_E1' } };

	it('lê o certificado e a senha dos arquivos indicados pelas variáveis', async () => {
		const fonte = fonteArquivo({ NFSE_E1_CERT_PATH: path.join(pasta, 'cert.pfx'), NFSE_E1_CERT_SENHA_ARQUIVO: path.join(pasta, 'senha') });
		const { pfx, senha } = await fonte.obter(empresa);
		expect(pfx.toString()).toBe('conteudo');
		expect(senha).toBe('s3nha');
	});

	it('aceita a senha direto na variável e exige o prefixo e o caminho', async () => {
		expect((await fonteArquivo({ NFSE_E1_CERT_PATH: path.join(pasta, 'cert.pfx'), NFSE_E1_CERT_SENHA: 'abc' }).obter(empresa)).senha).toBe('abc');
		await expect(fonteArquivo({}).obter({ ...empresa, opcoes: {} })).rejects.toThrow(/sem prefixo/);
		await expect(fonteArquivo({}).obter(empresa)).rejects.toThrow(/NFSE_E1_CERT_PATH/);
	});
});
