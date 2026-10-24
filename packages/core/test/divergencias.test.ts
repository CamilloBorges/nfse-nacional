import { describe, expect, it, vi } from 'vitest';
import { divergencia } from '../src/contrato-adn.js';
import { acompanharIssues, consultarIssuePublica, relatorRele, tratarDivergencias } from '../src/divergencias.js';
import { criarRegistros } from '../src/registros.js';
import { CONTEXTO_RELATO, DivergenciasEmMemoria, RelatorFalso } from './dubles.js';

const leiaute = divergencia('leiaute_desconhecido', 'NFSe@versao=1.02');

describe('tratarDivergencias', () => {
	it('sem consentimento (sem relator) só registra', async () => {
		const repositorio = new DivergenciasEmMemoria();
		const r = await tratarDivergencias([leiaute], { repositorio, relator: null, contexto: CONTEXTO_RELATO });
		expect(r[0]).toMatchObject({ ocorrencias: 1, issue: null });
	});

	it('relata uma vez por assinatura e depois só soma ocorrências', async () => {
		const repositorio = new DivergenciasEmMemoria();
		const relator = new RelatorFalso();
		await tratarDivergencias([leiaute, leiaute], { repositorio, relator, contexto: CONTEXTO_RELATO });
		await tratarDivergencias([leiaute], { repositorio, relator, contexto: CONTEXTO_RELATO });

		expect(relator.relatos).toHaveLength(1);
		expect(relator.relatos[0]).toEqual({ ...leiaute, ...CONTEXTO_RELATO });
		expect(repositorio.porAssinatura.get(leiaute.assinatura)).toMatchObject({ ocorrencias: 2, issue: { numero: 101, estado: 'aberta' } });
	});

	it('falha do relé não interrompe (fica para a próxima)', async () => {
		const repositorio = new DivergenciasEmMemoria();
		const relator = { relatar: vi.fn(async () => {
			throw new Error('fora do ar');
		}) };
		const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		await tratarDivergencias([leiaute], { repositorio, relator, contexto: CONTEXTO_RELATO, log });
		expect(repositorio.porAssinatura.get(leiaute.assinatura)?.issue).toBeNull();
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('não consegui relatar'));
	});
});

describe('relator "rele"', () => {
	it('é escolhido por nome e envia o relato ao endereço configurado', async () => {
		const relator = criarRegistros().relatoresDeDivergencias.criar('rele', { NFSE_URL_RELE: 'https://rele.exemplo' });
		expect(relator).toBeDefined();

		const fazerFetch = vi.fn(async () => Response.json({ numero: 7, url: 'u', estado: 'aberta', corrigidaNaVersao: null }));
		const issue = await relatorRele('https://rele.exemplo/', fazerFetch as unknown as typeof fetch).relatar({ ...leiaute, ...CONTEXTO_RELATO });
		expect(issue.numero).toBe(7);
		const [url, init] = fazerFetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://rele.exemplo/relatos');
		expect(JSON.parse(String(init.body))).toEqual({ ...leiaute, ...CONTEXTO_RELATO });
	});

	it('erro HTTP do relé vira exceção', async () => {
		const fazerFetch = vi.fn(async () => new Response('limite', { status: 429 }));
		await expect(relatorRele('https://r', fazerFetch as unknown as typeof fetch).relatar({ ...leiaute, ...CONTEXTO_RELATO })).rejects.toThrow('HTTP 429');
	});
});

describe('acompanhamento das issues', () => {
	it('lê estado e versão da correção (milestone) pela API pública', async () => {
		const fazerFetch = vi.fn(async () => Response.json({ number: 9, html_url: 'h', state: 'closed', milestone: { title: 'v0.3.1' } }));
		expect(await consultarIssuePublica(9, fazerFetch as unknown as typeof fetch)).toEqual({ numero: 9, url: 'h', estado: 'fechada', corrigidaNaVersao: '0.3.1' });
	});

	it('marca como fechada quando o GitHub fecha a issue', async () => {
		const repositorio = new DivergenciasEmMemoria();
		await tratarDivergencias([leiaute], { repositorio, relator: new RelatorFalso(), contexto: CONTEXTO_RELATO });
		const consultar = vi.fn(async (numero: number) => ({ numero, url: 'u', estado: 'fechada' as const, corrigidaNaVersao: '0.3.1' }));

		const fechadas = await acompanharIssues({ repositorio, consultar });
		expect(fechadas).toHaveLength(1);
		expect(repositorio.porAssinatura.get(leiaute.assinatura)?.issue).toMatchObject({ estado: 'fechada', corrigidaNaVersao: '0.3.1' });
		expect(await repositorio.comIssueAberta()).toEqual([]);
	});
});
