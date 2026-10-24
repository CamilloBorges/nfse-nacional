import { createHash } from 'node:crypto';
import forge from 'node-forge';

/** OID do CNPJ do titular no subjectAltName dos certificados e-CNPJ da ICP-Brasil. */
const OID_CNPJ_ICP_BRASIL = '2.16.76.1.3.3';

export class ErroCertificado extends Error {
	constructor(mensagem: string) {
		super(mensagem);
		this.name = 'ErroCertificado';
	}
}

/** Dados do certificado que podem ser mostrados e guardados sem risco. */
export interface InfoCertificado {
	titular: string;
	cnpj: string | null;
	validoDe: Date;
	validoAte: Date;
	/** SHA-256 do certificado (DER), em hexadecimal. */
	impressaoDigital: string;
}

/** Certificado aberto, pronto para a conexão mTLS. Nunca persistir. */
export interface CertificadoAberto extends InfoCertificado {
	chavePem: string;
	certificadoPem: string;
	cadeiaPem: string[];
}

/**
 * Abre um .pfx/.p12 (A1). Usa o node-forge em vez do OpenSSL do Node porque muitos
 * certificados A1 ainda vêm com cifras legadas (RC2/3DES) que o OpenSSL 3 recusa.
 */
export function abrirCertificado(pfx: Buffer, senha: string): CertificadoAberto {
	let p12: forge.pkcs12.Pkcs12Pfx;
	try {
		const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
		p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
	} catch (erro) {
		const texto = erro instanceof Error ? erro.message : String(erro);
		if (/invalid password|mac could not be verified/i.test(texto)) {
			throw new ErroCertificado('Senha do certificado incorreta.');
		}
		throw new ErroCertificado(`Não foi possível ler o arquivo do certificado (${texto}).`);
	}

	const chaves = [
		...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
		...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
	];
	const chave = chaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
	if (!chave) throw new ErroCertificado('O arquivo não contém a chave privada.');

	const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
		.map((b) => b.cert)
		.filter((c): c is forge.pki.Certificate => Boolean(c));

	// O certificado do titular é o que tem a mesma chave pública da chave privada.
	const titular = certificados.find((c) => {
		const publica = c.publicKey as forge.pki.rsa.PublicKey;
		return publica.n?.equals(chave.n) && publica.e?.equals(chave.e);
	});
	if (!titular) throw new ErroCertificado('O arquivo não contém o certificado da chave privada.');

	const cadeia = certificados.filter((c) => c !== titular);
	return {
		...infoDoCertificado(titular),
		chavePem: forge.pki.privateKeyToPem(chave),
		certificadoPem: forge.pki.certificateToPem(titular),
		cadeiaPem: cadeia.map((c) => forge.pki.certificateToPem(c)),
	};
}

/** Só os metadados (sem a chave). */
export function lerInfoCertificado(pfx: Buffer, senha: string): InfoCertificado {
	const { titular, cnpj, validoDe, validoAte, impressaoDigital } = abrirCertificado(pfx, senha);
	return { titular, cnpj, validoDe, validoAte, impressaoDigital };
}

export function diasParaVencer(info: Pick<InfoCertificado, 'validoAte'>, agora = new Date()): number {
	return Math.floor((info.validoAte.getTime() - agora.getTime()) / 86_400_000);
}

export function somenteDigitos(valor: string): string {
	return valor.replace(/\D/g, '');
}

/** O ADN aceita consultar qualquer CNPJ com a mesma raiz (8 primeiros dígitos) do certificado. */
export function mesmaRaizCnpj(a: string, b: string): boolean {
	const x = somenteDigitos(a);
	const y = somenteDigitos(b);
	return x.length === 14 && y.length === 14 && x.slice(0, 8) === y.slice(0, 8);
}

function infoDoCertificado(cert: forge.pki.Certificate): InfoCertificado {
	const nomeComum = String(cert.subject.getField('CN')?.value ?? '');
	const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
	return {
		titular: nomeComum.replace(/:\d{14}$/, '').trim() || nomeComum,
		cnpj: cnpjDoNomeComum(nomeComum) ?? cnpjDoSubjectAltName(cert),
		validoDe: cert.validity.notBefore,
		validoAte: cert.validity.notAfter,
		impressaoDigital: createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex'),
	};
}

/** e-CNPJ: o CN costuma ser "RAZAO SOCIAL:12345678000199". */
function cnpjDoNomeComum(nomeComum: string): string | null {
	return nomeComum.match(/:(\d{14})$/)?.[1] ?? null;
}

function cnpjDoSubjectAltName(cert: forge.pki.Certificate): string | null {
	const extensao = cert.extensions.find((e) => e.name === 'subjectAltName') as { value?: string } | undefined;
	if (!extensao?.value) return null;
	try {
		return procurarOtherName(forge.asn1.fromDer(extensao.value), OID_CNPJ_ICP_BRASIL);
	} catch {
		return null;
	}
}

/** Percorre o ASN.1 atrás de um otherName com o OID pedido e devolve os dígitos do valor. */
function procurarOtherName(no: forge.asn1.Asn1, oid: string): string | null {
	if (!Array.isArray(no.value)) return null;
	const filhos = no.value as forge.asn1.Asn1[];
	const indiceOid = filhos.findIndex(
		(f) => f.type === forge.asn1.Type.OID && forge.asn1.derToOid(f.value as string) === oid,
	);
	if (indiceOid >= 0 && filhos[indiceOid + 1]) {
		const digitos = somenteDigitos(textoInterno(filhos[indiceOid + 1]));
		if (digitos.length >= 14) return digitos.slice(0, 14);
	}
	for (const filho of filhos) {
		const achado = procurarOtherName(filho, oid);
		if (achado) return achado;
	}
	return null;
}

function textoInterno(no: forge.asn1.Asn1): string {
	return Array.isArray(no.value) ? (no.value as forge.asn1.Asn1[]).map(textoInterno).join('') : String(no.value);
}
