import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createServer as criarHttp } from 'node:http';
import { createServer } from 'node:https';
// ADN simulado para o teste de ponta a ponta: HTTPS que exige certificado de cliente da AC de teste
// e serve uma fila fixa de 3 documentos fictícios (2 NFS-e e 1 evento). Só usa módulos do Node.
import process from 'node:process';
import { gzipSync } from 'node:zlib';

const pasta = process.env.CERTS ?? '/certs';
const porta = Number(process.env.PORTA ?? 8443);

function nota(numero, valor, cnpjTomador, versao = '1.00') {
	return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${versao}">
  <infNFSe Id="NFS4314902220123456700018900000000000${String(numero).padStart(4, '0')}26090000000001">
    <xLocPrestacao>Porto Alegre</xLocPrestacao>
    <nNFSe>${numero}</nNFSe>
    <cStat>100</cStat>
    <emit><CNPJ>01234567000189</CNPJ><xNome>PRESTADOR FICTICIO</xNome></emit>
    <valores><vISSQN>5.00</vISSQN><vLiq>${valor}</vLiq></valores>
    <DPS versao="1.00"><infDPS>
      <dhEmi>2026-09-21T10:15:00-03:00</dhEmi>
      <dCompet>2026-09-21</dCompet>
      <toma><CNPJ>${cnpjTomador}</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></toma>
      <serv><cServ><cTribNac>140101</cTribNac><xDescServ>Manutenção de computador</xDescServ></cServ></serv>
      <valores><vServPrest><vServ>${valor}</vServ></vServPrest></valores>
    </infDPS></DPS>
  </infNFSe>
</NFSe>`;
}

const gz = (xml) => gzipSync(Buffer.from(xml)).toString('base64');
const fila = [
	{ NSU: 1, ChaveAcesso: 'chave-1', TipoDocumento: 'NFSE', ArquivoXml: gz(nota(1, '450.00', '12345678000195')), DataHoraGeracao: '2026-09-21T10:16:00-03:00' },
	{ NSU: 2, ChaveAcesso: 'chave-2', TipoDocumento: 'NFSE', ArquivoXml: gz(nota(2, '1137.79', '12345678000195')), DataHoraGeracao: '2026-09-22T09:00:00-03:00' },
	{ NSU: 3, ChaveAcesso: 'chave-1', TipoDocumento: 'EVENTO', TipoEvento: 'CANCELAMENTO', ArquivoXml: gz('<evento>fictício</evento>'), DataHoraGeracao: '2026-09-23T09:00:00-03:00' },
	// Leiaute que esta versão do pacote ainda não conhece: deve virar divergência (e relato, com consentimento).
	{ NSU: 4, ChaveAcesso: 'chave-4', TipoDocumento: 'NFSE', ArquivoXml: gz(nota(4, '99.90', '12345678000195', '1.02')), DataHoraGeracao: '2026-09-24T09:00:00-03:00' },
];

const servidor = createServer(
	{
		key: readFileSync(`${pasta}/servidor.key`),
		cert: readFileSync(`${pasta}/servidor.crt`),
		ca: readFileSync(`${pasta}/ac.crt`),
		requestCert: true,
		rejectUnauthorized: true,
	},
	(req, res) => {
		const url = new URL(req.url ?? '/', 'https://adn-simulado');
		const cliente = req.socket.getPeerCertificate().subject?.CN;
		console.log(`${req.method} ${url.pathname}${url.search} cliente=${cliente}`);
		res.setHeader('Content-Type', 'application/json');

		const nsu = url.pathname.match(/^\/contribuintes\/DFe\/(\d+)$/)?.[1];

		if (nsu === undefined) {
			res.statusCode = 404;
			return res.end(JSON.stringify({ Erros: [{ Codigo: 'E404', Descricao: 'rota desconhecida' }] }));
		}

		const lote = fila.filter((i) => i.NSU > Number(nsu));

		if (lote.length === 0) {
			res.statusCode = 404;
			return res.end(JSON.stringify({ StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] }));
		}

		res.end(JSON.stringify({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', TipoAmbiente: 'PRODUCAORESTRITA', LoteDFe: lote }));
	},
);

servidor.listen(porta, () => console.log(`ADN simulado em https://0.0.0.0:${porta}`));

// Relé simulado (HTTP, porta 8080): guarda os relatos e devolve uma issue por assinatura.
const relatos = [];
const issues = new Map();

criarHttp((req, res) => {
	res.setHeader('Content-Type', 'application/json');
	if (req.method === 'GET' && req.url === '/relatos') return res.end(JSON.stringify(relatos));

	let corpo = '';
	req.on('data', (p) => (corpo += p));

	req.on('end', () => {
		const relato = JSON.parse(corpo);
		relatos.push(relato);
		if (!issues.has(relato.assinatura)) issues.set(relato.assinatura, issues.size + 1);
		const numero = issues.get(relato.assinatura);
		res.end(JSON.stringify({ numero, url: `https://github.com/exemplo/issues/${numero}`, estado: 'aberta', corrigidaNaVersao: null }));
	});
}).listen(8080, () => console.log('Relé simulado em http://0.0.0.0:8080'));
