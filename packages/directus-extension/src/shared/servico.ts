import { readFile } from 'node:fs/promises';
import {
	abrirCertificado,
	cifrar,
	ClienteAdn,
	criarProvedorDeChave,
	decifrar,
	descompactarXml,
	diasParaVencer,
	ErroCertificado,
	lerNfse,
	mesmaRaizCnpj,
	papelNaNota,
	sincronizar,
	somenteDigitos,
	type CertificadoAberto,
	type InfoCertificado,
	type ItemDfe,
	type ResultadoSincronizacao,
} from 'nfse-nacional-core';
import { DOCUMENTOS, EMPRESAS } from './esquema.js';
import type { Contexto, Empresa } from './tipos.js';

/** A partir de quantos dias para vencer o certificado a empresa fica como "certificado_vencendo". */
const DIAS_AVISO = 30;

export class ErroUsuario extends Error {
	constructor(mensagem: string, readonly status = 400) {
		super(mensagem);
		this.name = 'ErroUsuario';
	}
}

/** Empresas sendo sincronizadas agora (evita duas execuções simultâneas na mesma instância). */
const emAndamento = new Set<number>();

export async function lerEmpresa(ctx: Contexto, id: number): Promise<Empresa> {
	const empresas = new ctx.services.ItemsService(EMPRESAS, { schema: await ctx.getSchema(), accountability: null });
	const empresa = await empresas.readOne(id).catch(() => null);
	if (!empresa) throw new ErroUsuario('Empresa não encontrada.', 404);
	return empresa as Empresa;
}

/** Valida o .pfx, cifra com a chave-mestra e guarda. Devolve só os metadados. */
export async function salvarCertificado(
	ctx: Contexto,
	empresaId: number,
	pfx: Buffer,
	senha: string,
	accountability: unknown,
): Promise<InfoCertificado> {
	const empresa = await lerEmpresa(ctx, empresaId);
	let certificado: CertificadoAberto;
	try {
		certificado = abrirCertificado(pfx, senha);
	} catch (erro) {
		throw new ErroUsuario(erro instanceof ErroCertificado ? erro.message : 'Arquivo de certificado inválido.');
	}
	if (!certificado.cnpj) throw new ErroUsuario('Não encontrei o CNPJ no certificado. Use um e-CNPJ A1.');
	if (!mesmaRaizCnpj(certificado.cnpj, empresa.cnpj)) {
		throw new ErroUsuario(`O certificado é do CNPJ ${certificado.cnpj}, que não tem a mesma raiz de ${empresa.cnpj}.`);
	}
	if (diasParaVencer(certificado) < 0) throw new ErroUsuario('O certificado já está vencido.');

	const chaveMestra = await criarProvedorDeChave(ctx.env).obterChaveMestra();
	const segredo = cifrar(Buffer.from(JSON.stringify({ pfx: pfx.toString('base64'), senha })), chaveMestra, contexto(empresa));

	// O campo cifrado é gravado direto no banco: pelos serviços ele seria mascarado (conceal).
	await ctx.database(EMPRESAS).where({ id: empresa.id }).update({ certificado_cifrado: segredo });

	// Os metadados passam pelo ItemsService com o usuário da requisição: a troca fica no log de atividades.
	const empresas = new ctx.services.ItemsService(EMPRESAS, { schema: await ctx.getSchema(), accountability });
	await empresas.updateOne(empresa.id, {
		origem_certificado: 'directus',
		certificado_titular: certificado.titular,
		certificado_validade: certificado.validoAte.toISOString(),
		certificado_impressao_digital: certificado.impressaoDigital,
		situacao: situacaoDoCertificado(certificado),
		ultimo_erro: null,
	});

	const { titular, cnpj, validoDe, validoAte, impressaoDigital } = certificado;
	return { titular, cnpj, validoDe, validoAte, impressaoDigital };
}

