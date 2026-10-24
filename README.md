# nfse-nacional

Busca automática das **NFS-e do Sistema Nacional** (Ambiente de Dados Nacional – ADN) para dentro do [Directus](https://directus.io).

O ERP costuma baixar as NF-e de produtos, mas as notas de **serviço** ficam de fora. Este projeto consulta periodicamente a API de distribuição do ADN com o certificado A1 da empresa e grava cada NFS-e (e seus eventos) numa coleção do Directus. A partir daí, as notas ficam disponíveis pela API REST, GraphQL e pelo **MCP nativo do Directus**, com as permissões de cada usuário.

> Projeto independente, sem vínculo com a Receita Federal ou o Comitê Gestor da NFS-e.

## Pacotes

| Pacote | Para quê |
|---|---|
| [`nfse-nacional-core`](packages/core) | Biblioteca Node independente: abre o certificado A1, conecta no ADN por mTLS, pagina por NSU, descompacta e lê o XML, cifra o certificado em repouso. Serve para CLI, Airflow, outros sistemas. |
| [`directus-extension-nfse-nacional`](packages/directus-extension) | Extensão (bundle) para **Directus 12**: cria as coleções, agenda a sincronização e traz a tela para enviar o certificado. |

## Como funciona

1. O ADN mantém, para cada CNPJ, uma fila de documentos numerada por **NSU**. `GET /contribuintes/DFe/{NSU}?lote=true` devolve até 50 documentos posteriores ao NSU informado.
2. A cada execução (padrão: a cada 4 horas) o plugin pede os documentos a partir do último NSU gravado, grava cada lote e só então avança o cursor. Se algo falhar, a próxima execução pede o mesmo lote de novo; a gravação é idempotente.
3. Cada NFS-e vira um registro em `nfse_documentos`, com os campos principais (emitente, tomador, valores, competência, código do serviço) e o XML original.

### O que o ADN entrega (e o que não entrega)

- Só aparecem as notas em que o seu CNPJ (ou outro com a **mesma raiz**) é **emitente, tomador ou intermediário**. Nota emitida para o CPF de quem pagou, ou sem tomador, **não aparece**: oriente seus fornecedores a emitir no CNPJ.
- Cobre os municípios que usam o emissor nacional ou compartilham dados com o ADN (obrigatório desde janeiro de 2026) e todos os MEI.
- Documentação oficial: [Manual dos Contribuintes – APIs do ADN](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf).

## Instalação no Directus

Requer **Directus 12** e Node 22+.

```bash
npm install directus-extension-nfse-nacional
```

Ou copie a pasta `packages/directus-extension` (com `dist/` e `package.json`) para `extensions/directus-extension-nfse-nacional` do seu Directus.

> **Marketplace:** a extensão precisa de acesso à rede com certificado de cliente e ao sistema de arquivos, então **não roda no sandbox**. Por isso o marketplace (com `MARKETPLACE_TRUST=sandbox`, o padrão) não a lista. Instale pelo npm ou pela pasta.

Ao iniciar, a extensão cria as coleções `nfse_empresas` e `nfse_documentos` (se não existirem) e o módulo **NFS-e Nacional** na barra lateral, visível só para administradores.

## Configuração

### 1. Chave-mestra

O certificado e a senha são guardados **cifrados** (AES-256-GCM, criptografia em envelope). A chave-mestra **nunca** fica no banco. Gere com:

```bash
npx nfse-nacional-core gerar-chave
```

Escolha onde ela fica com `NFSE_CHAVE_PROVEDOR`:

| Provedor | Variáveis | Proteção |
|---|---|---|
| `env` (padrão) | `NFSE_CHAVE_MESTRA` | Vazar só o banco (ou um backup) não abre os certificados. |
| `arquivo` | `NFSE_CHAVE_MESTRA_ARQUIVO` (caminho; ex.: secret do Docker) | A chave fica fora do `.env`; o arquivo é lido a cada uso. |
| `dividida` | `NFSE_CHAVE_MESTRA` **e** `NFSE_CHAVE_MESTRA_ARQUIVO` (gere duas chaves) | É preciso vazar o ambiente **e** o arquivo para abrir. **Recomendado.** |

> Perder a chave-mestra não perde notas: basta definir uma nova e reenviar os certificados.

### 2. Empresas

Crie um registro em `nfse_empresas` com o **CNPJ** (só dígitos), o nome e o ambiente (`producao` ou `producao_restrita` para testes).

### 3. Certificado

Duas formas, escolhidas por empresa no campo `origem_certificado`:

- **`directus` (padrão):** abra o módulo **NFS-e Nacional**, escolha o `.pfx`, digite a senha e envie. O plugin abre o certificado, confere se o CNPJ tem a mesma raiz da empresa e se está válido, cifra e guarda. A resposta traz só titular, validade e impressão digital.
- **`arquivo`:** o certificado fica no servidor. Preencha `prefixo_variaveis` (ex.: `NFSE_EMPRESA1`) e defina:
  - `NFSE_EMPRESA1_CERT_PATH`: caminho do `.pfx`;
  - `NFSE_EMPRESA1_CERT_SENHA_ARQUIVO`: caminho de um arquivo com a senha (preferível), **ou** `NFSE_EMPRESA1_CERT_SENHA`.

### 4. Agenda e limites

| Variável | Padrão | |
|---|---|---|
| `NFSE_AGENDA` | `0 */4 * * *` | Expressão cron. `false` desliga a agenda (só manual). |
| `NFSE_MAX_LOTES` | `20` | Lotes de 50 por execução e empresa; o restante continua na próxima. |
| `NFSE_PAUSA_MS` | `1000` | Pausa entre consultas ao ADN. |

## Renovação anual do certificado

Envie o novo `.pfx` pela tela (ou troque o arquivo no servidor). O certificado é lido a cada execução, então **não é preciso reiniciar** o Directus. Como a busca segue pelo NSU, nada se perde no intervalo.

O campo `situacao` da empresa fica `certificado_vencendo` nos últimos 30 dias e `certificado_vencido` depois do vencimento (a sincronização é suspensa). Para receber aviso, crie um **Flow** no Directus disparado na atualização de `nfse_empresas` quando `situacao` mudar.

## Segurança

- **Certificado nunca vai para `directus_files`**: lá os arquivos são servidos por `/assets` e ficam sem criptografia no armazenamento.
- O campo `certificado_cifrado` é `conceal`: o Directus devolve `**********` em qualquer leitura, **inclusive para administradores, pela API e pelo MCP**. Só o plugin lê, direto no banco.
- O segredo é amarrado ao CNPJ da empresa (dado autenticado do AES-GCM): copiado para outro registro, não decifra.
- Envio de certificado e sincronização manual exigem **administrador**; a troca fica no log de atividades (quem, quando, impressão digital).
- Limite conhecido: quem tem ao mesmo tempo acesso de administrador ao servidor, às variáveis e ao banco consegue extrair o certificado. Isso vale para qualquer solução que use o certificado sem intervenção humana.

## Acesso às notas

Use os recursos padrão do Directus. Por exemplo, um usuário de serviço com política **só de leitura** em `nfse_documentos` e `nfse_empresas` (sem o campo `certificado_cifrado`):

- REST: `GET /items/nfse_documentos?filter[papel][_eq]=tomador&sort=-emissao`
- GraphQL: `/graphql`
- MCP: ative em *Settings → AI → Model Context Protocol*; o assistente vê só o que o usuário conectado pode ver.

## Rotas da extensão

Todas exigem administrador.

| Rota | |
|---|---|
| `POST /nfse-nacional/empresas/:id/certificado` | Corpo `{ "pfx": "<base64>", "senha": "..." }`. Valida, cifra e guarda. |
| `POST /nfse-nacional/empresas/:id/sincronizar` | Sincroniza agora e devolve o resumo. |

## Desenvolvimento

```bash
npm install
npm run build -w nfse-nacional-core
npm test                 # testes do núcleo (inclui um servidor mTLS local que simula o ADN)
npm run build            # núcleo + extensão
```

Os testes geram certificados e notas **fictícios**. Nunca adicione certificados ou XML reais ao repositório.

### Próximos passos

- Comando para trocar a chave-mestra recifrando os certificados (`recifrar` já existe no núcleo).
- Provedores de chave em cofre externo (Azure Key Vault, OpenBao/Vault).
- Marcar a NFS-e como cancelada a partir dos eventos.

## Licença

[MIT](LICENSE)
