// Prepara um lançamento: sobe a versão (os dois pacotes juntos) e fecha o "[Não lançado]" do CHANGELOG.
// Uso: pnpm versao patch|minor|major
// Depois: PR "chore(release): vX.Y.Z" → merge → git tag vX.Y.Z na main → git push origin vX.Y.Z
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const URL = 'https://github.com/CamilloBorges/nfse-nacional';
const PACOTES = ['package.json', 'packages/core/package.json', 'packages/directus-extension/package.json'];
const tipo = process.argv[2];

if (!['patch', 'minor', 'major'].includes(tipo)) {
	console.error('Uso: pnpm versao patch|minor|major');
	process.exit(1);
}

const atual = JSON.parse(readFileSync('package.json', 'utf8')).version;
const [maior, menor, correcao] = atual.split('.').map(Number);
const proximas = { major: `${maior + 1}.0.0`, minor: `${maior}.${menor + 1}.0`, patch: `${maior}.${menor}.${correcao + 1}` };
const nova = proximas[tipo];

let changelog = readFileSync('CHANGELOG.md', 'utf8');
const naoLancado = changelog.split('## [Não lançado]')[1]?.split('\n## [')[0] ?? '';

if (!naoLancado.includes('### ')) {
	console.error('O "[Não lançado]" do CHANGELOG está vazio: descreva as mudanças antes de lançar.');
	process.exit(1);
}

for (const arquivo of PACOTES) {
	const pacote = JSON.parse(readFileSync(arquivo, 'utf8'));
	pacote.version = nova;
	writeFileSync(arquivo, `${JSON.stringify(pacote, null, '\t')}\n`);
}

const hoje = new Date().toISOString().slice(0, 10);

changelog = changelog
	.replace('## [Não lançado]', `## [Não lançado]\n\n## [${nova}] - ${hoje}`)
	.replace(
		`[Não lançado]: ${URL}/compare/v${atual}...HEAD`,
		`[Não lançado]: ${URL}/compare/v${nova}...HEAD\n[${nova}]: ${URL}/compare/v${atual}...v${nova}`,
	);

writeFileSync('CHANGELOG.md', changelog);

console.log(`Versão ${atual} → ${nova}. Próximos passos:
  git switch -c release/v${nova}
  git commit -am "chore(release): v${nova}" && git push -u origin release/v${nova}
  (abra o PR, espere os checks e faça o merge)
  git switch main && git pull && git tag v${nova} && git push origin v${nova}`);