/** Abre o certificado da empresa (do Directus ou do arquivo). Lido a cada uso: trocar não exige reiniciar. */
export async function obterCertificado(ctx: Contexto, empresa: Empresa): Promise<CertificadoAberto> {
	if (empresa.origem_certificado === 'arquivo') {
		const prefixo = empresa.prefixo_variaveis?.trim();
		if (!prefixo) throw new ErroUsuario('Origem "arquivo" sem prefixo de variáveis.');
		const caminho = ctx.env[`${prefixo}_CERT_PATH`] as string | undefined;
		if (!caminho) throw new ErroUsuario(`Variável ${prefixo}_CERT_PATH não definida.`);
		const arquivoSenha = ctx.env[`${prefixo}_CERT_SENHA_ARQUIVO`] as string | undefined;
		const senha = arquivoSenha ? (await readFile(arquivoSenha, 'utf8')).replace(/\r?\n$/, '') : String(ctx.env[`${prefixo}_CERT_SENHA`] ?? '');
		return abrirCertificado(await readFile(caminho), senha);
	}

	const linha = await ctx.database(EMPRESAS).where({ id: empresa.id }).first('certificado_cifrado');
	if (!linha?.certificado_cifrado) throw new ErroUsuario('Nenhum certificado enviado para esta empresa.');
	const chaveMestra = await criarProvedorDeChave(ctx.env).obterChaveMestra();
	const { pfx, senha } = JSON.parse(decifrar(linha.certificado_cifrado, chaveMestra, contexto(empresa)).toString('utf8'));
	return abrirCertificado(Buffer.from(pfx, 'base64'), senha);
}

export async function sincronizarEmpresa(ctx: Contexto, empresa: Empresa): Promise<ResultadoSincronizacao | null> {
	if (emAndamento.has(empresa.id)) {
		ctx.logger.warn(`[nfse-nacional] ${empresa.cnpj}: sincronização anterior ainda em andamento, pulando.`);
		return null;
	}
	emAndamento.add(empresa.id);
	const atualizar = async (dados: Record<string, unknown>) => {
		const empresas = new ctx.services.ItemsService(EMPRESAS, { schema: await ctx.getSchema(), accountability: null });
		await empresas.updateOne(empresa.id, dados);
	};

	let cliente: ClienteAdn | undefined;
	try {
		let certificado: CertificadoAberto;
		try {
			certificado = await obterCertificado(ctx, empresa);
		} catch (erro) {
			await atualizar({ situacao: 'sem_certificado', ultimo_erro: mensagem(erro) });
			throw erro;
		}

		const dias = diasParaVencer(certificado);
		if (dias < 0) {
			await atualizar({ situacao: 'certificado_vencido', ultimo_erro: `Certificado vencido em ${certificado.validoAte.toISOString().slice(0, 10)}.` });
			ctx.logger.error(`[nfse-nacional] ${empresa.cnpj}: certificado vencido, sincronização suspensa.`);
			return null;
		}
		if (dias <= DIAS_AVISO) ctx.logger.warn(`[nfse-nacional] ${empresa.cnpj}: certificado vence em ${dias} dia(s).`);

		cliente = new ClienteAdn({ certificado, ambiente: empresa.ambiente ?? 'producao' });
		const cnpj = somenteDigitos(empresa.cnpj);
		const resultado = await sincronizar({
			cliente,
			ultimoNsu: Number(empresa.ultimo_nsu ?? 0),
			cnpjConsulta: certificado.cnpj === cnpj ? undefined : cnpj,
			maxLotes: Number(ctx.env.NFSE_MAX_LOTES ?? 20),
			pausaMs: Number(ctx.env.NFSE_PAUSA_MS ?? 1_000),
			aoReceberLote: (itens, ultimoNsu) => gravarLote(ctx, empresa, itens, ultimoNsu),
		});

		await atualizar({
			situacao: situacaoDoCertificado(certificado),
			ultima_sincronizacao: new Date().toISOString(),
			ultimo_erro: null,
		});
		ctx.logger.info(
			`[nfse-nacional] ${empresa.cnpj}: ${resultado.documentos} documento(s) em ${resultado.lotes} lote(s), NSU ${resultado.ultimoNsu}${resultado.concluido ? '' : ' (continua na próxima execução)'}.`,
		);
		return resultado;
	} catch (erro) {
		ctx.logger.error(`[nfse-nacional] ${empresa.cnpj}: ${mensagem(erro)}`);
		if (!(erro instanceof ErroUsuario)) {
			await atualizar({ situacao: 'erro', ultimo_erro: mensagem(erro) }).catch(() => undefined);
		}
		throw erro;
	} finally {
		cliente?.fechar();
		emAndamento.delete(empresa.id);
	}
}

