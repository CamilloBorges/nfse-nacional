import type { ItemDfe, RespostaDfe } from '../src/adn.js';
import { describe, expect, it, vi } from 'vitest';
import { ErroAdn } from '../src/adn.js';
import { sincronizar } from '../src/sincronizar.js';

/** Fila fictícia do ADN com `total` documentos, devolvidos de 50 em 50. */
function filaFalsa(total: number) {
	return {
		consultarDfe: vi.fn(async (nsu: number): Promise<RespostaDfe> => {
			const lote: ItemDfe[] = [];

			for (let n = nsu + 1; n <= Math.min(nsu + 50, total); n++) {
				lote.push({ NSU: n, ChaveAcesso: `chave${n}`, TipoDocumento: 'NFSE', ArquivoXml: '' });
			}

			return { StatusProcessamento: lote.length > 0 ? 'DOCUMENTOS_LOCALIZADOS' : 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: lote };
		}),
	};
}

const semPausa = async () => {};

describe('sincronizar', () => {
	it('percorre a fila até o fim, lote a lote, avançando o cursor', async () => {
		const cliente = filaFalsa(120);
		const cursores: number[] = [];
		const r = await sincronizar({
			cliente,
			ultimoNsu: 0,
			dormir: semPausa,
			aoReceberLote: async (_itens, ultimo) => void cursores.push(ultimo),
		});
		expect(r).toEqual({ ultimoNsu: 120, documentos: 120, lotes: 3, concluido: true });
		expect(cursores).toEqual([50, 100, 120]);
		expect(cliente.consultarDfe.mock.calls.map((c) => c[0])).toEqual([0, 50, 100]);
	});

	it('continua de onde parou e para em maxLotes', async () => {
		const r = await sincronizar({ cliente: filaFalsa(500), ultimoNsu: 100, maxLotes: 2, dormir: semPausa, aoReceberLote: async () => {} });
		expect(r).toEqual({ ultimoNsu: 200, documentos: 100, lotes: 2, concluido: false });
	});

	it('termina sem lotes quando não há nada novo (fila múltipla de 50)', async () => {
		const cliente = filaFalsa(100);
		const r = await sincronizar({ cliente, ultimoNsu: 100, dormir: semPausa, aoReceberLote: async () => {} });
		expect(r).toEqual({ ultimoNsu: 100, documentos: 0, lotes: 0, concluido: true });
	});

	it('não avança o cursor se a gravação falhar', async () => {
		await expect(
			sincronizar({
				cliente: filaFalsa(10),
				ultimoNsu: 0,
				dormir: semPausa,
				aoReceberLote: async () => {
					throw new Error('banco fora');
				},
			}),
		).rejects.toThrow('banco fora');
	});

	it('espera e tenta de novo uma vez no HTTP 429', async () => {
		const cliente = filaFalsa(10);
		const original = cliente.consultarDfe.getMockImplementation()!;

		cliente.consultarDfe.mockImplementationOnce(async () => {
			throw new ErroAdn('limite', 429, null, 5);
		});

		cliente.consultarDfe.mockImplementation(original);
		const dormir = vi.fn(semPausa);
		const r = await sincronizar({ cliente, ultimoNsu: 0, dormir, aoReceberLote: async () => {} });
		expect(dormir).toHaveBeenCalledWith(5000);
		expect(r.documentos).toBe(10);
	});

	it('desiste no segundo 429 seguido', async () => {
		const cliente = { consultarDfe: vi.fn(async () => {
			throw new ErroAdn('limite', 429, null);
		}) };
		await expect(sincronizar({ cliente, ultimoNsu: 0, dormir: semPausa, aoReceberLote: async () => {} })).rejects.toThrow('limite');
		expect(cliente.consultarDfe).toHaveBeenCalledTimes(2);
	});
});
