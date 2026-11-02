# Proposal

## Why

Os achievements da plataforma (`src/achievements`) são pouco visíveis e pouco interativos, e há poucos deles: são 13, definidos em código como funções booleanas. Por isso não há progresso visível, tiers nem notificação, e cada achievement novo exige código e um ícone feito à mão. Alguns nem funcionam: os três de seguidores nunca são concedidos, porque nenhum produtor enfileira essa categoria. O objetivo é transformar achievements em um mecanismo de engajamento que traga o usuário de volta com mais frequência. Para isso, o designer precisa conseguir criar achievements e eventos com prazo sem deploy.

## What Changes

- **BREAKING (interno):** as definições saem de `src/achievements/data/*.data.ts` e vão para tabelas. Cada definição combina uma **métrica** registrada em código, **critérios** validados, **tiers** com limiar e XP próprios, um **descritor de ícone** e uma janela de tempo opcional. `checkEligibility`, `AchievementCategory` como gatilho e as constantes de IDs de jogos deixam de existir.
- Catálogo fixo de métricas em código (`reviews_written`, `library_games`, `games_finished`, `followers`, `comments_written`, `awards_participation`, `manual`), com filtros declarados (jogos, temas, gêneros, ano). Métrica nova exige código; achievement novo, não.
- Ciclo editorial `draft -> published -> archived` com API administrativa para `ADMIN` e `EDITOR`: CRUD de definições e eventos, catálogo de métricas e simulação (dry-run) de uma definição para um usuário.
- **Eventos sazonais mínimos:** um agrupamento com nome e janela de tempo. As definições ligadas a um evento contam apenas fatos dentro da janela. O modelo é deliberadamente pequeno para poder ser absorvido por um futuro sistema de eventos.
- Ícones sem arte manual: o descritor é um glifo de biblioteca, a capa do jogo (IGDB) ou um ícone estático já existente (os legados). Upload de imagens novas fica para depois. Moldura e cor por tier ficam a cargo do cliente.
- A avaliação passa a ser por métrica: uma consulta por métrica afetada, progresso persistido por usuário e definição, e concessão idempotente e transacional por tier, com XP. Os jobs passam a ser aguardados, com retry; acaba o fire-and-forget.
- Correção dos gatilhos: seguir alguém passa a avaliar `followers`, e comentários passam a avaliar `comments_written`.
- **Backfill** limitado e retomável ao publicar uma definição ou adicionar um tier. As concessões retroativas são silenciosas.
- Notificação `achievement.unlocked` gravada no outbox na mesma transação da concessão. Uma por definição por avaliação, para o maior tier novo.
- Atividade `ACHIEVEMENT_UNLOCKED` no feed, que pode receber likes e comentários, gerada apenas para concessões ao vivo.
- Raridade por tier (percentual de perfis que o obtiveram) e definições secretas.
- Migração dos 13 achievements e das conquistas já obtidas, sem perda. Os endpoints v1 continuam respondendo no formato atual para os clientes já publicados. Novos endpoints v2 expõem tiers, progresso, eventos, ícones e raridade.
- Ao final: frontend web, mobile e admin no `game-node-clients`, consumindo os contratos novos.
- Fora do escopo: streaks, ligas e rankings, desafios criados por usuários, recompensas além de XP, alteração do sistema de níveis e o sync externo de achievements de jogos (`src/game/game-achievement`).

## Capabilities

### New Capabilities

- `achievement-catalog`: definições de achievements, tiers, métricas e critérios, eventos com janela, descritores de ícone, ciclo editorial e gestão administrativa, além da compatibilidade com o catálogo legado.
- `achievement-progression`: avaliação, progresso por usuário, concessão de tiers e XP, backfill, concessões manuais, destaque no perfil, raridade e atividade de desbloqueio.

### Modified Capabilities

- `notification-delivery`: novo produtor de sistema para desbloqueio de achievement.
- `notification-inbox`: desbloqueios de achievement passam a ser itens individuais, sem agrupamento.

## Impact

- `src/achievements`: entidades, serviços, fila, controllers v1/v2/admin e DTOs. `data/` e `models/` são removidos.
- Produtores: `reviews`, `collections`, `collections-entries`, `awards/vote`, `importer-batch-effects`, `follow` e `comment`.
- `src/level/level.service.ts`: `increaseExp` passa a aceitar o `EntityManager` da transação.
- `src/notifications`: novo tipo de evento, payload, projeção e target. `src/activities`: novo tipo e coluna de origem.
- MySQL: novas tabelas de definições, tiers, eventos e progresso, mais colunas novas em `obtained_achievement` e `activity`. A migração inclui o seed dos achievements atuais.
- OpenAPI (`server_swagger.json`) regenerado. Sem dependência nova.
