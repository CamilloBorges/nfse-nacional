/** Acesso ao GitHub como GitHub App (permissão só de issues neste repositório). */

export interface CredenciaisApp {
	appId: string;
	/** Chave privada do App em PKCS#8 (PEM). */
	chavePkcs8: string;
	instalacaoId: string;
}

export type ChamarGitHub = (metodo: string, caminho: string, corpo?: unknown) => Promise<any>;

const API = 'https://api.github.com';
let tokenEmCache: { valor: string; expiraEm: number } | undefined;

/** Cria a função de chamada autenticada (token de instalação, renovado perto de expirar). */
export function clienteGitHub(credenciais: CredenciaisApp, fazerFetch: typeof fetch = fetch): ChamarGitHub {
	async function token(): Promise<string> {
		if (tokenEmCache && tokenEmCache.expiraEm - Date.now() > 5 * 60_000) return tokenEmCache.valor;
		const jwt = await jwtDoApp(credenciais);

		const r = await fazerFetch(`${API}/app/installations/${credenciais.instalacaoId}/access_tokens`, {
			method: 'POST',
			headers: cabecalhos(`Bearer ${jwt}`),
		});

		if (!r.ok) throw new Error(`GitHub recusou o token de instalação (HTTP ${r.status})`);
		const { token: valor, expires_at } = (await r.json()) as { token: string; expires_at: string };
		tokenEmCache = { valor, expiraEm: Date.parse(expires_at) };
		return valor;
	}

	return async (metodo, caminho, corpo) => {
		const r = await fazerFetch(`${API}${caminho}`, {
			method: metodo,
			headers: { ...cabecalhos(`token ${await token()}`), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
			body: corpo ? JSON.stringify(corpo) : undefined,
		});

		if (!r.ok) throw new Error(`GitHub ${metodo} ${caminho.split('?')[0]}: HTTP ${r.status}`);
		return r.status === 204 ? null : r.json();
	};
}

/** Só para os testes: esquece o token em cache. */
export function limparCacheDoToken(): void {
	tokenEmCache = undefined;
}

function cabecalhos(autorizacao: string): Record<string, string> {
	return { 'Authorization': autorizacao, 'Accept': 'application/vnd.github+json', 'User-Agent': 'nfse-nacional-rele', 'X-GitHub-Api-Version': '2022-11-28' };
}

/** JWT RS256 do GitHub App (vale 9 minutos; iat 60 s no passado por causa de relógio). */
async function jwtDoApp({ appId, chavePkcs8 }: CredenciaisApp): Promise<string> {
	const agora = Math.floor(Date.now() / 1000);
	const base64url = (dados: string | ArrayBuffer) =>
		btoa(typeof dados === 'string' ? dados : String.fromCodePoint(...new Uint8Array(dados)))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/, '');

	const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const conteudo = base64url(JSON.stringify({ iat: agora - 60, exp: agora + 540, iss: appId }));
	const der = Uint8Array.from(atob(chavePkcs8.replaceAll(/-----[^-]+-----|\s/g, '')), (c) => c.codePointAt(0)!);
	const chave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
	const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cabecalho}.${conteudo}`));
	return `${cabecalho}.${conteudo}.${base64url(assinatura)}`;
}
