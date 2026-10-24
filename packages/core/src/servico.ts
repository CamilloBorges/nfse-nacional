import type { ItemDfe } from './adn.js';
import type { CertificadoAberto } from './certificado.js';
import type { Divergencia } from './contrato-adn.js';
import type { DocumentoRecebido, EmpresaNfse, FonteDeCertificado, Registrador, RepositorioNfse, SituacaoEmpresa } from './contratos.js';
import type { ContextoDoRelato, RelatorDeDivergencias, RepositorioDivergencias } from './divergencias.js';
import type { RegistroDePlugins } from './plugins.js';
import type { ResultadoSincronizacao } from './sincronizar.js';
import { ClienteAdn, ErroAdn } from './adn.js';
import { abrirCertificado, diasParaVencer, somenteDigitos } from './certificado.js';
import { divergencia, semRepeticao, verificarItem, verificarNota, verificarResposta } from './contrato-adn.js';
import { tratarDivergencias } from './divergencias.js';
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
	/** Onde guardar as mudanças do ADN detectadas e, com consentimento, a quem relatá-las. */
	divergencias?: {
		repositorio: RepositorioDivergencias;
		relator?: RelatorDeDivergencias | null;
		contexto: ContextoDoRelato;
	};
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
 * percorre a fila do ADN e entrega cada lote ao repositório, conferindo cada resposta contra o
 * contrato do ADN. O estado final vai para o repositório.
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
	const achadas: Divergencia[] = [];
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
			aoReceberResposta: (resposta) => achadas.push(...verificarResposta(resposta)),
			aoReceberLote: (itens, ultimoNsu) => {
				const documentos = itens.map((i) => paraDocumento(i, empresa, deps.log));
				for (const d of documentos) achadas.push(...d.divergencias);
				return deps.repositorio.gravarLote(empresa, documentos, ultimoNsu);
			},
		});

		const divergencias = semRepeticao(achadas);

		if (divergencias.length > 0) {
			await relatar(divergencias, deps);
			await deps.repositorio.registrarEstado(empresa, { situacao: 'adn_alterado', erro: resumo(divergencias), sincronizadoEm: agora() });
		}
		else {
			await deps.repositorio.registrarEstado(empresa, { situacao: situacaoDoCertificado(dias), erro: null, sincronizadoEm: agora() });
		}

		deps.log?.info(
			`[nfse-nacional] ${empresa.cnpj}: ${resultado.documentos} documento(s) em ${resultado.lotes} lote(s), NSU ${resultado.ultimoNsu}${resultado.concluido ? '' : ' (continua na próxima execução)'}.`,
		);

		return resultado;
	}
	catch (erro) {
		deps.log?.error(`[nfse-nacional] ${empresa.cnpj}: ${mensagem(erro)}`);

		// Rota que sumiu também é mudança do ADN: registra e relata como as demais.
		if (erro instanceof ErroAdn && (erro.status === 404 || erro.status === 410)) {
			const divergencias = [divergencia('rota_alterada', `/contribuintes/DFe:HTTP_${erro.status}`)];
			await relatar(divergencias, deps).catch(() => {});
			await deps.repositorio.registrarEstado(empresa, { situacao: 'adn_alterado', erro: resumo(divergencias) }).catch(() => {});
			estadoRegistrado = true;
		}

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

async function relatar(divergencias: Divergencia[], deps: DependenciasSincronizacao): Promise<void> {
	if (!deps.divergencias) {
		deps.log?.warn(`[nfse-nacional] o ADN mudou: ${resumo(divergencias)}`);
		return;
	}

	await tratarDivergencias(divergencias, { ...deps.divergencias, log: deps.log });
}

function resumo(divergencias: Divergencia[]): string {
	const itens = divergencias.slice(0, 5).map((d) => `${d.tipo} ${d.detalhe}`);
	const resto = divergencias.length > 5 ? ` e mais ${divergencias.length - 5}` : '';
	return `O ADN mudou em relação ao que esta versão sabe ler: ${itens.join('; ')}${resto}. As notas continuam sendo gravadas; atualize o pacote quando houver correção.`;
}

function paraDocumento(item: ItemDfe, empresa: EmpresaNfse, log?: Registrador): DocumentoRecebido {
	const divergencias = verificarItem(item);
	const xml = item.ArquivoXml ? descompactarXml(item.ArquivoXml) : '';
	if (item.TipoDocumento !== 'NFSE') return { item, xml, nota: null, papel: null, divergencias };

	try {
		const nota = lerNfse(xml);
		return { item, xml, nota, papel: papelNaNota(nota, empresa.cnpj), divergencias: [...divergencias, ...verificarNota(nota)] };
	}
	catch (erro) {
		// O XML é guardado mesmo assim; os campos podem ser preenchidos depois.
		log?.warn(`[nfse-nacional] NSU ${item.NSU}: não consegui ler o XML (${mensagem(erro)}).`);
		return { item, xml, nota: null, papel: null, divergencias: [...divergencias, divergencia('xml_ilegivel', 'NFSe/infNFSe')] };
	}
}

function mensagem(erro: unknown): string {
	return erro instanceof Error ? erro.message : String(erro);
}
