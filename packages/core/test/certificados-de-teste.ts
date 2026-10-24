import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

/** Certificados gerados na hora para os testes: nenhum certificado real entra no repositório. */

interface Par {
	chave: forge.pki.rsa.PrivateKey;
	cert: forge.pki.Certificate;
}

function novaChave() {
	const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()) as forge.pki.rsa.PrivateKey;
	return { chave, publica: forge.pki.setRsaPublicKey(chave.n, chave.e) };
}

function emitir(opcoes: {
	cn: string;
	emissor?: Par;
	ca?: boolean;
	altNames?: unknown[];
	/** subjectAltName com otherName ICP-Brasil (OID 2.16.76.1.3.3), como nos e-CNPJ reais. */
	sanOtherNameCnpj?: string;
	validoAte?: Date;
}): Par {
	const { chave, publica } = novaChave();
	const cert = forge.pki.createCertificate();
	cert.publicKey = publica;
	cert.serialNumber = String(Math.floor(Math.random() * 1e9) + 1);
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = opcoes.validoAte ?? new Date(Date.now() + 365 * 86_400_000);
	const sujeito = [{ name: 'commonName', value: opcoes.cn }, { name: 'countryName', value: 'BR' }];
	cert.setSubject(sujeito);
	cert.setIssuer(opcoes.emissor ? opcoes.emissor.cert.subject.attributes : sujeito);
	const extensoes: unknown[] = [{ name: 'basicConstraints', cA: Boolean(opcoes.ca) }];
	if (opcoes.altNames) extensoes.push({ name: 'subjectAltName', altNames: opcoes.altNames });
	if (opcoes.sanOtherNameCnpj) {
		const { asn1 } = forge;
		// GeneralNames ::= SEQUENCE { otherName [0] { type-id OID, value [0] EXPLICIT OCTET STRING } }
		extensoes.push({
			id: '2.5.29.17',
			value: asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
				asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
					asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.76.1.3.3').getBytes()),
					asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
						asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, opcoes.sanOtherNameCnpj),
					]),
				]),
			]),
		});
	}
	cert.setExtensions(extensoes as forge.pki.CertificateField[]);
	cert.sign(opcoes.emissor?.chave ?? chave, forge.md.sha256.create());
	return { chave, cert };
}

export function criarAc(): Par {
	return emitir({ cn: 'AC TESTE NFSE', ca: true });
}

export function criarCertificadoServidor(ac: Par): { chavePem: string; certPem: string } {
	const par = emitir({ cn: 'localhost', emissor: ac, altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] });
	return { chavePem: forge.pki.privateKeyToPem(par.chave), certPem: forge.pki.certificateToPem(par.cert) };
}

/** e-CNPJ de teste: CNPJ no CN ("RAZAO:CNPJ") ou só no subjectAltName (OID 2.16.76.1.3.3). */
export function criarPfxEcnpj(opcoes: {
	ac: Par;
	razao?: string;
	cnpj?: string;
	cnpjSoNoSan?: boolean;
	senha: string;
	algoritmo?: '3des' | 'aes256';
	validoAte?: Date;
}): Buffer {
	const razao = opcoes.razao ?? 'EMPRESA TESTE LTDA';
	const cnpj = opcoes.cnpj ?? '12345678000195';
	const cn = opcoes.cnpjSoNoSan ? razao : `${razao}:${cnpj}`;
	const par = emitir({ cn, emissor: opcoes.ac, validoAte: opcoes.validoAte, sanOtherNameCnpj: opcoes.cnpjSoNoSan ? cnpj : undefined });
	const asn1 = forge.pkcs12.toPkcs12Asn1(par.chave, [par.cert, opcoes.ac.cert], opcoes.senha, {
		algorithm: opcoes.algoritmo ?? '3des',
	});
	return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

export function pem(par: Par): string {
	return forge.pki.certificateToPem(par.cert);
}
