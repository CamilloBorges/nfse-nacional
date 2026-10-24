import { describe, expect, it } from 'vitest';
import { verificarEvento } from '../src/contrato-adn.js';
import { estadoDaNota, lerEvento } from '../src/eventos.js';
import { CHAVE, xmlEvento } from './fixtures.js';

describe('eventos', () => {
	it('lê o evento: chave da nota, código pelo nome do grupo, motivo e datas', () => {
		expect(lerEvento(xmlEvento())).toEqual({
			chaveNfse: CHAVE,
			codigo: '101101',
			descricao: 'Cancelamento de NFS-e',
			codigoMotivo: '1',
			motivo: 'Erro na emissão',
			chaveSubstituta: null,
			dataEvento: '2026-09-23T09:00:00-03:00',
			processadoEm: '2026-09-23T09:00:05-03:00',
			sequencia: 1,
			autorDocumento: '01234567000189',
		});
	});

	it('lê a chave da nota substituta', () => {
		expect(lerEvento(xmlEvento('105102', `<chSubstituta>${CHAVE.replace(/1$/, '2')}</chSubstituta>`)).chaveSubstituta).toBe(CHAVE.replace(/1$/, '2'));
	});

	it('recusa XML que não é evento', () => {
		expect(() => lerEvento('<evento/>')).toThrow(/infPedReg/);
	});

	it('estado da nota pelos eventos', () => {
		const e = (codigo: string, dataEvento = '2026-01-01') => ({ codigo, dataEvento });
		expect(estadoDaNota([])).toBe('ativa');
		expect(estadoDaNota([e('203202')])).toBe('ativa');
		expect(estadoDaNota([e('101101')])).toBe('cancelada');
		expect(estadoDaNota([e('305101')])).toBe('cancelada');
		expect(estadoDaNota([e('105102'), e('101101')])).toBe('substituida');
		expect(estadoDaNota([e('101103'), e('105105')])).toBe('ativa');
		expect(estadoDaNota([e('305102', '2026-01-01'), e('305103', '2026-02-01')])).toBe('ativa');
		expect(estadoDaNota([e('305103', '2026-01-01'), e('305102', '2026-02-01')])).toBe('bloqueada');
	});

	it('contrato: tipo de evento desconhecido e campos essenciais', () => {
		expect(verificarEvento(lerEvento(xmlEvento()))).toEqual([]);
		const novo = verificarEvento(lerEvento(xmlEvento('999999')));
		expect(novo.map((d) => `${d.tipo} ${d.detalhe}`)).toEqual(['tipo_evento_desconhecido e999999']);
		const semChave = verificarEvento({ ...lerEvento(xmlEvento()), chaveNfse: null });
		expect(semChave.map((d) => `${d.tipo} ${d.detalhe}`)).toEqual(['campo_essencial_vazio evento.chaveNfse']);
	});
});
