# Design

## Context

`ImporterService` obtém jogos do provedor e mapeamentos externos, remove marcadores persistidos de processados/ignorados e deduplica por `gameId`; não há tabela persistida de fila de candidatos. Os serviços de conexão são usados também por rotas públicas e por código interno. `createOrUpdate` já usa transação, bloqueia a linha da biblioteca e oferece `createOnly`; também infere status a partir de coleções e dispara efeitos de atividades, XP e conquistas. Os marcadores de status vivem em tabelas separadas. `PlayerConnectionSync.stages.discovery.lastSucceededAt` registra sucesso da descoberta. Veja a proposta e a spec para o contrato.

## Goals / Non-Goals

**Goals:** Preservar a semântica das APIs existentes, reutilizar as regras de criação e status, limitar consultas por item e garantir atomicidade local mesmo sob concorrência.

**Non-Goals:** Persistir um catálogo de candidatos, alterar o agendamento de descoberta, atualizar clientes ou prometer atomicidade entre MySQL e filas externas.

## Decisions

1. **Filtro opt-in e hidratação em lote.** Acrescentar `isInLibrary` e `excludeInLibrary=false` ao endpoint HTTP; obter IDs presentes por consulta em lote antes de filtrar, buscar e paginar, e hidratar `game.cover` para a página sem mudar a descoberta interna usada pelo watch. Preservar ordenação, busca e convenção HTTP de vazio, inclusive ao aplicar o filtro. Alternativas de marcar automaticamente ou filtrar por padrão alterariam o estado ou a lista de clientes existentes.
2. **Snapshot do provedor antes da transação.** Resolver uma vez os candidatos da fonte e sua plataforma preferida no servidor. Em seleção explícita validar todos os IDs contra a biblioteca do provedor da conexão, não apenas contra a categoria de um jogo externo; resolver também IDs já marcados quando necessário para validar o status em lote idempotente. Deduplicar IDs e candidatos por jogo de forma consistente com a listagem. Revalidar conexão, conta de origem, propriedade das coleções e marcadores sob transação antes de escrever; alterações concorrentes ou IDs que deixaram de ser elegíveis causam rollback. Não manter transação aberta durante acesso ao provedor. O snapshot não pode garantir mudanças posteriores no provedor, portanto sua fronteira é o instante da consulta.
3. **Transação local compartilhada e criação segura.** Usar a infraestrutura transacional existente e a mesma trava pessimista de biblioteca já usada por criação manual e automática; manter a trava até todos os marcadores e associações serem persistidos. Reutilizar ou ajustar o caminho `createOnly` sem modificar suas outras semânticas, validando cada coleção fornecida e garantindo que o status explicitamente escolhido prevaleça sobre o status padrão da coleção para este endpoint. Uma entrada existente é apenas contada e marcada como processada. Marcadores e criação devem participar da mesma transação, e o resultado deve contar jogos distintos. Validar estado da conexão ao adquirir a trava apropriada, respeitando as proteções do player sync existente. Chunking interno de leituras ou inserts é permitido, mas não commits parciais.
4. **Efeitos após commit.** A criação atual agenda atividades/conquistas e XP durante o fluxo de escrita. Adaptar a integração para que uma transação revertida não publique efeitos externos; preservar os efeitos correspondentes às entradas efetivamente criadas após commit. Garantir que falhas de publicação não sejam apresentadas como rollback de dados já confirmados; usar mecanismo recuperável já disponível se necessário, sem fingir atomicidade entre Redis e MySQL. Verificar o comportamento dos efeitos existentes e cobri-lo em testes.
5. **Status em lote aditivo.** `POST /status/batch` recebe `source`, `externalGameIds` e `status`. Os registros são inseridos em lote nas tabelas correspondentes, não atualizados em uma tabela de fila inexistente. Sob a mesma serialização por biblioteca, repetição do mesmo estado é idempotente e estado oposto é rejeitado; a rota antiga mantém sua semântica. Validar `source`, enums, IDs inteiros positivos, propriedade e seleção não vazia antes da escrita.
6. **Resumo apenas nas rotas próprias.** Um enriquecimento específico dos controladores owner usa a mesma definição de candidatos e filtro por biblioteca da listagem, com uma consulta agrupada de IDs por usuário quando viável e chamadas independentes de provedor para cada conexão. Não alterar o `toDto` ou métodos genéricos para disparar consultas recursivas de provedor; falha de um provedor omite apenas sua contagem. Não substituir erro por zero. Usar `stages.discovery.lastSucceededAt` apenas quando o estado corresponde à conta atual. Alternativa de contador persistido exigiria snapshot completo, invalidação para alterações manuais e mais estado durável; não existe fila persistida atualmente.

## Risks / Trade-offs

- [Chamadas de provedor em `connections/own` aumentam latência e consumo de cota] → executar por conexão de forma independente, reutilizar cache/snapshot existente quando válido e medir chamadas; falhas não bloqueiam as conexões. A contagem reflete um snapshot, não atualizações contínuas.
- [Lotes grandes mantêm transação e trava por mais tempo] → resolver rede antes da transação e agrupar leituras/escritas, mantendo a atomicidade até em `importAll`; não truncar silenciosamente.
- [Chamadas concorrentes do endpoint individual de status ou do watch podem mudar marcadores] → coordenar os caminhos de escrita afetados e testar corrida, sem mudar o contrato anterior.
- [Publicação pós-commit pode falhar] → preservar recuperação ou reportar/logar adequadamente, sem alegar que filas externas participaram do rollback.

## Migration Plan

Adicionar contratos como opt-in e implantar backend antes dos clientes. Não há migração de dados prevista; se a implementação precisar de persistência recuperável de efeitos, incluir uma migração não destrutiva e seu rollback. Reverter o backend somente depois de cessar o uso dos novos endpoints/campos; dados de biblioteca e marcadores já confirmados permanecem intactos. Gerar o wrapper no repositório dos clientes depois do deploy, fora desta change.
