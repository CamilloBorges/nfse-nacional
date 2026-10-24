import type { DocumentoRecebido, EmpresaNfse, EstadoEmpresa, RepositorioNfse } from 'nfse-nacional-core';
import type { Contexto, LinhaEmpresa } from './tipos.js';
import { DOCUMENTOS, EMPRESAS } from './esquema.js';

export class ErroUsuario extends Error {
	constructor(
		mensagem: string,
		readonly status = 400,
	) {
		super(mensagem);
		this.name = 'ErroUsuario';
	}
}

/** Implementação de RepositorioNfse sobre as coleções do Directus. */
export class RepositorioDirectus implements RepositorioNfse {
	constructor(private readonly ctx: Contexto) {}

	async lerEmpresa(id: number): Promise<EmpresaNfse> {
		const linha = await (await this.itens(EMPRESAS)).readOne(id).catch(() => null);
		if (!linha) throw new ErroUsuario('Empresa não encontrada.', 404);
		return paraEmpresa(linha);
	}

	async empresasAtivas(): Promise<EmpresaNfse[]> {
		const linhas: LinhaEmpresa[] = await (await this.itens(EMPRESAS)).readByQuery({ filter: { ativo: { _eq: true } }, limit: -1 });
		return linhas.map(paraEmpresa);
	}

	/** Idempotente por empresa + NSU; o cursor só avança depois de gravar o lote. */
	async gravarLote(empresa: EmpresaNfse, documentos: DocumentoRecebido[], ultimoNsu: number): Promise<void> {
		const servico = await this.itens(DOCUMENTOS);
		const existentes: Array<{ nsu: number | string }> = await servico.readByQuery({
			filter: { empresa: { _eq: empresa.id }, nsu: { _in: documentos.map((d) => d.item.NSU) } },
			fields: ['nsu'],
			limit: -1,
		});
		const jaGravados = new Set(existentes.map((e) => Number(e.nsu)));
		const novos = documentos.filter((d) => !jaGravados.has(Number(d.item.NSU))).map((d) => paraRegistro(empresa, d));
		if (novos.length > 0) await servico.createMany(novos);
		await (await this.itens(EMPRESAS)).updateOne(empresa.id, { ultimo_nsu: ultimoNsu });
	}

	async registrarEstado(empresa: EmpresaNfse, estado: EstadoEmpresa): Promise<void> {
		await (await this.itens(EMPRESAS)).updateOne(empresa.id, {
			situacao: estado.situacao,
			ultimo_erro: estado.erro,
			...(estado.sincronizadoEm ? { ultima_sincronizacao: estado.sincronizadoEm.toISOString() } : {}),
		});
	}

	/** Serviços sem accountability: o plugin age como sistema (as permissões valem para quem lê as coleções). */
	private async itens(colecao: string) {
		return new this.ctx.services.ItemsService(colecao, { schema: await this.ctx.getSchema(), accountability: null });
	}
}

export function paraEmpresa(linha: LinhaEmpresa): EmpresaNfse {
	return {
		id: linha.id,
		cnpj: linha.cnpj,
		ambiente: linha.ambiente ?? 'producao',
		origemCertificado: linha.origem_certificado ?? 'directus',
		ultimoNsu: Number(linha.ultimo_nsu ?? 0),
		opcoes: { prefixoVariaveis: linha.prefixo_variaveis },
	};
}

function paraRegistro(empresa: EmpresaNfse, { item, xml, nota, papel }: DocumentoRecebido): Record<string, unknown> {
	return {
		empresa: empresa.id,
		nsu: item.NSU,
		tipo_documento: item.TipoDocumento,
		tipo_evento: item.TipoEvento ?? null,
		chave_acesso: item.ChaveAcesso,
		gerado_em: item.DataHoraGeracao ?? null,
		xml,
		...(nota
			? {
					papel,
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
				}
			: {}),
	};
}
