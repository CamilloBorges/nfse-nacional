import type { ItemDfe } from '../src/adn.js';
import type { DocumentoRecebido, EmpresaNfse, EstadoEmpresa, RepositorioNfse } from '../src/contratos.js';
import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { ErroAdn } from '../src/adn.js';
import { criarRegistros } from '../src/registros.js';
import { sincronizarEmpresa, situacaoDoCertificado } from '../src/servico.js';
import { criarAc, criarPfxEcnpj } from './certificados-de-teste.js';
import { CONTEXTO_RELATO, DivergenciasEmMemoria, RelatorFalso } from './dubles.js';
import { XML_NFSE } from './xml.test.js';

/** Dublês (Service Stub): repositório em memória, fonte fixa e ADN falso. */
const ac = criarAc();
const pfxValido = criarPfxEcnpj({ ac, senha: 's' });

class RepositorioEmMemoria implements RepositorioNfse {
	documentos: DocumentoRecebido[] = [];
	cursores: number[] = [];
	estados: EstadoEmpresa[] = [];
	async gravarLote(_e: EmpresaNfse, docs: DocumentoRecebido[], ultimoNsu: number) {
		this.documentos.push(...docs);
		this.cursores.push(ultimoNsu);
	}

	async registrarEstado(_e: EmpresaNfse, estado: EstadoEmpresa) {
		this.estados.push(estado);
	}
}

function montar(opcoes: { pfx?: Buffer; itens?: ItemDfe[]; falhaAdn?: Error } = {}) {
	const repositorio = new RepositorioEmMemoria();
	const registros = criarRegistros();
	registros.fontesDeCertificado.registrar('fixa', () => ({ obter: async () => ({ pfx: opcoes.pfx ?? pfxValido, senha: 's' }) }));
	const cliente = {
		consultarDfe: vi.fn(async (nsu: number) => {
			if (opcoes.falhaAdn) throw opcoes.falhaAdn;
			return { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: (opcoes.itens ?? []).filter((i) => i.NSU > nsu) };
		}),
		fechar: vi.fn(),
	};
	const deps = {
		repositorio,
		fontesDeCertificado: registros.fontesDeCertificado,
		config: { NFSE_PAUSA_MS: 0 },
		criarCliente: () => cliente,
		dormir: async () => {},
		agora: () => new Date(),
	};
	return { repositorio, cliente, deps };
}

const empresa: EmpresaNfse = { id: 7, cnpj: '12345678000195', ambiente: 'producao_restrita', origemCertificado: 'fixa', ultimoNsu: 0 };
const gz = (xml: string) => gzipSync(Buffer.from(xml)).toString('base64');

