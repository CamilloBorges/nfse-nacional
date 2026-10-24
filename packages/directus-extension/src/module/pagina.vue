<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk';
import { onMounted, reactive, ref } from 'vue';
import { LOGO_NFSE } from './logo-nfse.js';

interface Empresa {
	id: number;
	cnpj: string;
	nome: string | null;
	situacao: string | null;
	origem_certificado: string;
	prefixo_variaveis: string | null;
	certificado_titular: string | null;
	certificado_validade: string | null;
	ultima_sincronizacao: string | null;
	ultimo_nsu: number;
	ultimo_erro: string | null;
}

const api = useApi();
const empresas = ref<Empresa[]>([]);
const carregando = ref(true);
const erroGeral = ref<string | null>(null);
const arquivos = reactive<Record<number, File | undefined>>({});
const senhas = reactive<Record<number, string>>({});
const mensagens = reactive<Record<number, { tipo: string; texto: string } | undefined>>({});
const enviando = ref<number | null>(null);
const situacao = ref<Situacao | null>(null);
const salvandoConsentimento = ref(false);

interface Divergencia {
	assinatura: string;
	tipo: string;
	detalhe: string;
	ocorrencias: number;
	issue: { numero: number; url: string; estado: 'aberta' | 'fechada'; corrigidaNaVersao: string | null } | null;
}

interface Situacao {
	versaoInstalada: string;
	ultimaVersao: string | null;
	relatarDivergencias: boolean;
	divergencias: Divergencia[];
}
const sincronizando = ref<number | null>(null);

onMounted(carregar);

async function carregar() {
	carregando.value = true;

	try {
		const { data } = await api.get('/items/nfse_empresas', { params: { limit: -1, sort: 'nome', fields: ['*'] } });
		empresas.value = data.data;
		situacao.value = (await api.get('/nfse-nacional/situacao')).data;
		erroGeral.value = null;
	}
	catch (erro) {
		erroGeral.value = textoErro(erro);
	}
	finally {
		carregando.value = false;
	}
}

function escolherArquivo(id: number, evento: Event) {
	arquivos[id] = (evento.target as HTMLInputElement).files?.[0];
}

async function enviar(id: number) {
	const arquivo = arquivos[id];
	if (!arquivo) return;
	enviando.value = id;

	try {
		const pfx = await paraBase64(arquivo);
		const { data: info } = await api.post(`/nfse-nacional/empresas/${id}/certificado`, { pfx, senha: senhas[id] });
		mensagens[id] = { tipo: 'success', texto: `Certificado de ${info.titular} salvo (vence em ${data(info.validoAte)}).` };
		await carregar();
	}
	catch (erro) {
		mensagens[id] = { tipo: 'danger', texto: textoErro(erro) };
	}
	finally {
		// A senha não fica na tela depois do envio.
		senhas[id] = '';
		enviando.value = null;
	}
}

async function sincronizar(id: number) {
	sincronizando.value = id;

	try {
		const { data } = await api.post(`/nfse-nacional/empresas/${id}/sincronizar`);

		mensagens[id] = data.aviso
			? { tipo: 'warning', texto: data.aviso }
			: { tipo: 'success', texto: `${data.documentos} documento(s) novo(s), NSU ${data.ultimoNsu}${data.concluido ? '' : ' (ainda há mais; continua na próxima execução)'}.` };

		await carregar();
	}
	catch (erro) {
		mensagens[id] = { tipo: 'danger', texto: textoErro(erro) };
	}
	finally {
		sincronizando.value = null;
	}
}

/** Consentimento para relatar mudanças do ADN (coleção singleton nfse_configuracoes). */
async function alterarConsentimento(valor: boolean) {
	salvandoConsentimento.value = true;

	try {
		await api.patch('/items/nfse_configuracoes', { relatar_divergencias: valor });
		if (situacao.value) situacao.value.relatarDivergencias = valor;
	}
	catch (erro) {
		erroGeral.value = textoErro(erro);
	}
	finally {
		salvandoConsentimento.value = false;
	}
}

/** Compara versões x.y.z. */
function maisNova(a: string | null, b: string): boolean {
	if (!a) return false;
	const [x, y] = [a, b].map((v) => v.split('.').map(Number));

	for (let i = 0; i < 3; i++) {
		if ((x?.[i] ?? 0) !== (y?.[i] ?? 0)) return (x?.[i] ?? 0) > (y?.[i] ?? 0);
	}

	return false;
}

