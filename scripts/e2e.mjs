import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
// Teste de ponta a ponta: Directus 12 real + extensão + ADN simulado (mTLS), via docker compose.
// Uso: pnpm build && pnpm e2e [--manter]
import { execSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
const forge = createRequire(path.join(raiz, 'packages/core/package.json'))('node-forge');
const manter = process.argv.includes('--manter');
const URL_DIRECTUS = 'http://localhost:18055';
const CNPJ = '12345678000195';

// ---------- certificados de teste ----------
function par(cn, emissor, extensoes = []) {
	const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
	const cert = forge.pki.createCertificate();
	cert.publicKey = forge.pki.setRsaPublicKey(chave.n, chave.e);
	cert.serialNumber = String(Date.now());
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
	const sujeito = [{ name: 'commonName', value: cn }];
	cert.setSubject(sujeito);
	cert.setIssuer(emissor ? emissor.cert.subject.attributes : sujeito);
	cert.setExtensions([{ name: 'basicConstraints', cA: !emissor }, ...extensoes]);
	cert.sign(emissor?.chave ?? chave, forge.md.sha256.create());
	return { chave, cert };
}

const certs = path.join(raiz, '.e2e/certs');
mkdirSync(certs, { recursive: true });
const ac = par('AC TESTE E2E');
const servidor = par('adn-simulado', ac, [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'adn-simulado' }] }]);
const cliente = par(`EMPRESA TESTE LTDA:${CNPJ}`, ac);
writeFileSync(path.join(certs, 'ac.crt'), forge.pki.certificateToPem(ac.cert));
writeFileSync(path.join(certs, 'servidor.crt'), forge.pki.certificateToPem(servidor.cert));
writeFileSync(path.join(certs, 'servidor.key'), forge.pki.privateKeyToPem(servidor.chave));
const pfx = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(cliente.chave, [cliente.cert, ac.cert], 'senha-pfx', { algorithm: '3des' })).getBytes(), 'binary');
writeFileSync(path.join(certs, 'chave-parte-2'), randomBytes(32).toString('base64'));
const parte1 = randomBytes(32).toString('base64');

// ---------- ambiente ----------
const compose = (args) => execSync(`docker compose ${args}`, { cwd: raiz, stdio: 'inherit', env: { ...process.env, NFSE_CHAVE_MESTRA: parte1 } });

async function api(metodo, caminho, { token, corpo } = {}) {
	const res = await fetch(`${URL_DIRECTUS}${caminho}`, {
		method: metodo,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: corpo ? JSON.stringify(corpo) : undefined,
	});
	const texto = await res.text();
	return { status: res.status, json: texto ? JSON.parse(texto) : null };
}

async function esperar(descricao, condicao, tentativas = 60) {
	for (let i = 0; i < tentativas; i++) {
		try {
			if (await condicao()) return;
		}
		catch {}

		await new Promise((r) => setTimeout(r, 2000));
	}

	throw new Error(`Tempo esgotado esperando: ${descricao}`);
}

let falhou = false;

try {
	compose('down -v --remove-orphans');
	compose('up -d --wait');

	const login = await api('POST', '/auth/login', { corpo: { email: 'admin@exemplo.com', password: 'senha-de-teste' } });
	assert.equal(login.status, 200, 'login do admin');
	const token = login.json.data.access_token;

	console.log('• coleções criadas pela extensão');
	await esperar('coleções nfse_*', async () => (await api('GET', '/collections/nfse_documentos', { token })).status === 200);

	console.log('• cadastro da empresa');
	const empresa = await api('POST', '/items/nfse_empresas', { token, corpo: { cnpj: CNPJ, nome: 'Empresa Teste', ambiente: 'producao_restrita' } });
	assert.equal(empresa.status, 200, JSON.stringify(empresa.json));
	const id = empresa.json.data.id;
	assert.equal(empresa.json.data.origem_certificado, 'directus');

	console.log('• envio do certificado (senha errada é recusada)');
	const errada = await api('POST', `/nfse-nacional/empresas/${id}/certificado`, { token, corpo: { pfx: pfx.toString('base64'), senha: 'x' } });
	assert.equal(errada.status, 400);
	assert.equal(errada.json.erro, 'Senha do certificado incorreta.');
	const envio = await api('POST', `/nfse-nacional/empresas/${id}/certificado`, { token, corpo: { pfx: pfx.toString('base64'), senha: 'senha-pfx' } });
	assert.equal(envio.status, 200, JSON.stringify(envio.json));
	assert.equal(envio.json.cnpj, CNPJ);
	assert.equal(envio.json.titular, 'EMPRESA TESTE LTDA');
	assert.ok(!JSON.stringify(envio.json).includes('senha-pfx'), 'a resposta não devolve a senha');

	console.log('• o campo cifrado nunca sai pela API, nem para admin');
	const lida = await api('GET', `/items/nfse_empresas/${id}?fields=*`, { token });
	assert.equal(lida.json.data.certificado_cifrado, '**********');
	const noBanco = execSync(`docker compose exec -T postgres psql -U directus -tAc "select certificado_cifrado from nfse_empresas where id=${id}"`, { cwd: raiz }).toString();
	assert.match(noBanco, /"v":1,"kid":"[0-9a-f]{16}"/, 'no banco fica o envelope cifrado');
	assert.ok(!noBanco.includes(pfx.toString('base64').slice(0, 40)), 'o pfx não fica em claro no banco');

	console.log('• sincronização com o ADN simulado (mTLS)');
	const sinc = await api('POST', `/nfse-nacional/empresas/${id}/sincronizar`, { token });
	assert.equal(sinc.status, 200, JSON.stringify(sinc.json));
	assert.deepEqual(sinc.json, { ultimoNsu: 3, documentos: 3, lotes: 1, concluido: true });

	const docs = await api('GET', '/items/nfse_documentos?sort=nsu&fields=nsu,tipo_documento,papel,numero,valor_servico,emitente_nome,tomador_documento,empresa', { token });
	assert.equal(docs.json.data.length, 3);
	assert.deepEqual(docs.json.data[1], { nsu: '2', tipo_documento: 'NFSE', papel: 'tomador', numero: '2', valor_servico: '1137.79', emitente_nome: 'PRESTADOR FICTICIO', tomador_documento: CNPJ, empresa: id });
	assert.equal(docs.json.data[2].tipo_documento, 'EVENTO');

	const depois = await api('GET', `/items/nfse_empresas/${id}`, { token });
	assert.equal(Number(depois.json.data.ultimo_nsu), 3);
	assert.equal(depois.json.data.situacao, 'ok');

	console.log('• nova sincronização não duplica');
	const de_novo = await api('POST', `/nfse-nacional/empresas/${id}/sincronizar`, { token });
	assert.equal(de_novo.json.documentos, 0);
	assert.equal(Number((await api('GET', '/items/nfse_documentos?aggregate[count]=*', { token })).json.data[0].count), 3);

	console.log('• rotas da extensão exigem admin');
	assert.equal((await api('POST', `/nfse-nacional/empresas/${id}/sincronizar`)).status, 403);

	console.log('\n✔ ponta a ponta OK');
}
catch (erro) {
	falhou = true;
	console.error('\n✖ falhou:', erro.message);
	execSync('docker compose logs --tail=60 directus adn-simulado', { cwd: raiz, stdio: 'inherit' });
}
finally {
	if (!manter) compose('down -v --remove-orphans');
	else console.log(`\nAmbiente no ar: ${URL_DIRECTUS} (admin@exemplo.com / senha-de-teste)`);
}

process.exitCode = falhou ? 1 : 0;
