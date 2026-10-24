/** Fixtures dos testes: dados fictícios. */

export const CHAVE = '43149022201234567000189000000000001226090000000001';

/** Evento fictício com a estrutura do leiaute nacional (Anexo II), dados inventados. */
export function xmlEvento(codigo = '101101', extra = ''): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infEvento Id="EVT${CHAVE}${codigo}001">
    <verAplic>ADN_1.0</verAplic>
    <ambGer>2</ambGer>
    <nSeqEvento>1</nSeqEvento>
    <dhProc>2026-09-23T09:00:05-03:00</dhProc>
    <nDFe>77</nDFe>
    <pedRegEvento versao="1.00">
      <infPedReg Id="PRE${CHAVE}${codigo}">
        <tpAmb>1</tpAmb>
        <verAplic>EMISSOR_1.0</verAplic>
        <dhEvento>2026-09-23T09:00:00-03:00</dhEvento>
        <CNPJAutor>01234567000189</CNPJAutor>
        <chNFSe>${CHAVE}</chNFSe>
        <nPedRegEvento>1</nPedRegEvento>
        <e${codigo}>
          <xDesc>Cancelamento de NFS-e</xDesc>
          <cMotivo>1</cMotivo>
          <xMotivo>Erro na emissão</xMotivo>${extra}
        </e${codigo}>
      </infPedReg>
    </pedRegEvento>
  </infEvento>
</evento>`;
}
