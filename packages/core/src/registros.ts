import type { CertificadoBruto, EmpresaNfse, FonteDeCertificado, ProvedorDeChave } from './contratos.js';
import type { RelatorDeDivergencias } from './divergencias.js';
import { readFile } from 'node:fs/promises';
import { provedorArquivo, provedorDividido, provedorEnv } from './cripto.js';
import { relatorRele, URL_RELE_PADRAO } from './divergencias.js';
import { ErroPlugin, RegistroDePlugins } from './plugins.js';

/** Os pontos de extensão do núcleo. É o objeto que um pacote de plugins recebe em `registrar`. */
export interface RegistrosNfse {
	provedoresDeChave: RegistroDePlugins<ProvedorDeChave>;
	fontesDeCertificado: RegistroDePlugins<FonteDeCertificado>;
	relatoresDeDivergencias: RegistroDePlugins<RelatorDeDivergencias>;
}

/** Cria os registros já com as implementações embutidas. */
export function criarRegistros(): RegistrosNfse {
	const provedoresDeChave = new RegistroDePlugins<ProvedorDeChave>('provedor de chave');
	provedoresDeChave.registrar('env', (c) => provedorEnv(c.NFSE_CHAVE_MESTRA as string | undefined));
	provedoresDeChave.registrar('arquivo', (c) => provedorArquivo(c.NFSE_CHAVE_MESTRA_ARQUIVO as string | undefined));

	provedoresDeChave.registrar('dividida', (c) =>
		provedorDividido(c.NFSE_CHAVE_MESTRA as string | undefined, c.NFSE_CHAVE_MESTRA_ARQUIVO as string | undefined));

	const fontesDeCertificado = new RegistroDePlugins<FonteDeCertificado>('fonte de certificado');
	fontesDeCertificado.registrar('arquivo', (c) => fonteArquivo(c));

	const relatoresDeDivergencias = new RegistroDePlugins<RelatorDeDivergencias>('relator de divergências');
	relatoresDeDivergencias.registrar('rele', (c) => relatorRele(String(c.NFSE_URL_RELE || URL_RELE_PADRAO)));

	return { provedoresDeChave, fontesDeCertificado, relatoresDeDivergencias };
}

/** O provedor de chave escolhido pela configuração (NFSE_CHAVE_PROVEDOR, padrão "env"). */
export function provedorDeChaveConfigurado(registros: RegistrosNfse, config: Record<string, unknown>): ProvedorDeChave {
	return registros.provedoresDeChave.criar(String(config.NFSE_CHAVE_PROVEDOR ?? 'env'), config);
}

/**
 * Fonte "arquivo": o .pfx fica no servidor. Com `opcoes.prefixoVariaveis = "NFSE_EMPRESA1"`, lê
 * NFSE_EMPRESA1_CERT_PATH e a senha de NFSE_EMPRESA1_CERT_SENHA_ARQUIVO (ou NFSE_EMPRESA1_CERT_SENHA).
 * Os arquivos são lidos a cada uso: trocar o certificado não exige reiniciar.
 */
export function fonteArquivo(config: Record<string, unknown>): FonteDeCertificado {
	return {
		async obter(empresa: EmpresaNfse): Promise<CertificadoBruto> {
			const prefixo = String(empresa.opcoes?.prefixoVariaveis ?? '').trim();
			if (!prefixo) throw new ErroPlugin('Fonte "arquivo" sem prefixo de variáveis.');
			const caminho = config[`${prefixo}_CERT_PATH`] as string | undefined;
			if (!caminho) throw new ErroPlugin(`Variável ${prefixo}_CERT_PATH não definida.`);
			const arquivoSenha = config[`${prefixo}_CERT_SENHA_ARQUIVO`] as string | undefined;
			const senha = arquivoSenha
				? (await readFile(arquivoSenha, 'utf8')).replace(/\r?\n$/, '')
				: String(config[`${prefixo}_CERT_SENHA`] ?? '');
			return { pfx: await readFile(caminho), senha };
		},
	};
}
