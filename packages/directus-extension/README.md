# NFS-e Nacional para Directus

Sincroniza as **NFS-e do Sistema Nacional** (Ambiente de Dados Nacional – ADN) com coleções do Directus. A extensão
consulta o ADN periodicamente com o certificado A1 da empresa, grava cada nota e cada evento em `nfse_documentos` e
deixa tudo disponível pela API REST, pelo GraphQL e pelo **MCP nativo do Directus**, com as permissões de cada usuário.

![Tela de certificados](https://raw.githubusercontent.com/CamilloBorges/nfse-nacional/main/docs/imagens/tela-certificados.png)

![Notas sincronizadas](https://raw.githubusercontent.com/CamilloBorges/nfse-nacional/main/docs/imagens/colecao-documentos.png)

## Recursos

- Cria as coleções `nfse_empresas` e `nfse_documentos` na primeira inicialização.
- Sincroniza por agenda (cron) ou sob demanda, retomando do último NSU; a gravação é idempotente.
- Lê os campos principais da NFS-e (prestador, tomador, valores, competência, código do serviço) e guarda o XML
  original.
- Guarda o certificado A1 **cifrado** (AES-256-GCM em envelope). O campo é mascarado em qualquer leitura, inclusive para
  administradores e pelo MCP.
- Aceita plugins para novas fontes de certificado e provedores de chave (ex.: cofres externos), sem alterar a extensão.

## Requisitos

- Directus **12** e Node 22+.
- Certificado e-CNPJ **A1** (.pfx) da empresa.
- Só aparecem as notas em que o CNPJ (ou outro da mesma raiz) é emitente, tomador ou intermediário.

## Instalação

### Pelo Marketplace

A parte de API desta extensão (agenda e rotas) precisa de conexão com certificado de cliente (mTLS) e de acesso ao
banco. Por isso ela **não pode rodar no sandbox** do Directus, e o Marketplace só permite instalá-la quando o projeto
confia em extensões fora do sandbox:

```bash
MARKETPLACE_TRUST=all
```

Depois, em **Settings → Marketplace**, procure por "NFS-e Nacional" e instale.

### Pelo npm ou pela pasta de extensões

```bash
npm install directus-extension-nfse-nacional
```

Ou copie o pacote (com `dist/` e `package.json`) para `extensions/directus-extension-nfse-nacional`.

### Ativar o módulo

Em **Settings → Settings → Module Bar**, ative **NFS-e Nacional**. O módulo só aparece para administradores.

## Configuração

### Chave-mestra

Gere com `npx nfse-nacional-core gerar-chave` e escolha o provedor em `NFSE_CHAVE_PROVEDOR`:

| Provedor       | Variáveis                        | Proteção                                                     |
| -------------- | -------------------------------- | ------------------------------------------------------------ |
| `env` (padrão) | `NFSE_CHAVE_MESTRA`              | Vazar só o banco não abre os certificados.                   |
| `arquivo`      | `NFSE_CHAVE_MESTRA_ARQUIVO`      | A chave fica fora do ambiente; o arquivo é lido a cada uso.  |
| `dividida`     | as duas acima (gere duas chaves) | É preciso vazar o ambiente **e** o arquivo. **Recomendado.** |

Um pacote de plugins pode registrar outros provedores (veja "Plugins").

### Empresas e certificado

1. Crie um registro em **Nfse Empresas** com o CNPJ (só dígitos), o nome e o ambiente (`producao` ou
   `producao_restrita`).
2. No módulo **NFS-e Nacional**, escolha o `.pfx`, digite a senha e envie. A extensão confere o CNPJ e a validade, cifra
   e guarda; a resposta traz só titular, validade e impressão digital.

Alternativa: `origem_certificado = arquivo`, com o `.pfx` no servidor. Preencha `prefixo_variaveis` (ex.:
`NFSE_EMPRESA1`) e defina `NFSE_EMPRESA1_CERT_PATH` e `NFSE_EMPRESA1_CERT_SENHA_ARQUIVO` (ou
`NFSE_EMPRESA1_CERT_SENHA`).

### Variáveis

| Variável         | Padrão                          |                                                                           |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `NFSE_AGENDA`    | `0 */4 * * *`                   | Expressão cron; `false` desliga a agenda.                                 |
| `NFSE_MAX_LOTES` | `20`                            | Lotes de 50 por execução e empresa.                                       |
| `NFSE_PAUSA_MS`  | `1000`                          | Pausa entre consultas ao ADN.                                             |
| `NFSE_PLUGINS`   |                                 | Pacotes de plugins, separados por vírgula (nome npm ou caminho absoluto). |
| `NFSE_ADN_URL`   |                                 | Substitui o endereço do ADN (proxy ou simulador).                         |
| `NFSE_URL_RELE`  | `https://nfse-rele.bomgado.net` | Relé dos relatos de mudanças do ADN (a tela também permite trocar).       |
| `NFSE_RELATOR`   | `rele`                          | Relator de divergências registrado (plugins podem trazer outros).         |

## Renovação do certificado

Envie o novo `.pfx` pelo módulo; não é preciso reiniciar. A `situacao` da empresa fica `certificado_vencendo` nos
últimos 30 dias e `certificado_vencido` depois (a sincronização é suspensa). Para receber aviso, crie um Flow disparado
na atualização de `nfse_empresas`.

## Notas e eventos

- **Nfse Documentos:** uma linha por NFS-e, com o **estado** calculado pelos eventos (`ativa`, `cancelada`,
  `substituida` ou `bloqueada`) e a lista dos eventos da nota.
- **Nfse Eventos:** cancelamentos, substituições, manifestações e bloqueios (Anexo II do leiaute), ligados à nota pela
  chave de acesso. Um evento que chega antes da nota fica com `nota` vazia e é ligado assim que ela chegar.
- Para conciliar (cartão, contas a pagar), filtre `estado = ativa`: nota cancelada não é serviço prestado.

## Mudanças do ADN

A legislação e o ADN mudam (versão do leiaute, campos, rotas). A extensão confere cada resposta contra o que sabe ler e,
quando algo foge do esperado:

- **continua gravando** as notas (o XML original nunca se perde);
- marca a empresa com `situacao = adn_alterado` e explica a mudança em `ultimo_erro` (um Flow pode avisar por e-mail);
- registra a mudança em **Nfse Divergencias**, com o número de ocorrências.

Em **NFS-e Nacional → Mudanças do ADN**, você pode autorizar o **relato automático** (desligado por padrão). Com ele, a
extensão envia ao projeto só o tipo da mudança, as versões e um id aleatório da instalação. **Nunca** CNPJ, XML, valores
ou nomes. O relé do projeto abre a issue no GitHub ou soma uma ocorrência à que já existe. Quando a issue é fechada, a
tela mostra em que versão foi corrigido, e um aviso aparece sempre que houver versão nova da extensão.

## Plugins

Um pacote de plugins exporta `{ nome, registrar(registros) }` e é carregado pela configuração `NFSE_PLUGINS`. Em
`registrar`, ele adiciona implementações aos pontos de extensão:

```js
export default {
	nome: 'cofre-azure',
	registrar({ provedoresDeChave }) {
		provedoresDeChave.registrar('azure-keyvault', (config) => ({
			tipo: 'azure-keyvault',
			obterChaveMestra: async () => buscarChaveNoCofre(config.AZURE_KEYVAULT_URL),
		}));
	},
};
```

Com `NFSE_PLUGINS=nfse-plugin-cofre-azure` e `NFSE_CHAVE_PROVEDOR=azure-keyvault`, a extensão passa a usar o cofre.
Detalhes em [`packages/core`](https://github.com/CamilloBorges/nfse-nacional/tree/main/packages/core).

## Segurança

- O certificado nunca vai para `directus_files` (que é servido por `/assets` e fica sem criptografia).
- O campo `certificado_cifrado` é `conceal` e o segredo é amarrado ao CNPJ da empresa.
- Envio de certificado e sincronização manual exigem administrador; a troca fica no log de atividades.

## Rotas

| Rota (admin)                                   |                                         |
| ---------------------------------------------- | --------------------------------------- |
| `POST /nfse-nacional/empresas/:id/certificado` | `{ "pfx": "<base64>", "senha": "..." }` |
| `POST /nfse-nacional/empresas/:id/sincronizar` | Sincroniza agora e devolve o resumo.    |

## Licença

[MIT](https://github.com/CamilloBorges/nfse-nacional/blob/main/LICENSE). Projeto independente, sem vínculo com a Receita
Federal ou o Comitê Gestor da NFS-e.