export async function sincronizarTodas(ctx: Contexto): Promise<void> {
	const empresas = new ctx.services.ItemsService(EMPRESAS, { schema: await ctx.getSchema(), accountability: null });
	const ativas: Empresa[] = await empresas.readByQuery({ filter: { ativo: { _eq: true } }, limit: -1 });
	for (const empresa of ativas) {
		// Uma empresa com problema não impede as outras.
		await sincronizarEmpresa(ctx, empresa).catch(() => undefined);
	}
}

/** Grava o lote de forma idempotente (por empresa + NSU) e só então avança o cursor. */
async function gravarLote(ctx: Contexto, empresa: Empresa, itens: ItemDfe[], ultimoNsu: number): Promise<void> {
	const schema = await ctx.getSchema();
	const documentos = new ctx.services.ItemsService(DOCUMENTOS, { schema, accountability: null });
	const existentes: Array<{ nsu: number | string }> = await documentos.readByQuery({
		filter: { empresa: { _eq: empresa.id }, nsu: { _in: itens.map((i) => i.NSU) } },
		fields: ['nsu'],
		limit: -1,
	});
	const jaGravados = new Set(existentes.map((e) => Number(e.nsu)));
	const novos = itens.filter((i) => !jaGravados.has(Number(i.NSU))).map((i) => paraRegistro(ctx, empresa, i));
	if (novos.length) await documentos.createMany(novos);

	const empresas = new ctx.services.ItemsService(EMPRESAS, { schema, accountability: null });
	await empresas.updateOne(empresa.id, { ultimo_nsu: ultimoNsu });
}

function paraRegistro(ctx: Contexto, empresa: Empresa, item: ItemDfe): Record<string, unknown> {
	const xml = descompactarXml(item.ArquivoXml);
	const registro: Record<string, unknown> = {
		empresa: empresa.id,
		nsu: item.NSU,
		tipo_documento: item.TipoDocumento,
		tipo_evento: item.TipoEvento ?? null,
		chave_acesso: item.ChaveAcesso,
		gerado_em: item.DataHoraGeracao ?? null,
		xml,
	};
	if (item.TipoDocumento !== 'NFSE') return registro;

	try {
		const nota = lerNfse(xml);
		Object.assign(registro, {
			papel: papelNaNota(nota, empresa.cnpj),
			numero: nota.numero,
			situacao: nota.situacao,
			emissao: nota.emissao,
			competencia: nota.competencia,
			valor_servico: nota.valorServico,
			valor_liquido: nota.valorLiquido,
			valor_iss: nota.valorIss,
			emitente_documento: nota.emitente.documento,
			emitente_nome: nota.emitente.nome,
			tomador_documento: nota.tomador.documento,
			tomador_nome: nota.tomador.nome,
			municipio_prestacao: nota.municipioPrestacao,
			codigo_servico: nota.codigoServico,
			descricao_servico: nota.descricaoServico,
		});
	} catch (erro) {
		// Guarda o XML mesmo assim: os campos podem ser preenchidos depois.
		ctx.logger.warn(`[nfse-nacional] NSU ${item.NSU}: não consegui ler o XML (${mensagem(erro)}).`);
	}
	return registro;
}

function situacaoDoCertificado(certificado: Pick<InfoCertificado, 'validoAte'>): string {
	return diasParaVencer(certificado) <= DIAS_AVISO ? 'certificado_vencendo' : 'ok';
}

/** Amarra o segredo à empresa: copiado para outro registro, não decifra. */
function contexto(empresa: Empresa): string {
	return `nfse-nacional:${somenteDigitos(empresa.cnpj)}`;
}

function mensagem(erro: unknown): string {
	return erro instanceof Error ? erro.message : String(erro);
}
