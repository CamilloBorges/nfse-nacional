// Vigia a documentação oficial do ADN (gov.br/nfse) e compara com a referência versionada.
// Uso: node scripts/vigiar-adn.mjs            → sai com código 2 e imprime as diferenças, se houver
//      node scripts/vigiar-adn.mjs --atualizar → grava a situação atual como nova referência
// Usa process.exitCode em vez de process.exit(): no Windows, sair logo depois do fetch derruba o Node.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const BASE = 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica';
const REFERENCIA = 'docs/adn-referencia.json';

async function pagina(caminho) {
	const r = await fetch(`${BASE}/${caminho}`, { headers: { 'User-Agent': 'Mozilla/5.0 (nfse-nacional vigia)' }, signal: AbortSignal.timeout(30_000) });
	if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
	return r.text();
}

const atualizadoEm = (html) => /class="documentModified"[\s\S]*?class="value">([^<]+)</.exec(html)?.[1]?.trim() ?? null;

function diferencas(referencia, atual) {
	const mudancas = [];
	const antes = new Set(referencia.documentacaoAtual.arquivos);
	const depois = new Set(atual.documentacaoAtual.arquivos);

	for (const a of depois) {
		if (!antes.has(a)) mudancas.push(`- **Novo arquivo:** [\`${a}\`](${BASE}/documentacao-atual/${a})`);
	}

	for (const a of antes) {
		if (!depois.has(a)) mudancas.push(`- **Arquivo removido ou substituído:** \`${a}\``);
	}

	for (const [chave, titulo] of [['documentacaoAtual', 'Documentação atual'], ['atualizacoesEImplantacoes', 'Atualizações e implantações']]) {
		if (atual[chave].atualizadoEm !== referencia[chave].atualizadoEm) {
			mudancas.push(`- **${titulo}** atualizada em ${atual[chave].atualizadoEm} (antes: ${referencia[chave].atualizadoEm})`);
		}
	}

	return mudancas;
}

const [documentacao, atualizacoes] = await Promise.all([pagina('documentacao-atual'), pagina('atualizacoes-e-implantacoes')]);

const atual = {
	documentacaoAtual: {
		atualizadoEm: atualizadoEm(documentacao),
		// Os arquivos trazem versão e data no nome (ex.: nfse-esquemas_xsd-v1-01-20260209.zip).
		arquivos: [...new Set(documentacao.match(/documentacao-atual\/[^"#?]+\.(?:pdf|zip|xlsx)/g))].map((a) => a.split('/')[1]).toSorted(),
	},
	atualizacoesEImplantacoes: { atualizadoEm: atualizadoEm(atualizacoes) },
};

if (process.argv.includes('--atualizar')) {
	writeFileSync(REFERENCIA, `${JSON.stringify({ ...atual, conferidoEm: new Date().toISOString().slice(0, 10) }, null, '\t')}\n`);
	console.log(`Referência atualizada em ${REFERENCIA}.`);
}
else {
	const mudancas = diferencas(JSON.parse(readFileSync(REFERENCIA, 'utf8')), atual);

	if (mudancas.length === 0) {
		console.log('Documentação do ADN sem mudanças em relação à referência.');
	}
	else {
		console.log([
			'A documentação oficial do ADN mudou desde a última conferência:',
			'',
			...mudancas,
			'',
			`Páginas: [documentação atual](${BASE}/documentacao-atual) · [atualizações e implantações](${BASE}/atualizacoes-e-implantacoes)`,
			'',
			'**Para fechar:** avaliar o impacto (leiaute, rotas, campos), ajustar o `CONTRATO_ADN` e o leitor se preciso e rodar `node scripts/vigiar-adn.mjs --atualizar` no PR da correção.',
		].join('\n'));

		process.exitCode = 2;
	}
}