function paraBase64(arquivo: File): Promise<string> {
	return new Promise((resolver, rejeitar) => {
		const leitor = new FileReader();
		leitor.addEventListener('load', () => resolver(String(leitor.result).split(',')[1] ?? ''));
		leitor.addEventListener('error', () => rejeitar(leitor.error));
		leitor.readAsDataURL(arquivo);
	});
}

function data(valor: string | null, comHora = false): string {
	if (!valor) return '—';
	const d = new Date(valor);
	return comHora ? d.toLocaleString('pt-BR') : d.toLocaleDateString('pt-BR');
}

function textoErro(erro: unknown): string {
	const e = erro as { response?: { data?: { erro?: string; errors?: Array<{ message: string }> } }; message?: string };
	return e.response?.data?.erro ?? e.response?.data?.errors?.[0]?.message ?? e.message ?? 'Erro desconhecido.';
}
</script>

<template>
	<private-view title="NFS-e Nacional">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="receipt_long" />
			</v-button>
		</template>

		<div class="conteudo">
			<header class="cabecalho">
				<img :src="LOGO_NFSE" alt="NFS-e — Nota Fiscal de Serviço eletrônica">
				<p>Notas de serviço buscadas automaticamente no Ambiente de Dados Nacional (ADN).</p>
			</header>

			<v-notice v-if="erroGeral" type="danger">
				{{ erroGeral }}
			</v-notice>
			<v-notice v-if="situacao && maisNova(situacao.ultimaVersao, situacao.versaoInstalada)" type="warning">
				Versão {{ situacao.ultimaVersao }} disponível (instalada: {{ situacao.versaoInstalada }}). Atualize a extensão: novas versões acompanham as mudanças do ADN.
			</v-notice>
			<v-notice v-if="!carregando && empresas.length === 0" type="info">
				Cadastre as empresas na coleção "nfse_empresas" (CNPJ só com dígitos) e volte aqui para enviar o certificado.
			</v-notice>

			<div v-for="empresa in empresas" :key="empresa.id" class="empresa">
				<h2>{{ empresa.nome || empresa.cnpj }} <small>{{ empresa.cnpj }}</small></h2>

				<dl>
					<dt>Situação</dt>
					<dd><span class="situacao" :class="[empresa.situacao]">{{ empresa.situacao || 'nunca sincronizada' }}</span></dd>
					<dt>Certificado</dt>
					<dd>
						<template v-if="empresa.certificado_titular">
							{{ empresa.certificado_titular }} · vence em {{ data(empresa.certificado_validade) }}
						</template>
						<template v-else-if="empresa.origem_certificado === 'arquivo'">
							arquivo no servidor ({{ empresa.prefixo_variaveis }})
						</template>
						<template v-else>
							não enviado
						</template>
					</dd>
					<dt>Última sincronização</dt>
					<dd>{{ empresa.ultima_sincronizacao ? data(empresa.ultima_sincronizacao, true) : '—' }} · NSU {{ empresa.ultimo_nsu }}</dd>
					<template v-if="empresa.ultimo_erro">
						<dt>Último erro</dt>
						<dd class="erro">
							{{ empresa.ultimo_erro }}
						</dd>
					</template>
				</dl>

				<div class="acoes">
					<label class="arquivo">
						<input type="file" accept=".pfx,.p12" @change="escolherArquivo(empresa.id, $event)">
						<v-icon name="upload_file" small />
						{{ arquivos[empresa.id]?.name ?? 'Escolher .pfx' }}
					</label>
					<v-input v-model="senhas[empresa.id]" type="password" placeholder="Senha do certificado" autocomplete="off" />
					<v-button :loading="enviando === empresa.id" :disabled="!arquivos[empresa.id] || !senhas[empresa.id]" @click="enviar(empresa.id)">
						Enviar certificado
					</v-button>
					<v-button secondary :loading="sincronizando === empresa.id" @click="sincronizar(empresa.id)">
						Sincronizar agora
					</v-button>
				</div>

				<v-notice v-if="mensagens[empresa.id]" :type="mensagens[empresa.id].tipo">
					{{ mensagens[empresa.id].texto }}
				</v-notice>
			</div>

			<section v-if="situacao" class="bloco">
				<h2>Mudanças do ADN</h2>
				<v-checkbox
					:model-value="situacao.relatarDivergencias"
					:disabled="salvandoConsentimento"
					label="Relatar automaticamente ao projeto as mudanças do ADN detectadas"
					@update:model-value="alterarConsentimento"
				/>
				<p class="nota">
					Quando o ADN muda (versão do leiaute, campos, rotas), a sincronização continua e a mudança aparece aqui.
					Com esta opção, a extensão envia ao projeto só o tipo da mudança e as versões, para abrir (ou somar a) uma issue no GitHub,
					e avisa aqui quando ela for corrigida. Nunca envia CNPJ, XML, valores ou nomes.
				</p>

				<table v-if="situacao.divergencias.length > 0">
					<thead>
						<tr><th>Mudança</th><th>Ocorrências</th><th>Issue</th></tr>
					</thead>
					<tbody>
						<tr v-for="d in situacao.divergencias" :key="d.assinatura">
							<td><code>{{ d.tipo }}</code> {{ d.detalhe }}</td>
							<td>{{ d.ocorrencias }}</td>
							<td>
								<a v-if="d.issue" :href="d.issue.url" target="_blank" rel="noopener">#{{ d.issue.numero }}</a>
								<template v-if="d.issue?.estado === 'fechada'">
									· corrigida{{ d.issue.corrigidaNaVersao ? ` na versão ${d.issue.corrigidaNaVersao}` : '' }}
								</template>
								<template v-else-if="d.issue">
									· aberta
								</template>
								<template v-else>
									não relatada
								</template>
							</td>
						</tr>
					</tbody>
				</table>
				<p v-else class="nota">
					Nenhuma mudança detectada.
				</p>
			</section>

			<footer class="creditos">
				Logotipo da NFS-e: Governo Federal (<a href="https://www.gov.br/nfse" target="_blank" rel="noopener">gov.br/nfse</a>), sob CC BY-ND 3.0.
				Extensão independente, sem vínculo com a Receita Federal ou o Comitê Gestor da NFS-e.
			</footer>
		</div>
	</private-view>
