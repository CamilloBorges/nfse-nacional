<template>
	<private-view title="NFS-e Nacional">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="receipt_long" />
			</v-button>
		</template>

		<div class="conteudo">
			<v-notice v-if="erroGeral" type="danger">{{ erroGeral }}</v-notice>
			<v-notice v-else-if="!carregando && empresas.length === 0" type="info">
				Cadastre as empresas na coleção "nfse_empresas" (CNPJ só com dígitos) e volte aqui para enviar o certificado.
			</v-notice>

			<div v-for="empresa in empresas" :key="empresa.id" class="empresa">
				<h2>{{ empresa.nome || empresa.cnpj }} <small>{{ empresa.cnpj }}</small></h2>

				<dl>
					<dt>Situação</dt>
					<dd><span :class="['situacao', empresa.situacao]">{{ empresa.situacao || 'nunca sincronizada' }}</span></dd>
					<dt>Certificado</dt>
					<dd>
						<template v-if="empresa.certificado_titular">
							{{ empresa.certificado_titular }} · vence em {{ data(empresa.certificado_validade) }}
						</template>
						<template v-else-if="empresa.origem_certificado === 'arquivo'">arquivo no servidor ({{ empresa.prefixo_variaveis }})</template>
						<template v-else>não enviado</template>
					</dd>
					<dt>Última sincronização</dt>
					<dd>{{ empresa.ultima_sincronizacao ? data(empresa.ultima_sincronizacao, true) : '—' }} · NSU {{ empresa.ultimo_nsu }}</dd>
					<template v-if="empresa.ultimo_erro">
						<dt>Último erro</dt>
						<dd class="erro">{{ empresa.ultimo_erro }}</dd>
					</template>
				</dl>

				<div class="acoes">
					<input type="file" accept=".pfx,.p12" @change="escolherArquivo(empresa.id, $event)" />
					<v-input v-model="senhas[empresa.id]" type="password" placeholder="Senha do certificado" autocomplete="off" />
					<v-button :loading="enviando === empresa.id" :disabled="!arquivos[empresa.id] || !senhas[empresa.id]" @click="enviar(empresa.id)">
						Enviar certificado
					</v-button>
					<v-button secondary :loading="sincronizando === empresa.id" @click="sincronizar(empresa.id)">Sincronizar agora</v-button>
				</div>

				<v-notice v-if="mensagens[empresa.id]" :type="mensagens[empresa.id].tipo">{{ mensagens[empresa.id].texto }}</v-notice>
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk';
import { onMounted, reactive, ref } from 'vue';

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
const sincronizando = ref<number | null>(null);

onMounted(carregar);

async function carregar() {
	carregando.value = true;
	try {
		const { data } = await api.get('/items/nfse_empresas', { params: { limit: -1, sort: 'nome', fields: ['*'] } });
		empresas.value = data.data;
		erroGeral.value = null;
	} catch (erro) {
		erroGeral.value = textoErro(erro);
	} finally {
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
	} catch (erro) {
		mensagens[id] = { tipo: 'danger', texto: textoErro(erro) };
	} finally {
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
	} catch (erro) {
		mensagens[id] = { tipo: 'danger', texto: textoErro(erro) };
	} finally {
		sincronizando.value = null;
	}
}

function paraBase64(arquivo: File): Promise<string> {
	return new Promise((resolver, rejeitar) => {
		const leitor = new FileReader();
		leitor.onload = () => resolver(String(leitor.result).split(',')[1] ?? '');
		leitor.onerror = () => rejeitar(leitor.error);
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

<style scoped>
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
.acoes .v-input {
	max-width: 260px;
}
</style>
