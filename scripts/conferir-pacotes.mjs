// Confere os package.json antes do PR e da publicação (no espírito do check-package-json do directus-labs):
// repositório e pasta corretos, mesma versão nos dois pacotes, só dist publicado e requisitos do Marketplace.
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const REPOSITORIO = 'https://github.com/CamilloBorges/nfse-nacional.git';
const erros = [];
const ler = (arquivo) => JSON.parse(readFileSync(arquivo, 'utf8'));
const raiz = ler('package.json');

for (const pasta of ['packages/core', 'packages/directus-extension']) {
	const p = ler(`${pasta}/package.json`);
	const exigir = (condicao, mensagem) => condicao || erros.push(`${pasta}: ${mensagem}`);

	exigir(p.repository?.url === REPOSITORIO, `repository.url deve ser ${REPOSITORIO}`);
	exigir(p.repository?.directory === pasta, `repository.directory deve ser "${pasta}"`);
	exigir(p.version === raiz.version, `versão ${p.version} diferente da raiz (${raiz.version})`);
	exigir(p.license === 'MIT', 'licença deve ser MIT');
	exigir(JSON.stringify(p.files) === '["dist"]', 'files deve publicar só "dist"');
	exigir(Boolean(p.description), 'falta description');
	exigir(existsSync(`${pasta}/README.md`), 'falta README.md');
}

// Requisitos do Directus Marketplace.
const ext = ler('packages/directus-extension/package.json');
const config = ext['directus:extension'] ?? {};
if (!ext.keywords?.includes('directus-extension')) erros.push('extensão: falta a keyword "directus-extension"');
if (!config.type || !config.host) erros.push('extensão: directus:extension precisa de type e host');
if (!ext.icon) erros.push('extensão: falta o icon');
if (/^(?:an extension|extensão)/i.test(ext.description)) erros.push('extensão: a descrição deve começar por um verbo');
if (!ext.dependencies?.['nfse-nacional-core']) erros.push('extensão: deve depender de nfse-nacional-core');

if (erros.length > 0) {
	console.error(erros.map((e) => `✖ ${e}`).join('\n'));
	process.exit(1);
}

console.log(`✔ pacotes conferidos (versão ${raiz.version})`);
