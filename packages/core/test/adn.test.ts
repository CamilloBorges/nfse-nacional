import type { Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { createServer } from 'node:https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClienteAdn, ErroAdn } from '../src/adn.js';
import { abrirCertificado } from '../src/certificado.js';
import { criarAc, criarCertificadoServidor, criarPfxEcnpj, pem } from './certificados-de-teste.js';

/** Simula o ADN: HTTPS que exige certificado de cliente emitido pela AC de teste. */
const ac = criarAc();
const servidorCert = criarCertificadoServidor(ac);
const certificado = abrirCertificado(criarPfxEcnpj({ ac, senha: 'x' }), 'x');

let servidor: Server;
let urlBase: string;
const pedidos: Array<{ url: string; cnCliente: string | undefined }> = [];

beforeAll(async () => {
	servidor = createServer(
		{ key: servidorCert.chavePem, cert: servidorCert.certPem, ca: pem(ac), requestCert: true, rejectUnauthorized: true },
		(req, res) => {
			const cn = (req.socket as TLSSocket).getPeerCertificate().subject?.CN;
			pedidos.push({ url: req.url ?? '', cnCliente: Array.isArray(cn) ? cn[0] : cn });
			const url = new URL(req.url ?? '/', 'https://localhost');
			res.setHeader('Content-Type', 'application/json');

			switch (url.pathname) {
				case '/contribuintes/DFe/0': {
					res.end(JSON.stringify({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{ NSU: 1, ChaveAcesso: 'c1', TipoDocumento: 'NFSE', ArquivoXml: 'eA==' }] }));

					break;
				}
				case '/contribuintes/DFe/1': {
					res.statusCode = 404;
					res.end();

					break;
				}
				case '/contribuintes/DFe/2': {
					res.statusCode = 429;
					res.setHeader('Retry-After', '7');
					res.end();

					break;
				}
				case '/contribuintes/DFe/3': {
					res.statusCode = 400;
					res.end(JSON.stringify({ Erros: [{ Codigo: 'E999', Descricao: 'CNPJ não autorizado' }] }));

					break;
				}
				default: {
					res.statusCode = 200;
					res.end(JSON.stringify({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [] }));
				}
			}
		},
	);

	await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
	urlBase = `https://localhost:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

const cliente = () => new ClienteAdn({ certificado, urlBase, ca: pem(ac) });

describe('ClienteAdn (mTLS)', () => {
	it('apresenta o certificado do cliente e lê o lote', async () => {
		const c = cliente();
		const r = await c.consultarDfe(0, '12345678000276');
		c.fechar();
		expect(r.LoteDFe).toHaveLength(1);

		expect(pedidos.at(-1)).toEqual({
			url: '/contribuintes/DFe/0?lote=true&cnpjConsulta=12345678000276',
			cnCliente: 'EMPRESA TESTE LTDA:12345678000195',
		});
	});

	it('trata 404 sem corpo como "nenhum documento"', async () => {
		const c = cliente();
		const r = await c.consultarDfe(1);
		c.fechar();
		expect(r).toEqual({ StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] });
	});

	it('expõe o Retry-After no 429', async () => {
		const c = cliente();
		const erro = await c.consultarDfe(2).catch((erro_) => erro_);
		c.fechar();
		expect(erro).toBeInstanceOf(ErroAdn);
		expect(erro).toMatchObject({ status: 429, esperarSegundos: 7 });
	});

	it('inclui os erros do ADN na mensagem', async () => {
		const c = cliente();
		const erro = await c.consultarDfe(3).catch((erro_) => erro_);
		c.fechar();
		expect(erro.message).toBe('ADN respondeu HTTP 400: E999 CNPJ não autorizado');
	});

	it('monta a rota de eventos', async () => {
		const c = cliente();
		await c.consultarEventos('431490');
		c.fechar();
		expect(pedidos.at(-1)?.url).toBe('/contribuintes/NFSe/431490/Eventos');
	});

	it('falha sem certificado de cliente válido', async () => {
		const outraAc = criarAc();
		const intruso = abrirCertificado(criarPfxEcnpj({ ac: outraAc, senha: 'x' }), 'x');
		const c = new ClienteAdn({ certificado: intruso, urlBase, ca: pem(ac) });
		await expect(c.consultarDfe(0)).rejects.toThrow();
		c.fechar();
	});
});
