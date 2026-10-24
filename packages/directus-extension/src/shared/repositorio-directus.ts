import type { DocumentoRecebido, EmpresaNfse, EstadoEmpresa, RepositorioNfse, ResumoEvento } from 'nfse-nacional-core';
import type { Contexto, LinhaEmpresa } from './tipos.js';
import { estadoDaNota, lerEvento } from 'nfse-nacional-core';
import { DOCUMENTOS, EMPRESAS, EVENTOS } from './esquema.js';

export class ErroUsuario extends Error {
	constructor(
		mensagem: string,
		readonly status = 400,
	) {
		super(mensagem);
		this.name = 'ErroUsuario';
	}
}

interface LinhaEvento {
	id: number;
	chave_acesso: string | null;
	codigo: string | null;
	data_evento: string | null;
	nota: number | null;
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

	/**
	 * Notas em nfse_documentos, eventos em nfse_eventos (filha). Idempotente por empresa + NSU; o cursor só
	 * avança depois de gravar o lote. Ao fim, liga eventos às notas pela chave e recalcula o estado.
	 */
	async gravarLote(empresa: EmpresaNfse, documentos: DocumentoRecebido[], ultimoNsu: number): Promise<void> {
		const notas = documentos.filter((d) => d.item.TipoDocumento !== 'EVENTO');
		const eventos = documentos.filter((d) => d.item.TipoDocumento === 'EVENTO');

		await this.inserirNovos(DOCUMENTOS, empresa.id, notas.map((d) => paraNota(empresa, d)));
		await this.inserirNovos(EVENTOS, empresa.id, eventos.map((d) => paraEvento(empresa.id, d.item.NSU, chaveDoEvento(d), d.evento, d.xml, d.item.DataHoraGeracao)));
		await this.vincularEventos(documentos.map((d) => (d.item.TipoDocumento === 'EVENTO' ? chaveDoEvento(d) : d.item.ChaveAcesso)));
		await (await this.itens(EMPRESAS)).updateOne(empresa.id, { ultimo_nsu: ultimoNsu });
	}

	async registrarEstado(empresa: EmpresaNfse, estado: EstadoEmpresa): Promise<void> {
		await (await this.itens(EMPRESAS)).updateOne(empresa.id, {
			situacao: estado.situacao,
			ultimo_erro: estado.erro,
			...(estado.sincronizadoEm ? { ultima_sincronizacao: estado.sincronizadoEm.toISOString() } : {}),
		});
	}

	/**
	 * Migração da 0.4.0: até a 0.3.x os eventos eram gravados em nfse_documentos. Move-os para
	 * nfse_eventos (lendo o XML guardado) e marca as notas. Idempotente: sem eventos antigos, não faz nada.
	 */
	async migrarEventosAntigos(): Promise<number> {
		const documentos = await this.itens(DOCUMENTOS);
		const antigos: Array<{ id: number; empresa: number; nsu: number | string; chave_acesso: string; xml: string; gerado_em: string | null }> = await documentos.readByQuery({
			filter: { tipo_documento: { _eq: 'EVENTO' } },
			fields: ['id', 'empresa', 'nsu', 'chave_acesso', 'xml', 'gerado_em'],
			limit: -1,
		});

		if (antigos.length === 0) return 0;

		const registros = antigos.map((a) => {
			const evento = lerSemFalhar(a.xml);
			return paraEvento(a.empresa, Number(a.nsu), evento?.chaveNfse ?? a.chave_acesso, evento, a.xml, a.gerado_em);
		});

		for (const empresa of new Set(antigos.map((a) => a.empresa))) {
			await this.inserirNovos(EVENTOS, empresa, registros.filter((r) => r.empresa === empresa));
		}

		await documentos.deleteMany(antigos.map((a) => a.id));
		await this.vincularEventos(registros.map((r) => r.chave_acesso as string));
		this.ctx.logger.info(`[nfse-nacional] ${antigos.length} evento(s) movido(s) de ${DOCUMENTOS} para ${EVENTOS}`);
		return antigos.length;
	}

