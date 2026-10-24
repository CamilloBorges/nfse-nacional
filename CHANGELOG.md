# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota o
[Versionamento Semântico](https://semver.org/lang/pt-BR/) (ver "Versionamento" no README). Os dois pacotes
(`nfse-nacional-core` e `directus-extension-nfse-nacional`) são lançados juntos, com a mesma versão.

## [Não lançado]

### Adicionado

- **Detecção de mudanças do ADN:** `CONTRATO_ADN` (versões de leiaute, status, tipos de documento, campos obrigatórios e
  essenciais) conferido a cada sincronização. Mudança detectada não interrompe: a nota é gravada, a empresa fica com
  `situacao = adn_alterado` e a mudança vai para a nova coleção `nfse_divergencias`. Um 404 com corpo inesperado passa a
  indicar rota alterada, e não "nenhum documento".
- **Relato opcional ao projeto** (consentimento na nova configuração `nfse_configuracoes`, desligado por padrão): novos
  pontos de extensão `RelatorDeDivergencias` (relator `rele`) e `RepositorioDivergencias`. O relato leva só tipo,
  detalhe sem dígitos, versões e um id aleatório da instalação; cada mudança é relatada uma vez.
- **Relé** (`packages/rele`, Cloudflare Worker em `nfse-rele.bomgado.net`): valida o relato, limita envios, abre a issue
  ou soma instalações afetadas, devolve a versão da correção e reabre a issue em caso de regressão.
- Acompanhamento das issues relatadas (API pública do GitHub) e aviso de versão nova da extensão na tela.
- Workflow semanal **Vigiar ADN**, que compara a documentação oficial com `docs/adn-referencia.json` e abre uma issue
  quando ela muda.
- Badges de confiabilidade e segurança do SonarQube (com token de badge).

## [0.2.0] - 2026-10-24

### Adicionado

- **Padrão Plugin:** interfaces separadas no núcleo (`ProvedorDeChave`, `FonteDeCertificado`, `RepositorioNfse`),
  registros por nome (`RegistroDePlugins`) e carga de pacotes externos pela configuração `NFSE_PLUGINS`. A orquestração
  (`sincronizarEmpresa`) passou para o núcleo; a extensão do Directus virou um adaptador (repositório e fonte
  "directus").
- Variável `NFSE_ADN_URL` para apontar para um proxy ou simulador.
- Visão padrão da coleção `nfse_documentos` (emissão, número, prestador, valor, papel) e nome da empresa no lugar do id.
- Teste de ponta a ponta com Directus 12.4.1 real e ADN simulado por mTLS (`pnpm e2e`).
- Ambiente de desenvolvimento em `docker-compose.yml`, no padrão do `directus-labs/extensions`.
- README dos pacotes com screenshots e instalação pelo Marketplace.
- SonarQube, workflows de PR e de publicação, e badges.

### Alterado

- Monorepo em **pnpm**, com `@directus/eslint-config` e `.editorconfig` (padrão do `directus-labs/extensions`).
- `criarProvedorDeChave` foi substituído por `criarRegistros()` + `provedorDeChaveConfigurado()`.

## [0.1.0] - 2026-10-24

### Adicionado

- `nfse-nacional-core`: certificado A1 (inclusive cifras legadas), cliente mTLS do ADN, distribuição por NSU, leitura do
  XML da NFS-e nacional e criptografia em envelope do certificado.
- `directus-extension-nfse-nacional`: coleções, sincronização agendada, rotas de envio de certificado e de sincronização
  (só admin) e tela de certificados.

[Não lançado]: https://github.com/CamilloBorges/nfse-nacional/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/CamilloBorges/nfse-nacional/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/CamilloBorges/nfse-nacional/releases/tag/v0.1.0
