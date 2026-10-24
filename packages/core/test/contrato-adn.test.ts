import { describe, expect, it } from 'vitest';
import { detalheSeguro, divergencia, semRepeticao, verificarItem, verificarNota, verificarResposta } from '../src/contrato-adn.js';
import { lerNfse } from '../src/xml.js';
import { XML_NFSE } from './xml.test.js';

describe('contrato do ADN', () => {
	it('aceita uma resposta e uma nota dentro do contrato', () => {
		expect(verificarResposta({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [] })).toEqual([]);
		expect(verificarItem({ NSU: 1, ChaveAcesso: 'c', TipoDocumento: 'NFSE', ArquivoXml: 'x' })).toEqual([]);
		expect(verificarNota(lerNfse(XML_NFSE))).toEqual([]);
	});

	it('acusa status novo e alertas (só os códigos)', () => {
		const achadas = verificarResposta({
			StatusProcessamento: 'LOTE_PARCIAL',
			LoteDFe: [],
			Alertas: [{ Codigo: 'A123', Descricao: 'Contribuinte 12345678000195 com pendência' }],
		});

		expect(achadas.map((d) => [d.tipo, d.detalhe])).toEqual([
			['status_desconhecido', 'LOTE_PARCIAL'],
			['alerta_adn', 'A123'],
		]);

		expect(JSON.stringify(achadas)).not.toContain('12345678000195');
	});

	it('acusa campo ausente e tipo de documento novo no item', () => {
		const achadas = verificarItem({ NSU: 1, ChaveAcesso: 'c', TipoDocumento: 'DPS', ArquivoXml: '' });
		expect(achadas.map((d) => `${d.tipo} ${d.detalhe}`)).toEqual(['campo_ausente LoteDFe.ArquivoXml', 'tipo_documento_desconhecido DPS']);
	});

	it('acusa leiaute novo e campo essencial que sumiu (ex.: reposicionado)', () => {
		const xml = XML_NFSE.replace('versao="1.00">\n  <infNFSe', 'versao="1.02">\n  <infNFSe').replace(/<vServ>[^<]+<\/vServ>/, '');
		const tipos = verificarNota(lerNfse(xml)).map((d) => `${d.tipo} ${d.detalhe}`);
		expect(tipos).toEqual(['leiaute_desconhecido NFSe@versao=1.02', 'campo_essencial_vazio NFSe.valorServico']);
	});

	it('assinatura estável e detalhe sem dados sensíveis', () => {
		expect(divergencia('alerta_adn', 'A1').assinatura).toBe(divergencia('alerta_adn', 'A1').assinatura);
		expect(divergencia('alerta_adn', 'A1').assinatura).not.toBe(divergencia('alerta_adn', 'A2').assinatura);
		expect(detalheSeguro('chave 43149022201234567000189 <x>')).toBe('chave_#__x_');
		expect(semRepeticao([divergencia('alerta_adn', 'A'), divergencia('alerta_adn', 'A')])).toHaveLength(1);
	});
});