</template>

<style scoped>
.cabecalho {
	display: flex;
	gap: 20px;
	align-items: center;
	margin-bottom: 24px;
}
.cabecalho img {
	height: 72px;
	width: auto;
}
.cabecalho p {
	color: var(--theme--foreground-subdued);
}
.creditos {
	margin-top: 32px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}
.conteudo {
	padding: var(--content-padding);
	padding-top: 0;
	max-width: 900px;
}
.empresa {
	margin-bottom: 32px;
	padding: 20px;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}
h2 {
	font-size: 18px;
	font-weight: 600;
	margin-bottom: 12px;
}
h2 small {
	color: var(--theme--foreground-subdued);
	font-weight: 400;
	margin-left: 8px;
}
dl {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 6px 16px;
	margin-bottom: 16px;
}
dt {
	color: var(--theme--foreground-subdued);
}
.erro {
	color: var(--theme--danger);
}
.situacao.ok {
	color: var(--theme--success);
}
.situacao.certificado_vencendo {
	color: var(--theme--warning);
}
.situacao.certificado_vencido,
.situacao.erro,
.situacao.sem_certificado {
	color: var(--theme--danger);
}
.acoes {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	margin-bottom: 12px;
}
.arquivo {
	display: inline-flex;
	gap: 6px;
	align-items: center;
	padding: 0 16px;
	height: var(--theme--form--field--input--height, 52px);
	border: var(--theme--border-width) dashed var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	color: var(--theme--foreground-subdued);
	cursor: pointer;
}
.arquivo:hover {
	border-color: var(--theme--primary);
	color: var(--theme--primary);
}
.arquivo input {
	display: none;
}
.bloco {
	margin-top: 8px;
	padding: 20px;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}
.nota {
	color: var(--theme--foreground-subdued);
	margin: 8px 0 16px;
}
table {
	width: 100%;
	border-collapse: collapse;
}
th,
td {
	text-align: left;
	padding: 6px 8px;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}
.situacao.adn_alterado {
	color: var(--theme--warning);
}
.acoes .v-input {
	max-width: 260px;
}
</style>
