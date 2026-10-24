# Como contribuir

Obrigado pelo interesse! Issues com bugs e sugestões são bem-vindas, e PRs também.

## Ambiente

Requisitos: Node 22+, pnpm 10 e Docker (para o teste de ponta a ponta).

```bash
pnpm install
pnpm build
pnpm check            # lint, tipos, testes e conferência dos pacotes
pnpm e2e              # Directus 12 real + ADN simulado, em Docker
pnpm e2e --manter     # deixa o ambiente no ar em http://localhost:18055
```

O código segue o `@directus/eslint-config` e o `.editorconfig` (tabs), como o `directus-labs/extensions`.
`pnpm lint:fix` corrige a formatação.

## Fluxo de trabalho (GitHub Flow)

1. A `main` está sempre pronta para lançar e é protegida: só recebe mudanças por Pull Request, com o workflow **Testes**
   passando.
2. Crie um branch curto a partir da `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
3. Abra o PR cedo (pode ser rascunho). O **título** segue
   [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat: fonte de certificado no Vault`), porque o
   merge é **squash** e o título vira a mensagem do commit na `main`.
4. Mudança visível para quem usa entra no `CHANGELOG.md`, em "[Não lançado]".
5. Depois do merge, o branch é apagado automaticamente.

## Lançamento

```bash
pnpm versao minor          # sobe a versão dos dois pacotes e fecha o "[Não lançado]"
# PR "chore(release): vX.Y.Z" → merge
git switch main && git pull
git tag vX.Y.Z && git push origin vX.Y.Z
```

A tag dispara o workflow **Publicar**: confere a versão, roda os testes, publica os dois pacotes no npm (com provenance)
e cria o Release no GitHub com as notas do CHANGELOG.

## Regras de ouro

- Nunca inclua certificados, senhas, chaves ou XML de notas reais. Os testes geram tudo fictício.
- Implementação nova de um ponto de extensão (fonte de certificado, provedor de chave) é registrada por nome, não por
  `if`/`switch` no núcleo; de preferência como pacote de plugin separado.
