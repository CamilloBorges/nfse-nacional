import type { ChamarGitHub } from './github.js';
import type { Relato } from './validacao.js';
import { versaoMaiorOuIgual } from './validacao.js';

export const ROTULO = 'adn-mudanca';

export interface InfoIssue {
	numero: number;
	url: string;
	estado: 'aberta' | 'fechada';
	corrigidaNaVersao: string | null;
}

/** Número da issue de uma assinatura, guardado com consistência forte. */
export interface MemoriaDaIssue {
	obter: () => Promise<number | undefined>;
	guardar: (numero: number) => Promise<void>;
}

interface Issue {
	number: number;
	html_url: string;
	title: string;
	body: string | null;
	state: 'open' | 'closed';
	milestone?: { title?: string } | null;
}

/**
 * Encontra a issue da assinatura (no título) ou cria uma. Cada instalação relata cada assinatura uma
 * vez, então somar no corpo dá o número de instalações afetadas. Fechada e corrigida numa versão que a
 * instalação já tem: é regressão, a issue é reaberta.
 */
export async function encontrarOuCriarIssue(github: ChamarGitHub, repositorio: string, relato: Relato, memoria?: MemoriaDaIssue): Promise<InfoIssue> {
	// A memória (Durable Object) tem leitura imediata; a listagem do GitHub demora a refletir uma issue nova.
	let lembrada = await memoria?.obter();
	let existente: Issue | undefined;

	if (lembrada) {
		try {
			existente = await github('GET', `/repos/${repositorio}/issues/${lembrada}`);
		}
		catch (erro) {
			// Issue apagada ou transferida: esquece e procura de novo.
			if (!/HTTP (?:404|410)$/.test(erro instanceof Error ? erro.message : '')) throw erro;
			lembrada = undefined;
		}
	}

	existente ??= await procurar(github, repositorio, relato.assinatura);

	if (!existente) {
		const criada: Issue = await github('POST', `/repos/${repositorio}/issues`, {
			title: `ADN: ${relato.tipo} ${relato.detalhe} [${relato.assinatura}]`,
			body: corpoDaIssue(relato),
			labels: [ROTULO],
		});

		await memoria?.guardar(criada.number);
		return info(criada);
	}

	if (!lembrada) await memoria?.guardar(existente.number);

	const corrigidaNaVersao = versaoDaMilestone(existente);

	if (existente.state === 'closed') {
		const regressao = corrigidaNaVersao !== null && versaoMaiorOuIgual(relato.versaoPacote, corrigidaNaVersao);
		if (!regressao) return info(existente);

		await github('PATCH', `/repos/${repositorio}/issues/${existente.number}`, { state: 'open' });

		await github('POST', `/repos/${repositorio}/issues/${existente.number}/comments`, {
			body: `Reaberta automaticamente: ocorreu de novo na versão ${relato.versaoPacote}, que deveria ter a correção da ${corrigidaNaVersao}.`,
		});

		return { ...info(existente), estado: 'aberta', corrigidaNaVersao: null };
	}

	await github('PATCH', `/repos/${repositorio}/issues/${existente.number}`, { body: somarInstalacao(existente.body ?? '', relato) });
	return info(existente);
}

async function procurar(github: ChamarGitHub, repositorio: string, assinatura: string): Promise<Issue | undefined> {
	// Lista pelo rótulo em vez da busca do GitHub: a busca tem atraso de indexação e duplicaria issues.
	for (let pagina = 1; pagina <= 5; pagina++) {
		const issues: Issue[] = await github('GET', `/repos/${repositorio}/issues?labels=${ROTULO}&state=all&per_page=100&page=${pagina}`);
		const achada = issues.find((i) => i.title.endsWith(`[${assinatura}]`));
		if (achada || issues.length < 100) return achada;
	}

	return undefined;
}

function corpoDaIssue(relato: Relato): string {
	return [
		'Mudança no ADN detectada automaticamente por uma instalação da extensão (relato sem dados fiscais).',
		'',
		'| | |',
		'|---|---|',
		`| Tipo | \`${relato.tipo}\` |`,
		`| Detalhe | \`${relato.detalhe}\` |`,
		`| Assinatura | \`${relato.assinatura}\` |`,
		`| Primeira ocorrência | ${new Date().toISOString().slice(0, 10)} · pacote ${relato.versaoPacote} · Directus ${relato.versaoDirectus ?? '?'} · ${relato.ambiente} |`,
		'',
		'Instalações afetadas: 1',
		'',
		'---',
		'**Para quem mantém:** confira a mudança na [documentação do ADN](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica), atualize o `CONTRATO_ADN` e o leitor, e feche esta issue com a **milestone da versão** que traz a correção (ex.: `v0.3.1`). As instalações que relataram serão avisadas para atualizar.',
	].join('\n');
}

function somarInstalacao(corpo: string, relato: Relato): string {
	const atual = Number(/Instalações afetadas: (\d+)/.exec(corpo)?.[1] ?? 1);
	const linha = `| Ocorrência | ${new Date().toISOString().slice(0, 10)} · pacote ${relato.versaoPacote} · Directus ${relato.versaoDirectus ?? '?'} · ${relato.ambiente} |`;
	return corpo.replace(/Instalações afetadas: \d+/, `Instalações afetadas: ${atual + 1}`).replace('\n\nInstalações afetadas', `\n${linha}\n\nInstalações afetadas`);
}

function versaoDaMilestone(issue: Issue): string | null {
	return /^v?(\d+\.\d+\.\d+)$/.exec(issue.milestone?.title ?? '')?.[1] ?? null;
}

function info(issue: Issue): InfoIssue {
	return {
		numero: issue.number,
		url: issue.html_url,
		estado: issue.state === 'closed' ? 'fechada' : 'aberta',
		corrigidaNaVersao: issue.state === 'closed' ? versaoDaMilestone(issue) : null,
	};
}
