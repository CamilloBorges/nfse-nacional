import type { Buffer } from 'node:buffer';
import type { InfoCertificado, RegistrosNfse, ResultadoSincronizacao } from 'nfse-nacional-core';
import type { Contexto } from './tipos.js';
import {
	carregarPlugins,
	criarRegistros,
	listaDaConfig,
	provedorDeChaveConfigurado,
	sincronizarEmpresa,
} from 'nfse-nacional-core';
import { FonteDirectus } from './fonte-directus.js';
import { ErroUsuario, RepositorioDirectus } from './repositorio-directus.js';

/**
 * Composição (o "configurador" do padrão Plugin): monta os registros com as implementações
 * embutidas, a fonte "directus" e os pacotes listados em NFSE_PLUGINS. Hook e endpoint
 * compartilham a mesma instância, criada na primeira chamada.
 */
export interface Aplicacao {
	registros: RegistrosNfse;
	sincronizar: (empresaId: number) => Promise<ResultadoSincronizacao | null>;
	sincronizarTodas: () => Promise<void>;
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
	const deps = () => ({ repositorio, fontesDeCertificado: registros.fontesDeCertificado, config: ctx.env, log: ctx.logger });

	return {
		registros,
		async sincronizar(empresaId) {
			return sincronizarEmpresa(await repositorio.lerEmpresa(empresaId), deps());
		},
		async sincronizarTodas() {
			for (const empresa of await repositorio.empresasAtivas()) {
				// Uma empresa com problema não impede as outras; o erro fica no registro dela.
				await sincronizarEmpresa(empresa, deps()).catch(() => {});
			}
		},
		async salvarCertificado(empresaId, pfx, senha, accountability) {
			const empresa = await repositorio.lerEmpresa(empresaId);
			const fonte = registros.fontesDeCertificado.criar('directus', ctx.env);
			if (!(fonte instanceof FonteDirectus)) throw new ErroUsuario('A fonte "directus" foi substituída e não aceita envio.');
			return fonte.salvar(empresa, pfx, senha, accountability);
		},
	};
}
