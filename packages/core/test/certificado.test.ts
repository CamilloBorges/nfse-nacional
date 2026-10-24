import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { abrirCertificado, diasParaVencer, ErroCertificado, mesmaRaizCnpj } from '../src/certificado.js';
import { criarAc, criarPfxEcnpj } from './certificados-de-teste.js';

const ac = criarAc();

describe('abrirCertificado', () => {
	it.each(['3des', 'aes256'] as const)('abre um e-CNPJ cifrado com %s e lê titular e CNPJ do CN', (algoritmo) => {
		const pfx = criarPfxEcnpj({ ac, senha: 's3nh@', algoritmo });
		const cert = abrirCertificado(pfx, 's3nh@');
		expect(cert.titular).toBe('EMPRESA TESTE LTDA');
		expect(cert.cnpj).toBe('12345678000195');
		expect(cert.chavePem).toContain('PRIVATE KEY');
		expect(cert.cadeiaPem).toHaveLength(1);
		expect(cert.impressaoDigital).toMatch(/^[0-9a-f]{64}$/);
	});

	it('lê o CNPJ do subjectAltName quando não está no CN', () => {
		const pfx = criarPfxEcnpj({ ac, senha: 'x', cnpj: '98765432000110', cnpjSoNoSan: true });
		const cert = abrirCertificado(pfx, 'x');
		expect(cert.titular).toBe('EMPRESA TESTE LTDA');
		expect(cert.cnpj).toBe('98765432000110');
	});

	it('avisa quando a senha está errada', () => {
		const pfx = criarPfxEcnpj({ ac, senha: 'certa' });
		expect(() => abrirCertificado(pfx, 'errada')).toThrow(new ErroCertificado('Senha do certificado incorreta.'));
	});

	it('recusa arquivo que não é PKCS#12', () => {
		expect(() => abrirCertificado(Buffer.from('não é um pfx'), 'x')).toThrow(ErroCertificado);
	});
});

describe('utilitários', () => {
	it('compara a raiz do CNPJ', () => {
		expect(mesmaRaizCnpj('12.345.678/0001-95', '12345678000276')).toBe(true);
		expect(mesmaRaizCnpj('12345678000195', '87654321000195')).toBe(false);
		expect(mesmaRaizCnpj('123', '123')).toBe(false);
	});

	it('conta os dias para vencer', () => {
		const agora = new Date('2026-10-24T12:00:00Z');
		expect(diasParaVencer({ validoAte: new Date('2026-11-23T12:00:00Z') }, agora)).toBe(30);
		expect(diasParaVencer({ validoAte: new Date('2026-10-23T12:00:00Z') }, agora)).toBe(-1);
	});
});
