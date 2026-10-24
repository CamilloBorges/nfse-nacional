# nfse-nacional-rele

Relé oficial do projeto, em `https://nfse-rele.bomgado.net` (Cloudflare Worker). Recebe das instalações que
**consentiram** o relato de uma mudança do ADN e abre ou atualiza a issue correspondente no GitHub. A credencial do
GitHub fica só aqui; as instalações não precisam de token.

## O que ele faz

- `POST /relatos` aceita só o formato exato do plugin: tipo da divergência (lista fechada), detalhe com caracteres de
  identificador e **sem sequências de 7 ou mais dígitos** (CNPJ, CPF, chave, valores), versões, ambiente e o id
  aleatório da instalação. A assinatura precisa ser a do próprio tipo + detalhe, então ninguém escolhe o título da
  issue.
- Limita a 10 relatos por minuto por instalação e por IP.
- Procura a issue pela assinatura (rótulo `adn-mudanca`):
  - **não existe:** cria;
  - **aberta:** soma uma instalação afetada (cada instalação relata cada mudança uma vez);
  - **fechada:** devolve a versão da correção (milestone `vX.Y.Z`) para a instalação avisar quem usa. Se a instalação já
    estiver nessa versão ou numa mais nova, é **regressão** e a issue é reaberta.
- `GET /` mostra se o relé está configurado.

## Manutenção

1. Criar o GitHub App (permissão só de issues): `node scripts/criar-github-app.mjs <pasta-fora-do-repositório>` e
   instalar no repositório.
2. Cadastrar os segredos e publicar (ver `wrangler.toml`).
3. Ao corrigir uma mudança do ADN, feche a issue com a **milestone da versão** que traz a correção.

Quem quiser hospedar o próprio relé pode publicar este pacote com outro `REPOSITORIO` e configurar `url_rele` nas
instalações.
