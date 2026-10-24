# nfse-nacional-core

Biblioteca Node para as APIs de contribuintes do **ADN da NFS-e Nacional**: abre o certificado A1, conecta por mTLS,
percorre a distribuição por NSU, lê o XML da NFS-e e guarda o certificado cifrado. Não depende do Directus.

```bash
npm install nfse-nacional-core
```

## Uso direto

```ts
import { abrirCertificado, ClienteAdn, descompactarXml, lerNfse, sincronizar } from 'nfse-nacional-core';

const certificado = abrirCertificado(await readFile('empresa.pfx'), process.env.SENHA!);
const cliente = new ClienteAdn({ certificado, ambiente: 'producao_restrita' });

await sincronizar({
	cliente,
	ultimoNsu: 0,
	aoReceberLote: async (itens, ultimoNsu) => {
		for (const item of itens) console.log(lerNfse(descompactarXml(item.ArquivoXml)));
		// grave os itens e o novo cursor (ultimoNsu) antes de retornar
	},
});

cliente.fechar();
```

## Arquitetura: padrão Plugin

O núcleo segue o padrão **Plugin** de Martin Fowler (_Patterns of Enterprise Application Architecture_): as interfaces
ficam no núcleo (_Separated Interface_), as implementações são registradas por nome e a escolha acontece **na
configuração, em tempo de execução**, nunca no código.

| Ponto de extensão        | Interface                 | Escolhido por                      | Embutidos                                              |
| ------------------------ | ------------------------- | ---------------------------------- | ------------------------------------------------------ |
| Provedor de chave-mestra | `ProvedorDeChave`         | `NFSE_CHAVE_PROVEDOR`              | `env`, `arquivo`, `dividida`                           |
| Fonte de certificado     | `FonteDeCertificado`      | `origemCertificado` da empresa     | `arquivo` (a extensão do Directus registra `directus`) |
| Repositório das notas    | `RepositorioNfse`         | quem chama `sincronizarEmpresa`    | (a extensão do Directus fornece o seu)                 |
| Relator de divergências  | `RelatorDeDivergencias`   | `NFSE_RELATOR` (com consentimento) | `rele` (relé oficial ou `NFSE_URL_RELE`)               |
| Registro de divergências | `RepositorioDivergencias` | quem chama `sincronizarEmpresa`    | (a extensão do Directus fornece o seu)                 |

```ts
import { carregarPlugins, criarRegistros, listaDaConfig, sincronizarEmpresa } from 'nfse-nacional-core';

const registros = criarRegistros(); // já com as implementações embutidas
await carregarPlugins(listaDaConfig(process.env.NFSE_PLUGINS), registros); // pacotes externos

await sincronizarEmpresa(empresa, {
	repositorio: meuRepositorio, // implementa RepositorioNfse
	fontesDeCertificado: registros.fontesDeCertificado,
	config: process.env,
});
```

### Eventos

`lerEvento(xml)` lê um evento do leiaute nacional (o código vem do nome do grupo, ex.: `e101101`). `TIPOS_EVENTO` traz
os 16 tipos oficiais (Anexo II) e o efeito de cada um na nota; `estadoDaNota(eventos)` devolve `ativa`, `cancelada`,
`substituida` ou `bloqueada`. Em `DocumentoRecebido`, o evento lido vem em `evento` (e a nota, em `nota`).

### Contrato do ADN

`CONTRATO_ADN` lista o que esta versão sabe ler: versões de leiaute, valores de `StatusProcessamento` e `TipoDocumento`,
campos obrigatórios do lote e campos essenciais da nota. A cada sincronização, `verificarResposta`, `verificarItem` e
`verificarNota` geram **divergências** (`tipo`, `detalhe`, `assinatura`) quando o ADN foge disso. O detalhe passa por
`detalheSeguro`, que corta sequências de dígitos: uma divergência nunca carrega dado fiscal. `tratarDivergencias`
registra e, se houver relator, relata uma vez por assinatura; `acompanharIssues` consulta a API pública do GitHub e
informa quando a issue for corrigida.

### Escrevendo um plugin

Um pacote de plugins exporta (como `default` ou `plugin`) um objeto `{ nome, registrar(registros) }`:

```ts
import type { PluginNfse, RegistrosNfse } from 'nfse-nacional-core';

const plugin: PluginNfse<RegistrosNfse> = {
	nome: 'fonte-vault',
	registrar({ fontesDeCertificado }) {
		fontesDeCertificado.registrar('vault', (config) => ({
			obter: async (empresa) => lerDoVault(config.VAULT_ADDR, empresa.cnpj), // { pfx, senha }
		}));
	},
};

export default plugin;
```

Nomes repetidos são recusados e um nome desconhecido gera erro listando os disponíveis. Nos testes, os registros aceitam
dublês (_Service Stub_) no lugar do ADN, do repositório e da fonte.

## Chave-mestra

```bash
npx nfse-nacional-core gerar-chave
```

Gera 32 bytes aleatórios em base64. Para o provedor `dividida`, gere duas: uma em `NFSE_CHAVE_MESTRA` e outra no arquivo
de `NFSE_CHAVE_MESTRA_ARQUIVO`.

## Licença

[MIT](https://github.com/CamilloBorges/nfse-nacional/blob/main/LICENSE)
