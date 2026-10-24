import type { Contexto } from './tipos.js';
import { randomUUID } from 'node:crypto';

export const EMPRESAS = 'nfse_empresas';
export const DOCUMENTOS = 'nfse_documentos';
export const CONFIGURACOES = 'nfse_configuracoes';
export const DIVERGENCIAS = 'nfse_divergencias';
export const EVENTOS = 'nfse_eventos';

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
	{ field: 'situacao', type: 'string', meta: somenteLeitura({ width: 'half', note: 'ok, certificado_vencendo, certificado_vencido, sem_certificado, adn_alterado ou erro.' }) },
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

/** Estado da nota, derivado dos eventos (cancelamento, substituição, bloqueio). */
const CAMPO_ESTADO = {
	field: 'estado',
	type: 'string',
	meta: somenteLeitura({
		width: 'half',
		note: 'Calculado pelos eventos: ativa, cancelada, substituida ou bloqueada.',
		display: 'labels',
		display_options: {
			choices: [
				{ text: 'Ativa', value: 'ativa', foreground: 'var(--theme--success)' },
				{ text: 'Cancelada', value: 'cancelada', foreground: 'var(--theme--danger)' },
				{ text: 'Substituída', value: 'substituida', foreground: 'var(--theme--warning)' },
				{ text: 'Bloqueada', value: 'bloqueada', foreground: 'var(--theme--warning)' },
			],
		},
	}),
	schema: { default_value: 'ativa', is_indexed: true },
};

/** Lista dos eventos dentro da nota (lado "um" da relação nfse_eventos.nota). */
const CAMPO_EVENTOS = {
	field: 'eventos',
	type: 'alias',
	meta: { special: ['o2m'], interface: 'list-o2m', readonly: true, options: { template: '{{data_evento}} · {{descricao}}' } },
};

const camposDocumentos = [
	id,
	{ field: 'empresa', type: 'integer', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], width: 'half', readonly: true, display: 'related-values', display_options: { template: '{{nome}}' } } },
	{ field: 'nsu', type: 'bigInteger', meta: somenteLeitura({ width: 'half' }), schema: { is_indexed: true } },
	{ field: 'tipo_documento', type: 'string', meta: somenteLeitura({ width: 'half', hidden: true, note: 'Sempre NFSE (os eventos ficam em nfse_eventos desde a 0.4.0).' }) },
	{ field: 'tipo_evento', type: 'string', meta: somenteLeitura({ width: 'half', hidden: true }) },
	{ field: 'chave_acesso', type: 'string', meta: somenteLeitura(), schema: { max_length: 60, is_indexed: true } },
	{ field: 'papel', type: 'string', meta: somenteLeitura({ width: 'half', note: 'Papel da empresa na nota: tomador, emitente ou intermediario.' }) },
	{ field: 'numero', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'situacao', type: 'string', meta: somenteLeitura({ width: 'half', note: 'cStat da nota.' }) },
	CAMPO_ESTADO,
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

const camposEventos = [
	id,
	{ field: 'empresa', type: 'integer', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], width: 'half', readonly: true, display: 'related-values', display_options: { template: '{{nome}}' } } },
	{ field: 'nota', type: 'integer', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], width: 'half', readonly: true, note: 'Preenchido assim que a nota estiver na base (vínculo pela chave de acesso).', display: 'related-values', display_options: { template: '{{numero}} · {{emitente_nome}}' } } },
	{ field: 'nsu', type: 'bigInteger', meta: somenteLeitura({ width: 'half' }), schema: { is_indexed: true } },
	{ field: 'chave_acesso', type: 'string', meta: somenteLeitura({ width: 'half', note: 'Chave da NFS-e a que o evento se refere.' }), schema: { max_length: 60, is_indexed: true } },
	{ field: 'codigo', type: 'string', meta: somenteLeitura({ width: 'half', note: 'Código do evento (Anexo II): 101101 = cancelamento, 105102 = substituição...' }) },
	{ field: 'descricao', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'codigo_motivo', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'motivo', type: 'text', meta: somenteLeitura() },
	{ field: 'chave_substituta', type: 'string', meta: somenteLeitura({ note: 'Nota que substituiu esta (cancelamento por substituição).' }), schema: { max_length: 60 } },
	{ field: 'data_evento', type: 'timestamp', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'processado_em', type: 'timestamp', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'sequencia', type: 'integer', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'autor_documento', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'gerado_em', type: 'timestamp', meta: somenteLeitura({ width: 'half', note: 'DataHoraGeracao no ADN.' }) },
	{ field: 'xml', type: 'text', meta: somenteLeitura({ interface: 'input-code', options: { language: 'xml' } }) },
];

const camposConfiguracoes = [
	id,
	{
		field: 'relatar_divergencias',
		type: 'boolean',
		meta: {
			interface: 'boolean',
			options: { label: 'Relatar mudanças do ADN ao projeto' },
			note: 'Quando o ADN mudar (leiaute, campos, rotas), envia ao projeto só o tipo da mudança e as versões, para abrir uma issue no GitHub. Nunca envia CNPJ, XML, valores ou nomes.',
		},
		schema: { default_value: false, is_nullable: false },
	},
	{ field: 'url_rele', type: 'string', meta: { note: 'Deixe em branco para usar o relé oficial do projeto.' } },
	{ field: 'instalacao', type: 'string', meta: somenteLeitura({ note: 'Identificador aleatório desta instalação (usado só para limitar envios no relé).' }) },
];

