import type { ItemDfe } from './adn.js';
import type { CertificadoAberto } from './certificado.js';
import type { DocumentoRecebido, EmpresaNfse, FonteDeCertificado, Registrador, RepositorioNfse, SituacaoEmpresa } from './contratos.js';
import type { RegistroDePlugins } from './plugins.js';
import type { ResultadoSincronizacao } from './sincronizar.js';
import { ClienteAdn } from './adn.js';
import { abrirCertificado, diasParaVencer, somenteDigitos } from './certificado.js';
import { sincronizar } from './sincronizar.js';
import { descompactarXml, lerNfse, papelNaNota } from './xml.js';

/** A partir de quantos dias para vencer o certificado a situação fica "certificado_vencendo". */
export const DIAS_AVISO_CERTIFICADO = 30;

type ClienteDfe = Pick<ClienteAdn, 'consultarDfe'> & { fechar?: () => void };

export interface DependenciasSincronizacao {
	repositorio: RepositorioNfse;
	fontesDeCertificado: RegistroDePlugins<FonteDeCertificado>;
	/** Variáveis de configuração (NFSE_MAX_LOTES, NFSE_PAUSA_MS e as lidas pelas fontes). */
	config: Record<string, unknown>;
	log?: Registrador;
	/** Troca o cliente HTTP (testes com dublê, ou outro transporte). */
	criarCliente?: (certificado: CertificadoAberto, empresa: EmpresaNfse) => ClienteDfe;
	dormir?: (ms: number) => Promise<void>;
	agora?: () => Date;
}

/** Empresas sendo sincronizadas agora neste processo. */
const emAndamento = new Set<string>();

/**
 * Sincroniza uma empresa: obtém o certificado pela fonte configurada, confere a validade,
 * percorre a fila do ADN e entrega cada lote ao repositório. O estado final vai para o repositório.
 * Devolve null quando não sincronizou (já em andamento ou certificado vencido).
 */
export async function sincronizarEmpresa(empresa: EmpresaNfse, deps: DependenciasSincronizacao): Promise<ResultadoSincronizacao | null> {
	const chave = String(empresa.id);

	if (emAndamento.has(chave)) {
		deps.log?.warn(`[nfse-nacional] ${empresa.cnpj}: sincronização anterior ainda em andamento.`);
		return null;
	}

	emAndamento.add(chave);
	const agora = deps.agora ?? (() => new Date());
	let cliente: ClienteDfe | undefined;
	let estadoRegistrado = false;

	try {
		let certificado: CertificadoAberto;

		try {
			const fonte = deps.fontesDeCertificado.criar(empresa.origemCertificado, deps.config);
			const { pfx, senha } = await fonte.obter(empresa);
			certificado = abrirCertificado(pfx, senha);
		}
		catch (erro) {
			await deps.repositorio.registrarEstado(empresa, { situacao: 'sem_certificado', erro: mensagem(erro) });
			estadoRegistrado = true;
			throw erro;
		}

		const dias = diasParaVencer(certificado, agora());

		if (dias < 0) {
			const erro = `Certificado vencido em ${certificado.validoAte.toISOString().slice(0, 10)}.`;
			await deps.repositorio.registrarEstado(empresa, { situacao: 'certificado_vencido', erro });
			deps.log?.error(`[nfse-nacional] ${empresa.cnpj}: ${erro} Sincronização suspensa.`);
			return null;
		}

		if (dias <= DIAS_AVISO_CERTIFICADO) deps.log?.warn(`[nfse-nacional] ${empresa.cnpj}: certificado vence em ${dias} dia(s).`);

		cliente =
			deps.criarCliente?.(certificado, empresa)
			// NFSE_ADN_URL substitui o endereço do ambiente (proxy, simulador de testes).
			?? new ClienteAdn({ certificado, ambiente: empresa.ambiente, urlBase: (deps.config.NFSE_ADN_URL as string | undefined) || undefined });

		const cnpj = somenteDigitos(empresa.cnpj);
		const resultado = await sincronizar({
			cliente,
			ultimoNsu: empresa.ultimoNsu,
			cnpjConsulta: certificado.cnpj === cnpj ? undefined : cnpj,
			maxLotes: Number(deps.config.NFSE_MAX_LOTES ?? 20),
			pausaMs: Number(deps.config.NFSE_PAUSA_MS ?? 1000),
			dormir: deps.dormir,
			aoReceberLote: (itens, ultimoNsu) =>
				deps.repositorio.gravarLote(empresa, itens.map((i) => paraDocumento(i, empresa, deps.log)), ultimoNsu),
		});

		await deps.repositorio.registrarEstado(empresa, { situacao: situacaoDoCertificado(dias), erro: null, sincronizadoEm: agora() });

		deps.log?.info(
			`[nfse-nacional] ${empresa.cnpj}: ${resultado.documentos} documento(s) em ${resultado.lotes} lote(s), NSU ${resultado.ultimoNsu}${resultado.concluido ? '' : ' (continua na próxima execução)'}.`,
		);

		return resultado;
	}
	catch (erro) {
		deps.log?.error(`[nfse-nacional] ${empresa.cnpj}: ${mensagem(erro)}`);

		if (!estadoRegistrado) {
			await deps.repositorio.registrarEstado(empresa, { situacao: 'erro', erro: mensagem(erro) }).catch(() => {});
		}

		throw erro;
	}
	finally {
		cliente?.fechar?.();
		emAndamento.delete(chave);
	}
}

export function situacaoDoCertificado(diasParaVencer: number): SituacaoEmpresa {
	if (diasParaVencer < 0) return 'certificado_vencido';
	return diasParaVencer <= DIAS_AVISO_CERTIFICADO ? 'certificado_vencendo' : 'ok';
}

function paraDocumento(item: ItemDfe, empresa: EmpresaNfse, log?: Registrador): DocumentoRecebido {
	const xml = descompactarXml(item.ArquivoXml);
	if (item.TipoDocumento !== 'NFSE') return { item, xml, nota: null, papel: null };

	try {
		const nota = lerNfse(xml);
		return { item, xml, nota, papel: papelNaNota(nota, empresa.cnpj) };
	}
	catch (erro) {
		// O XML é guardado mesmo assim; os campos podem ser preenchidos depois.
		log?.warn(`[nfse-nacional] NSU ${item.NSU}: não consegui ler o XML (${mensagem(erro)}).`);
		return { item, xml, nota: null, papel: null };
	}
}

function mensagem(erro: unknown): string {
	return erro instanceof Error ? erro.message : String(erro);
}