describe('sincronizarEmpresa', () => {
	it('lê as notas, entrega ao repositório e registra "ok"', async () => {
		const itens: ItemDfe[] = [
			{ NSU: 1, ChaveAcesso: 'c1', TipoDocumento: 'NFSE', ArquivoXml: gz(XML_NFSE) },
			{ NSU: 2, ChaveAcesso: 'c1', TipoDocumento: 'EVENTO', ArquivoXml: gz('<evento/>') },
		];
		const { repositorio, cliente, deps } = montar({ itens });
		const r = await sincronizarEmpresa(empresa, deps);

		expect(r).toEqual({ ultimoNsu: 2, documentos: 2, lotes: 1, concluido: true });
		expect(repositorio.cursores).toEqual([2]);
		expect(repositorio.documentos[0]).toMatchObject({ papel: 'tomador', nota: { numero: '12', valorServico: 450 } });
		expect(repositorio.documentos[1]).toMatchObject({ nota: null, papel: null, xml: '<evento/>' });
		expect(repositorio.estados.at(-1)).toMatchObject({ situacao: 'ok', erro: null });
		expect(cliente.consultarDfe).toHaveBeenCalledWith(0, undefined);
		expect(cliente.fechar).toHaveBeenCalled();
	});

	it('consulta outro CNPJ da mesma raiz com cnpjConsulta', async () => {
		const { cliente, deps } = montar();
		await sincronizarEmpresa({ ...empresa, cnpj: '12345678000276' }, deps);
		expect(cliente.consultarDfe).toHaveBeenCalledWith(0, '12345678000276');
	});

	it('marca "sem_certificado" quando a fonte falha ou não está registrada', async () => {
		const { repositorio, deps } = montar();
		await expect(sincronizarEmpresa({ ...empresa, origemCertificado: 'inexistente' }, deps)).rejects.toThrow(/não registrad/);
		expect(repositorio.estados).toHaveLength(1);
		expect(repositorio.estados[0].situacao).toBe('sem_certificado');
	});

	it('suspende com certificado vencido, sem consultar o ADN', async () => {
		const vencido = criarPfxEcnpj({ ac, senha: 's', validoAte: new Date(Date.now() - 86_400_000) });
		const { repositorio, cliente, deps } = montar({ pfx: vencido });
		expect(await sincronizarEmpresa(empresa, deps)).toBeNull();
		expect(repositorio.estados.at(-1)?.situacao).toBe('certificado_vencido');
		expect(cliente.consultarDfe).not.toHaveBeenCalled();
	});

	it('registra "erro" quando o ADN falha', async () => {
		const { repositorio, deps } = montar({ falhaAdn: new Error('fora do ar') });
		await expect(sincronizarEmpresa(empresa, deps)).rejects.toThrow('fora do ar');
		expect(repositorio.estados.at(-1)).toEqual({ situacao: 'erro', erro: 'fora do ar' });
	});

	it('situação pelos dias para vencer', () => {
		expect(situacaoDoCertificado(31)).toBe('ok');
		expect(situacaoDoCertificado(30)).toBe('certificado_vencendo');
		expect(situacaoDoCertificado(-1)).toBe('certificado_vencido');
	});

	it('com o ADN alterado, grava as notas, marca "adn_alterado" e relata uma vez', async () => {
		const xmlNovo = XML_NFSE.replace('versao="1.00">', 'versao="1.02">');
		const itens: ItemDfe[] = [
			{ NSU: 1, ChaveAcesso: 'c1', TipoDocumento: 'NFSE', ArquivoXml: gz(xmlNovo) },
			{ NSU: 2, ChaveAcesso: 'c2', TipoDocumento: 'NFSE', ArquivoXml: gz(xmlNovo) },
		];
		const { repositorio, deps } = montar({ itens });
		const divergencias = new DivergenciasEmMemoria();
		const relator = new RelatorFalso();

		const r = await sincronizarEmpresa(empresa, { ...deps, divergencias: { repositorio: divergencias, relator, contexto: CONTEXTO_RELATO } });
		expect(r?.documentos).toBe(2);
		expect(repositorio.documentos[0].nota?.numero).toBe('12');
		expect(repositorio.estados.at(-1)?.situacao).toBe('adn_alterado');
		expect(repositorio.estados.at(-1)?.erro).toContain('leiaute_desconhecido NFSe@versao=1.02');
		expect(relator.relatos.map((x) => x.tipo)).toEqual(['leiaute_desconhecido']);
		expect(JSON.stringify(relator.relatos)).not.toMatch(/12345678000195|01234567000189|450/);
	});

	it('rota que sumiu (404 com outro corpo) vira "adn_alterado" e relato', async () => {
		const { repositorio, deps } = montar({ falhaAdn: new ErroAdn('rota', 404, { Erros: [] }) });
		const relator = new RelatorFalso();

		await expect(
			sincronizarEmpresa(empresa, { ...deps, divergencias: { repositorio: new DivergenciasEmMemoria(), relator, contexto: CONTEXTO_RELATO } }),
		).rejects.toThrow('rota');

		expect(repositorio.estados.at(-1)?.situacao).toBe('adn_alterado');
		expect(relator.relatos[0]).toMatchObject({ tipo: 'rota_alterada', detalhe: '/contribuintes/DFe:HTTP_404' });
	});
});