const camposDivergencias = [
	id,
	{ field: 'assinatura', type: 'string', meta: somenteLeitura({ width: 'half' }), schema: { max_length: 32, is_unique: true, is_nullable: false } },
	{ field: 'tipo', type: 'string', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'detalhe', type: 'string', meta: somenteLeitura() },
	{ field: 'ocorrencias', type: 'integer', meta: somenteLeitura({ width: 'half' }), schema: { default_value: 1 } },
	{ field: 'ultima_ocorrencia', type: 'timestamp', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'issue_numero', type: 'integer', meta: somenteLeitura({ width: 'half' }) },
	{ field: 'issue_estado', type: 'string', meta: somenteLeitura({ width: 'half', note: 'aberta ou fechada.' }) },
	{ field: 'issue_url', type: 'string', meta: somenteLeitura({ display: 'formatted-value', display_options: { format: false } }) },
	{ field: 'corrigida_na_versao', type: 'string', meta: somenteLeitura({ width: 'half', note: 'Atualize a extensão para esta versão.' }) },
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
				note: 'NFS-e recebidas do ADN (os eventos ficam em nfse_eventos)',
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
					fields: ['emissao', 'numero', 'emitente_nome', 'valor_servico', 'estado', 'papel', 'empresa'],
					sort: ['-emissao'],
				},
			},
		});

		ctx.logger.info(`[nfse-nacional] coleção ${DOCUMENTOS} criada`);
	}

	if (!schema.collections[CONFIGURACOES]) {
		await colecoes.createOne({
			collection: CONFIGURACOES,
			meta: { icon: 'tune', singleton: true, note: 'Configurações da NFS-e Nacional' },
			schema: {},
			fields: camposConfiguracoes,
		});

		const itens = new ctx.services.ItemsService(CONFIGURACOES, { schema: await ctx.getSchema(), accountability: null });
		await itens.upsertSingleton({ relatar_divergencias: false, instalacao: randomUUID() });
		ctx.logger.info(`[nfse-nacional] coleção ${CONFIGURACOES} criada`);
	}

	if (!schema.collections[DIVERGENCIAS]) {
		await colecoes.createOne({
			collection: DIVERGENCIAS,
			meta: { icon: 'change_circle', note: 'Mudanças do ADN detectadas nesta instalação', display_template: '{{tipo}} · {{detalhe}}' },
			schema: {},
			fields: camposDivergencias,
		});

		ctx.logger.info(`[nfse-nacional] coleção ${DIVERGENCIAS} criada`);
	}

	await garantirEventos(ctx);
}

/**
 * 0.4.0: eventos em coleção própria, filha das notas. Em instalações antigas cria só o que falta
 * (o campo estado e a lista de eventos nas notas, a coleção e as relações).
 */
async function garantirEventos(ctx: Contexto): Promise<void> {
	const { CollectionsService, FieldsService, RelationsService } = ctx.services;
	const schema = await ctx.getSchema();

	if (!schema.collections[DOCUMENTOS].fields.estado) {
		await new FieldsService({ schema, accountability: null }).createField(DOCUMENTOS, CAMPO_ESTADO);
		ctx.logger.info(`[nfse-nacional] campo ${DOCUMENTOS}.estado criado`);
	}

	if (schema.collections[EVENTOS]) return;

	await new CollectionsService({ schema: await ctx.getSchema(), accountability: null }).createOne({
		collection: EVENTOS,
		meta: { icon: 'event_note', note: 'Eventos das NFS-e (cancelamento, substituição, manifestação...)', display_template: '{{descricao}} · {{data_evento}}' },
		schema: {},
		fields: camposEventos,
	});

	await new FieldsService({ schema: await ctx.getSchema(), accountability: null }).createField(DOCUMENTOS, CAMPO_EVENTOS);
	const relacoes = new RelationsService({ schema: await ctx.getSchema(), accountability: null });
	await relacoes.createOne({ collection: EVENTOS, field: 'empresa', related_collection: EMPRESAS, schema: { on_delete: 'CASCADE' } });

	await relacoes.createOne({
		collection: EVENTOS,
		field: 'nota',
		related_collection: DOCUMENTOS,
		meta: { one_field: 'eventos' },
		schema: { on_delete: 'SET NULL' },
	});

	await new ctx.services.PresetsService({ schema: await ctx.getSchema(), accountability: null }).createOne({
		collection: EVENTOS,
		layout: 'tabular',
		layout_query: { tabular: { fields: ['data_evento', 'descricao', 'nota', 'motivo', 'empresa'], sort: ['-data_evento'] } },
	});

	ctx.logger.info(`[nfse-nacional] coleção ${EVENTOS} criada`);
}
