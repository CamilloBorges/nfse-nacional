import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { descompactarXml, lerNfse, papelNaNota } from '../src/xml.js';

/** NFS-e fictícia no leiaute nacional (dados inventados). */
export const XML_NFSE = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infNFSe Id="NFS43149022201234567000189000000000001226090000000001">
    <xLocEmi>Porto Alegre</xLocEmi>
    <xLocPrestacao>Porto Alegre</xLocPrestacao>
    <nNFSe>12</nNFSe>
    <cStat>100</cStat>
    <emit>
      <CNPJ>01234567000189</CNPJ>
      <xNome>ASSISTENCIA TECNICA FICTICIA</xNome>
    </emit>
    <valores>
      <vISSQN>9.50</vISSQN>
      <vLiq>450.00</vLiq>
    </valores>
    <DPS versao="1.00">
      <infDPS Id="DPS431490220123456700018900001000000000000012">
        <dhEmi>2026-09-21T10:15:00-03:00</dhEmi>
        <dCompet>2026-09-21</dCompet>
        <prest><CNPJ>01234567000189</CNPJ></prest>
        <toma>
          <CNPJ>12345678000195</CNPJ>
          <xNome>EMPRESA TESTE LTDA</xNome>
        </toma>
        <serv>
          <locPrest><cLocPrestacao>4314902</cLocPrestacao></locPrest>
          <cServ>
            <cTribNac>140101</cTribNac>
            <xDescServ>Manutenção de computador</xDescServ>
          </cServ>
        </serv>
        <valores><vServPrest><vServ>450.00</vServ></vServPrest></valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

describe('xml', () => {
	it('descompacta o ArquivoXml (gzip + base64)', () => {
		const arquivo = gzipSync(Buffer.from(XML_NFSE)).toString('base64');
		expect(descompactarXml(arquivo)).toBe(XML_NFSE);
	});

	it('lê os campos principais mantendo zeros à esquerda', () => {
		const nota = lerNfse(XML_NFSE);
		expect(nota).toMatchObject({
			chaveAcesso: '43149022201234567000189000000000001226090000000001',
			numero: '12',
			situacao: '100',
			emissao: '2026-09-21T10:15:00-03:00',
			competencia: '2026-09-21',
			valorServico: 450,
			valorLiquido: 450,
			valorIss: 9.5,
			emitente: { documento: '01234567000189', nome: 'ASSISTENCIA TECNICA FICTICIA' },
			tomador: { documento: '12345678000195', nome: 'EMPRESA TESTE LTDA' },
			intermediario: { documento: null, nome: null },
			municipioPrestacao: 'Porto Alegre',
			codigoServico: '140101',
			descricaoServico: 'Manutenção de computador',
			versao: '1.00',
		});
	});

	it('identifica o papel do CNPJ (inclusive filial com a mesma raiz)', () => {
		const nota = lerNfse(XML_NFSE);
		expect(papelNaNota(nota, '12345678000276')).toBe('tomador');
		expect(papelNaNota(nota, '01234567000189')).toBe('emitente');
		expect(papelNaNota(nota, '55555555000155')).toBe('outro');
	});

	it('recusa XML que não é NFS-e nacional', () => {
		expect(() => lerNfse('<outro/>')).toThrow(/NFSe\/infNFSe/);
	});
});
