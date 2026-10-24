// Cria o GitHub App do relé pelo fluxo de manifesto (só para quem mantém o projeto).
// Uso: node scripts/criar-github-app.mjs <pasta-segura-fora-do-repositorio>
// Abra http://localhost:3456, confirme a criação no GitHub e depois instale o App no repositório.
// Grava na pasta: app-id, chave-pkcs8.pem (para o segredo GITHUB_APP_CHAVE do Worker) e instalacao-id.
import { Buffer } from 'node:buffer';
import { createPrivateKey, createSign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';

const pasta = process.argv[2];

if (!pasta) {
	console.error('Uso: node scripts/criar-github-app.mjs <pasta-segura-fora-do-repositorio>');
	process.exit(1);
}

const PORTA = 3456;
const REPOSITORIO = 'CamilloBorges/nfse-nacional';

const manifesto = {
	name: 'nfse-nacional-rele',
	url: `https://github.com/${REPOSITORIO}`,
	description: 'Abre e atualiza issues de mudanças do ADN relatadas pelas instalações do nfse-nacional (sem dados fiscais).',
	hook_attributes: { url: 'https://nfse-rele.bomgado.net/', active: false },
	redirect_url: `http://localhost:${PORTA}/retorno`,
	public: false,
	default_permissions: { issues: 'write', metadata: 'read' },
	default_events: [],
};

let app;

function jwt() {
	const agora = Math.floor(Date.now() / 1000);
	const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
	const dados = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: agora - 60, exp: agora + 540, iss: String(app.id) })}`;
	return `${dados}.${createSign('RSA-SHA256').update(dados).sign(app.pem, 'base64url')}`;
}

async function github(caminho, opcoes = {}) {
	const r = await fetch(`https://api.github.com${caminho}`, {
		...opcoes,
		headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'nfse-nacional', ...opcoes.headers },
	});

	if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
	return r.json();
}

const servidor = createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORTA}`);
	res.setHeader('Content-Type', 'text/html; charset=utf-8');

	if (url.pathname === '/') {
		return res.end(`<form id="f" method="post" action="https://github.com/settings/apps/new">
<input type="hidden" name="manifest" value='${JSON.stringify(manifesto).replaceAll('\'', '&#39;')}'>
<p>Criando o GitHub App <b>nfse-nacional-rele</b> (permissão: só issues)…</p><button>Continuar no GitHub</button></form>
<script>document.getElementById('f').submit()</script>`);
	}

	if (url.pathname === '/retorno') {
		try {
			app = await github(`/app-manifests/${url.searchParams.get('code')}/conversions`, { method: 'POST' });
			const pkcs8 = createPrivateKey(app.pem).export({ type: 'pkcs8', format: 'pem' });
			writeFileSync(path.join(pasta, 'app-id'), String(app.id));
			writeFileSync(path.join(pasta, 'chave-pkcs8.pem'), pkcs8);
			console.log(`App criado: ${app.slug} (id ${app.id}). Aguardando a instalação no repositório…`);
			res.end(`<p>App criado. Agora <a href="${app.html_url}/installations/new">instale no repositório ${REPOSITORIO}</a> (escolha "Only select repositories").</p>`);
			// Roda em segundo plano enquanto a pessoa instala o App; erros já são tratados lá dentro.
			void esperarInstalacao();
		}
		catch (erro) {
			res.end(`<p>Falhou: ${erro.message}</p>`);
		}

		return;
	}

	res.statusCode = 404;
	res.end();
});

async function esperarInstalacao() {
	for (let i = 0; i < 120; i++) {
		try {
			const instalacao = await github(`/repos/${REPOSITORIO}/installation`, { headers: { Authorization: `Bearer ${jwt()}` } });
			writeFileSync(path.join(pasta, 'instalacao-id'), String(instalacao.id));
			console.log(`Instalado (instalação ${instalacao.id}). Pronto.`);
			servidor.close();
			return;
		}
		catch {
			await new Promise((r) => setTimeout(r, 5000));
		}
	}

	console.error('A instalação não foi feita em 10 minutos.');
	servidor.close();
}

servidor.listen(PORTA, () => console.log(`Abra http://localhost:${PORTA}`));
