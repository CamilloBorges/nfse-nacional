import type { ChamarGitHub } from '../src/github.js';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync, verify } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { divergencia } from '../../core/src/contrato-adn.js';
import { clienteGitHub, limparCacheDoToken } from '../src/github.js';
import { tratar } from '../src/index.js';
import { assinar, validarRelato, versaoMaiorOuIgual } from '../src/validacao.js';

const env = { GITHUB_APP_ID: '', GITHUB_APP_CHAVE: '', GITHUB_INSTALACAO_ID: '', REPOSITORIO: 'dono/repo' };
const base = divergencia('leiaute_desconhecido', 'NFSe@versao=1.02');
const relato = { ...base, versaoPacote: '0.3.0', versaoDirectus: '12.4.1', ambiente: 'producao', instalacao: '0b6f2c1e-8d4a-4f7e-9c3b-1a2b3c4d5e6f' };

/** GitHub falso: só o que o relé usa (listar por rótulo, criar, editar, comentar). */
function githubFalso() {
	const issues: any[] = [];
	const comentarios: string[] = [];

	const chamar: ChamarGitHub = async (metodo, caminho, corpo: any) => {
		const numero = Number(/issues\/(\d+)/.exec(caminho)?.[1]);
		if (metodo === 'GET') return issues.filter((i) => i.labels.includes('adn-mudanca'));

		if (metodo === 'POST' && caminho.endsWith('/issues')) {
			const issue = { number: issues.length + 1, html_url: `https://github.com/dono/repo/issues/${issues.length + 1}`, state: 'open', milestone: null, ...corpo };
			issues.push(issue);
			return issue;
		}

		if (metodo === 'POST' && caminho.endsWith('/comments')) return comentarios.push(corpo.body);
		const issue = issues.find((i) => i.number === numero);
		Object.assign(issue, corpo);
		return issue;
	};

	return { chamar, issues, comentarios };
}

const post = (corpo: unknown, cabecalhos: Record<string, string> = {}) =>
	new Request('https://rele/relatos', { method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'application/json', ...cabecalhos } });

describe('validação do relato', () => {
	it('a assinatura do relé é a mesma do núcleo', async () => {
		expect(await assinar(base.tipo, base.detalhe)).toBe(base.assinatura);
		expect('relato' in (await validarRelato(relato))).toBe(true);
	});

	it('recusa dado numérico longo, assinatura trocada e campos fora do formato', async () => {
		const comCnpj = { ...relato, detalhe: 'cnpj12345678000195', assinatura: await assinar(relato.tipo, 'cnpj12345678000195') };
		expect(await validarRelato(comCnpj)).toEqual({ erros: ['detalhe com dados numéricos'] });
		expect(await validarRelato({ ...relato, assinatura: '000000000000' })).toEqual({ erros: ['assinatura não confere'] });

		expect(await validarRelato({ ...relato, tipo: 'qualquer', ambiente: 'x', instalacao: '1', versaoPacote: 'v1' })).toMatchObject({
			erros: ['tipo inválido', 'versaoPacote inválida', 'ambiente inválido', 'instalacao inválida'],
		});
	});

	it('compara versões', () => {
		expect(versaoMaiorOuIgual('0.3.1', '0.3.1')).toBe(true);
		expect(versaoMaiorOuIgual('0.10.0', '0.9.9')).toBe(true);
		expect(versaoMaiorOuIgual('0.3.0', '0.3.1')).toBe(false);
	});
});

