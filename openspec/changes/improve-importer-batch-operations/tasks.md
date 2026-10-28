# Tasks

## 1. Listagem e resolução de candidatos

- [ ] 1.1 Acrescentar validação e documentação OpenAPI de `excludeInLibrary` e `isInLibrary`, preservando a resposta padrão; verificar nos testes do controlador que o parâmetro omitido ou `false` mantém listagem e tratamento de vazio.
- [ ] 1.2 Consultar presença na biblioteca em lote, filtrar antes de busca e paginação e carregar jogo/capa por página sem alterar o watch; testar busca, totais, página composta de jogos existentes, usuários diferentes, capa ausente e número de consultas sem N+1.
- [ ] 1.3 Resolver candidatos da conta e suas plataformas a partir de um snapshot do provedor, incluindo uma forma de validar IDs já marcados para repetição de status; testar fontes distintas, candidatos duplicados e rejeição de ID de outro usuário ou fonte.

## 2. Importação transacional

- [ ] 2.1 Criar DTOs, rota e documentação OpenAPI para seleção explícita ou `importAll`, status e coleções; testar seleção ambígua, IDs inválidos, enum inválido, padrão e associação de coleções de terceiros.
- [ ] 2.2 Reutilizar a trava de biblioteca e o caminho de criação segura para importar jogos distintos, aplicar status escolhido e plataforma preferida e persistir todos os marcadores na mesma transação; testar entradas existentes, dados preservados, duplicatas, `importAll` e contagens.
- [ ] 2.3 Revalidar identidade da conexão, propriedade das coleções e estados sob transação e coordenar escritores de status e criação existentes; verificar em testes de integração rollback após falha intermediária e concorrência com criação manual e mudanças de status, sem duplicação ou sobrescrita.
- [ ] 2.4 Garantir que atividades, XP e conquistas de entradas novas respeitem o commit e que falhas de publicação não aleguem rollback de dados confirmados; testar rollback sem efeitos externos e sucesso/publicação recuperável conforme mecanismo disponível.

## 3. Atualização de status em lote

- [ ] 3.1 Implementar `POST /v1/importer/status/batch` com fonte, lista e status validados, inserção agrupada e serialização compatível com o importador; testar sucesso, repetição idempotente, estado oposto, IDs inválidos e rollback completo.
- [ ] 3.2 Preservar o contrato de `POST /v1/importer/status` e o comportamento do watch; executar testes de regressão existentes e adicionar verificação de concorrência entre os caminhos individual, em lote e automático.

## 4. Resumo das conexões

- [ ] 4.1 Enriquecer apenas as duas rotas próprias com `unprocessedCount` baseado nos mesmos candidatos filtrados e com `lastSyncedAt` de descoberta da conta atual; testar equivalência com o total da listagem, zero, conta substituída e data ausente.
- [ ] 4.2 Isolar falhas de cada provedor, omitir contagem desconhecida e manter rotas públicas e chamadas internas sem descoberta adicional; testar erro parcial, privacidade e ausência de recursão ou chamadas por jogo.

## 5. Integração

- [ ] 5.1 Executar testes relevantes de importador, conexão e coleções, incluindo integração transacional, e validar geração OpenAPI dos novos contratos e compatibilidade dos contratos existentes.
- [ ] 5.2 Medir e registrar consultas locais e chamadas aos provedores para listagem, resumo e lote representativo; verificar que não há N+1 por jogo e documentar a latência/custo do resumo por conexão.
