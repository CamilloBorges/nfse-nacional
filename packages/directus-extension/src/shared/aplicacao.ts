import type { Buffer } from 'node:buffer';
import type { DependenciasSincronizacao, DivergenciaRegistrada, EmpresaNfse, InfoCertificado, RegistrosNfse, ResultadoSincronizacao } from 'nfse-nacional-core';
import type { Contexto } from './tipos.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { acompanharIssues, carregarPlugins, criarRegistros, listaDaConfig, provedorDeChaveConfigurado, sincronizarEmpresa } from 'nfse-nacional-core';
import pacote from '../../package.json';
import { FonteDirectus } from './fonte-directus.js';
import { ErroUsuario, RepositorioDirectus } from './repositorio-directus.js';
import { RepositorioDivergenciasDirectus } from './repositorio-divergencias.js';

export const VERSAO_EXTENSAO: string = pacote.version;

export interface Situacao {
	versaoInstalada: string;
	/** Última versão publicada no npm (null se não deu para consultar). */
	ultimaVersao: string | null;
	relatarDivergencias: boolean;
	divergencias: DivergenciaRegistrada[];
}

/**
 * Composição (o "configurador" do padrão Plugin): monta os registros com as implementações
 * embutidas, a fonte "directus" e os pacotes listados em NFSE_PLUGINS. Hook e endpoint
 * compartilham a mesma instância, criada na primeira chamada.
 */
export interface Aplicacao {
	registros: RegistrosNfse;
	sincronizar: (empresaId: number) => Promise<ResultadoSincronizacao | null>;
	sincronizarTodas: () => Promise<void>;
	acompanharIssues: () => Promise<void>;
	situacao: () => Promise<Situacao>;
	salvarCertificado: (empresaId: number, pfx: Buffer, senha: string, accountability: unknown) => Promise<InfoCertificado>;
}

let instancia: Promise<Aplicacao> | undefined;

export function obterAplicacao(ctx: Contexto): Promise<Aplicacao> {
	instancia ??= montar(ctx).catch((erro) => {
		instancia = undefined; // permite tentar de novo depois de corrigir a configuração
		throw erro;
	});

	return instancia;
}

async function montar(ctx: Contexto): Promise<Aplicacao> {
	const registros = criarRegistros();
	// A fonte "directus" só existe dentro do Directus; resolve o provedor de chave a cada uso.
	registros.fontesDeCertificado.registrar('directus', (config) => new FonteDirectus(ctx, provedorDeChaveConfigurado(registros, config)));

	const plugins = await carregarPlugins(listaDaConfig(ctx.env.NFSE_PLUGINS), registros);
	if (plugins.length > 0) ctx.logger.info(`[nfse-nacional] plugins carregados: ${plugins.join(', ')}`);

	const repositorio = new RepositorioDirectus(ctx);
	const divergencias = new RepositorioDivergenciasDirectus(ctx);
	const versaoDirectus = lerVersaoDirectus();

	/** Dependências de uma sincronização; o consentimento é relido a cada vez. */
	const deps = async (empresa: EmpresaNfse): Promise<DependenciasSincronizacao> => {
		const configuracao = await divergencias.configuracao();

		const relator = configuracao.relatarDivergencias
			? registros.relatoresDeDivergencias.criar(String(ctx.env.NFSE_RELATOR ?? 'rele'), {
					...ctx.env,
					NFSE_URL_RELE: configuracao.urlRele ?? ctx.env.NFSE_URL_RELE,
				})
			: null;

		return {
			repositorio,
			fontesDeCertificado: registros.fontesDeCertificado,
			config: ctx.env,
			log: ctx.logger,
			divergencias: {
				repositorio: divergencias,
				relator,
				contexto: { versaoPacote: VERSAO_EXTENSAO, versaoDirectus, ambiente: empresa.ambiente, instalacao: configuracao.instalacao },
			},
		};
	};

	let ultimaVersao: { valor: string | null; em: number } | undefined;

	return {
		registros,
		async sincronizar(empresaId) {
			const empresa = await repositorio.lerEmpresa(empresaId);
			return sincronizarEmpresa(empresa, await deps(empresa));
		},
		async sincronizarTodas() {
			for (const empresa of await repositorio.empresasAtivas()) {
				// Uma empresa com problema não impede as outras; o erro fica no registro dela.
				await sincronizarEmpresa(empresa, await deps(empresa)).catch(() => {});
			}
		},
		async acompanharIssues() {
			await acompanharIssues({ repositorio: divergencias, log: ctx.logger });
		},
		async situacao() {
			// A consulta ao npm fica em cache por 6 horas.
			if (!ultimaVersao || Date.now() - ultimaVersao.em > 6 * 3_600_000) {
				ultimaVersao = { valor: await lerUltimaVersao(), em: Date.now() };
			}

			return {
				versaoInstalada: VERSAO_EXTENSAO,
				ultimaVersao: ultimaVersao.valor,
				relatarDivergencias: (await divergencias.configuracao()).relatarDivergencias,
				divergencias: await divergencias.todas(),
			};
		},
		async salvarCertificado(empresaId, pfx, senha, accountability) {
			const empresa = await repositorio.lerEmpresa(empresaId);
			const fonte = registros.fontesDeCertificado.criar('directus', ctx.env);
			if (!(fonte instanceof FonteDirectus)) throw new ErroUsuario('A fonte "directus" foi substituída e não aceita envio.');
			return fonte.salvar(empresa, pfx, senha, accountability);
		},
	};
}

async function lerUltimaVersao(): Promise<string | null> {
	try {
		const resposta = await fetch(`https://registry.npmjs.org/${pacote.name}/latest`, { signal: AbortSignal.timeout(10_000) });
		return resposta.ok ? ((await resposta.json()) as { version?: string }).version ?? null : null;
	}
	catch {
		return null;
	}
}

/**
 * Versão do Directus, para o relato (ajuda a separar mudança do ADN de mudança do Directus). Na imagem
 * oficial o projeto em /directus é o próprio pacote "directus"; numa instalação npm, é uma dependência.
 */
function lerVersaoDirectus(): string | undefined {
	try {
		const exigir = createRequire(path.join(process.cwd(), 'index.js'));
		return JSON.parse(readFileSync(exigir.resolve('directus/package.json'), 'utf8')).version;
	}
	catch {
		return undefined;
	}
}