describe('relé', () => {
	let gh: ReturnType<typeof githubFalso>;

	beforeEach(() => {
		gh = githubFalso();
	});

	it('cria a issue com rótulo, título pela assinatura e sem dados fiscais', async () => {
		const r = await tratar(post(relato), env, gh.chamar);
		expect(await r.json()).toEqual({ numero: 1, url: 'https://github.com/dono/repo/issues/1', estado: 'aberta', corrigidaNaVersao: null });
		expect(gh.issues[0].title).toBe(`ADN: leiaute_desconhecido NFSe@versao=1.02 [${base.assinatura}]`);
		expect(gh.issues[0].labels).toEqual(['adn-mudanca']);
		expect(gh.issues[0].body).toContain('Instalações afetadas: 1');
	});

	it('não duplica: soma instalações na issue aberta', async () => {
		await tratar(post(relato), env, gh.chamar);
		const r = await tratar(post({ ...relato, instalacao: '1b6f2c1e-8d4a-4f7e-9c3b-1a2b3c4d5e6f' }), env, gh.chamar);
		expect(((await r.json()) as { numero: number }).numero).toBe(1);
		expect(gh.issues).toHaveLength(1);
		expect(gh.issues[0].body).toContain('Instalações afetadas: 2');
	});

	it('fechada com correção numa versão mais nova: devolve a versão para a instalação atualizar', async () => {
		await tratar(post(relato), env, gh.chamar);
		Object.assign(gh.issues[0], { state: 'closed', milestone: { title: 'v0.3.1' } });
		const r = await tratar(post({ ...relato, instalacao: '2b6f2c1e-8d4a-4f7e-9c3b-1a2b3c4d5e6f' }), env, gh.chamar);
		expect(await r.json()).toMatchObject({ estado: 'fechada', corrigidaNaVersao: '0.3.1' });
		expect(gh.issues[0].state).toBe('closed');
	});

	it('regressão (ocorre na versão que deveria estar corrigida): reabre', async () => {
		await tratar(post(relato), env, gh.chamar);
		Object.assign(gh.issues[0], { state: 'closed', milestone: { title: 'v0.3.0' } });
		const r = await tratar(post(relato), env, gh.chamar);
		expect(await r.json()).toMatchObject({ estado: 'aberta' });
		expect(gh.issues[0].state).toBe('open');
		expect(gh.comentarios[0]).toContain('Reaberta automaticamente');
	});

	it('respeita o limite de envios e as rotas', async () => {
		const limite = { limit: vi.fn(async () => ({ success: false })) };
		expect((await tratar(post(relato), { ...env, LIMITE: limite }, gh.chamar)).status).toBe(429);
		expect((await tratar(post({ x: 1 }), env, gh.chamar)).status).toBe(400);
		expect((await tratar(new Request('https://rele/outra'), env, gh.chamar)).status).toBe(404);
		expect((await tratar(post(relato), env)).status).toBe(503);
	});
});

describe('GitHub App', () => {
	it('autentica com JWT RS256 e usa o token de instalação', async () => {
		limparCacheDoToken();
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const chavePkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
		const chamadas: Array<{ url: string; auth: string }> = [];

		const fazerFetch = vi.fn(async (url: string, init: RequestInit) => {
			const auth = (init.headers as Record<string, string>).Authorization!;
			chamadas.push({ url, auth });
			if (url.endsWith('/access_tokens')) return Response.json({ token: 'tok-inst', expires_at: new Date(Date.now() + 3_600_000).toISOString() });
			return Response.json([]);
		});

		const github = clienteGitHub({ appId: '123', chavePkcs8, instalacaoId: '456' }, fazerFetch as unknown as typeof fetch);
		await github('GET', '/repos/dono/repo/issues');
		await github('GET', '/repos/dono/repo/issues');

		const jwt = chamadas[0]!.auth.replace('Bearer ', '');
		const [cabecalho, conteudo, assinatura] = jwt.split('.');
		const valido = verify('sha256', Buffer.from(`${cabecalho}.${conteudo}`), publicKey, Buffer.from(assinatura!, 'base64url'));
		expect(valido).toBe(true);
		expect(JSON.parse(Buffer.from(conteudo!, 'base64url').toString()).iss).toBe('123');
		expect(chamadas.map((c) => c.auth)).toEqual([chamadas[0]!.auth, 'token tok-inst', 'token tok-inst']);
		expect(chamadas[0]!.url).toBe('https://api.github.com/app/installations/456/access_tokens');
	});
});