	/** Insere só os registros cujo NSU ainda não existe para a empresa na coleção. */
	private async inserirNovos(colecao: string, empresa: number | string, registros: Array<Record<string, unknown>>): Promise<void> {
		if (registros.length === 0) return;
		const servico = await this.itens(colecao);

		const existentes: Array<{ nsu: number | string }> = await servico.readByQuery({
			filter: { empresa: { _eq: empresa }, nsu: { _in: registros.map((r) => r.nsu) } },
			fields: ['nsu'],
			limit: -1,
		});

		const jaGravados = new Set(existentes.map((e) => Number(e.nsu)));
		const novos = registros.filter((r) => !jaGravados.has(Number(r.nsu)));
		if (novos.length > 0) await servico.createMany(novos);
	}

	/**
	 * Liga cada evento à sua nota pela chave (nos dois sentidos: o evento pode chegar antes da nota)
	 * e recalcula o estado das notas envolvidas.
	 */
	private async vincularEventos(chaves: Array<string | null | undefined>): Promise<void> {
		const unicas = [...new Set(chaves.filter(Boolean))];
		if (unicas.length === 0) return;
		const servicoNotas = await this.itens(DOCUMENTOS);
		const servicoEventos = await this.itens(EVENTOS);

		const eventos: LinhaEvento[] = await servicoEventos.readByQuery({
			filter: { chave_acesso: { _in: unicas } },
			fields: ['id', 'chave_acesso', 'codigo', 'data_evento', 'nota'],
			limit: -1,
		});

		if (eventos.length === 0) return;

		const notas: Array<{ id: number; chave_acesso: string; estado: string | null }> = await servicoNotas.readByQuery({
			filter: { chave_acesso: { _in: [...new Set(eventos.map((e) => e.chave_acesso))] } },
			fields: ['id', 'chave_acesso', 'estado'],
			limit: -1,
		});

		for (const nota of notas) {
			const daNota = eventos.filter((e) => e.chave_acesso === nota.chave_acesso);
			const soltos = daNota.filter((e) => e.nota !== nota.id).map((e) => e.id);
			if (soltos.length > 0) await servicoEventos.updateMany(soltos, { nota: nota.id });
			const estado = estadoDaNota(daNota.map((e) => ({ codigo: e.codigo, dataEvento: e.data_evento })));
			if (estado !== nota.estado) await servicoNotas.updateOne(nota.id, { estado });
		}
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

/** Pelo XML quando possível (chNFSe); senão, a chave que o ADN informou no lote. */
function chaveDoEvento(d: DocumentoRecebido): string {
	return d.evento?.chaveNfse ?? d.item.ChaveAcesso;
}

function lerSemFalhar(xml: string): ResumoEvento | null {
	try {
		return lerEvento(xml);
	}
	catch {
		return null;
	}
}

function paraEvento(
	empresa: number | string,
	nsu: number,
	chave: string,
	evento: ResumoEvento | null,
	xml: string,
	geradoEm: string | null | undefined,
): Record<string, unknown> {
	return {
		empresa,
		nsu,
		chave_acesso: chave,
		codigo: evento?.codigo ?? null,
		descricao: evento?.descricao ?? null,
		codigo_motivo: evento?.codigoMotivo ?? null,
		motivo: evento?.motivo ?? null,
		chave_substituta: evento?.chaveSubstituta ?? null,
		data_evento: evento?.dataEvento ?? null,
		processado_em: evento?.processadoEm ?? null,
		sequencia: evento?.sequencia ?? null,
		autor_documento: evento?.autorDocumento ?? null,
		gerado_em: geradoEm ?? null,
		xml,
	};
}

function paraNota(empresa: EmpresaNfse, { item, xml, nota, papel }: DocumentoRecebido): Record<string, unknown> {
	return {
		empresa: empresa.id,
		nsu: item.NSU,
		tipo_documento: item.TipoDocumento,
		chave_acesso: item.ChaveAcesso,
		estado: 'ativa',
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
