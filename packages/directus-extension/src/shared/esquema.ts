import type { Contexto } from './tipos.js';

export const EMPRESAS = 'nfse_empresas';
export const DOCUMENTOS = 'nfse_documentos';

const id = {
	field: 'id',
	type: 'integer',
	meta: { hidden: true, readonly: true, interface: 'input' },
	schema: { is_primary_key: true, has_auto_increment: true },
};

const somenteLeitura = (meta: Record<string, unknown> = {}) => ({ readonly: true, ...meta });

const camposEmpresas = [
	id,
	{ field: 'cnpj', type: 'string', meta: { required: true, note: 'Só dígitos. O certificado precisa ter a mesma raiz (8 primeiros dígitos).', width: 'half' }, schema: { max_length: 14, is_unique: true, is_nullable: false } },
	{ field: 'nome', type: 'string', meta: { width: 'half' } },
	{ field: 'ativo', type: 'boolean', meta: { width: 'half', interface: 'boolean' }, schema: { default_value: true } },
	{
		field: 'ambiente',
		type: 'string',
		meta: {
			width: 'half',
			interface: 'select-dropdown',
			options: { choices: [{ text: 'Produção', value: 'producao' }, { text: 'Produção restrita (testes)', value: 'producao_restrita' }] },
		},
		schema: { default_value: 'producao' },
	},
	{
		field: 'origem_certificado',
		type: 'string',
		meta: {
			width: 'half',
			interface: 'select-dropdown',
			note: '"directus": enviado pela tela NFS-e Nacional e guardado cifrado. "arquivo": lido do servidor pelas variáveis <PREFIXO>_CERT_PATH e <PREFIXO>_CERT_SENHA_ARQUIVO.',
			options: { choices: [{ text: 'Guardado no Directus (cifrado)', value: 'directus' }, { text: 'Arquivo no servidor', value: 'arquivo' }] },
		},
		schema: { default_value: 'directus' },
	},
	{ field: 'prefixo_variaveis', type: 'string', meta: { width: 'half', note: 'Só para origem "arquivo". Ex.: NFSE_EMPRESA1 → NFSE_EMPRESA1_CERT_PATH.' } },
	{ field: 'ultimo_nsu', type: 'bigInteger', meta: { width: 'half', note: 'Cursor da distribuição. Volte para 0 para baixar tudo de novo.' }, schema: { default_value: 0, is_nullable: false } },
	{ field: 'situacao', type: 'string', meta: somenteLeitura({ width: 'half', note: 'ok, certificado_vencendo, certificado_vencido, sem_certificado ou erro.' }) },
	{ field: 'ultima_sincronizacao', type: 'timestamp', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'ultimo_erro', type: 'text', meta: somenteLeitura() },
	{ field: 'certificado_titular', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'certificado_validade', type: 'timestamp', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'certificado_impressao_digital', type: 'string', meta: somenteLeitura({ note: 'SHA-256 do certificado.' }) },
	{
		// Mascarado pelo Directus em qualquer leitura (inclusive admin, API e MCP). Só o plugin lê, direto no banco.
		field: 'certificado_cifrado',
		type: 'text',
		meta: { hidden: true, readonly: true, special: ['conceal'], interface: 'input', options: { masked: true } },
	},
];

const camposDocumentos = [
	id,
	{ field: 'empresa', type: 'integer', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], width: 'half', readonly: true, display: 'related-values', display_options: { template: '{{nome}}' } } },
	{ field: 'nsu', type: 'bigInteger', meta: somenteLeitura({ width: 'half' }), schema: { is_indexed: true } },
	{ field: 'tipo_documento', type: 'string', meta: somenteLeitura({ width: 'half', note: 'NFSE ou EVENTO.' }) },
	{ field: 'tipo_evento', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'chave_acesso', type: 'string', meta: somenteLeitura(), schema: { max_length: 60, is_indexed: true } },
	{ field: 'papel', type: 'string', meta: somenteLeitura({ width: 'half', note: 'Papel da empresa na nota: tomador, emitente ou intermediario.' }) },
	{ field: 'numero', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'situacao', type: 'string', meta: somenteLeitura({ width: 'half', note: 'cStat da nota.' }) },
	{ field: 'emissao', type: 'timestamp', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'competencia', type: 'date', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'valor_servico', type: 'decimal', meta: somenteLeitura({ width: 'half' }), schema: { numeric_precision: 15, numeric_scale: 2 } },
	{ field: 'valor_liquido', type: 'decimal', meta: somenteLeitura({ width: 'half' }), schema: { numeric_precision: 15, numeric_scale: 2 } },
	{ field: 'valor_iss', type: 'decimal', meta: somenteLeitura({ width: 'half' }), schema: { numeric_precision: 15, numeric_scale: 2 } },
	{ field: 'emitente_documento', type: 'string', meta: somenteLeitura({ width: 'half' }), schema: { is_indexed: true } },
	{ field: 'emitente_nome', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'tomador_documento', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'tomador_nome', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'municipio_prestacao', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'codigo_servico', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'descricao_servico', type: 'text', meta: somenteLeitura() },
	{ field: 'gerado_em', type: 'timestamp', meta: somenteLeitura({ width: 'half', note: 'DataHoraGeracao no ADN.' }) },
	{ field: 'xml', type: 'text', meta: somenteLeitura({ interface: 'input-code', options: { language: 'xml' } }) },
];

/** Cria as coleções que faltarem. Não altera nem apaga o que já existe. */
export async function garantirEsquema(ctx: Contexto): Promise<void> {
	const { CollectionsService, RelationsService } = ctx.services;
	const schema = await ctx.getSchema();
	const colecoes = new CollectionsService({ schema, accountability: null });

	if (!schema.collections[EMPRESAS]) {
		await colecoes.createOne({
			collection: EMPRESAS,
			meta: { icon: 'receipt_long', note: 'Empresas monitoradas no ADN da NFS-e Nacional', display_template: '{{nome}} ({{cnpj}})' },
			schema: {},
			fields: camposEmpresas,
		});

		ctx.logger.info(`[nfse-nacional] coleção ${EMPRESAS} criada`);
	}

	if (!schema.collections[DOCUMENTOS]) {
		await colecoes.createOne({
			collection: DOCUMENTOS,
			meta: {
				icon: 'description',
				note: 'NFS-e e eventos recebidos do ADN',
				display_template: '{{numero}} · {{emitente_nome}}',
				sort_field: null,
			},
			schema: {},
			fields: camposDocumentos,
		});

		const relacoes = new RelationsService({ schema: await ctx.getSchema(), accountability: null });

		await relacoes.createOne({
			collection: DOCUMENTOS,
			field: 'empresa',
			related_collection: EMPRESAS,
			schema: { on_delete: 'CASCADE' },
		});

		// Visão padrão da coleção (vale para todos os usuários até cada um personalizar a sua).
		const presets = new ctx.services.PresetsService({ schema: await ctx.getSchema(), accountability: null });

		await presets.createOne({
			collection: DOCUMENTOS,
			layout: 'tabular',
			layout_query: {
				tabular: {
					fields: ['emissao', 'numero', 'emitente_nome', 'valor_servico', 'papel', 'tipo_documento', 'empresa'],
					sort: ['-emissao'],
				},
			},
		});

		ctx.logger.info(`[nfse-nacional] coleção ${DOCUMENTOS} criada`);
	}
}
