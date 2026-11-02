# Design

## Context

Hoje, `AchievementsService` lê `achievementsData` (array em memória) e valida a lista no construtor. Os produtores chamam `AchievementsQueueService.addTrackingJob({ targetUserId, category })`. O processor chama `trackAchievementsProgress` sem `await`, que roda `checkEligibility(dataSource, userId)` em paralelo e, quando ela retorna `true`, insere `ObtainedAchievement` (único por `achievementId + profile`) e chama `LevelService.increaseExp` fora de transação. Os produtores são `reviews.service`, `collections.service`, `collections-entries.service`, `awards-vote.service` e `importer-batch-effects.service`; `follow` e `comment` não disparam nada.

Também já existem:
- Outbox de notificações transacional (`NotificationsOutboxService`), com tipos versionados em `notifications.types.ts`. O follow já grava a intenção dentro da transação da ação.
- `Activity` com uma FK por tipo de origem e unique por `(profile, origem)`, criada pela fila de activities.
- O papel `EUserRoles.EDITOR`, hoje usado no blog. O designer recebe esse papel.
- Ícones legados servidos em `/v1/public/icons/<id>.png`, a partir de `public/icons`.

## Goals / Non-Goals

**Goals:** um único caminho de concessão (avaliação ao vivo, backfill e concessão manual) que seja idempotente e transacional. Definições editáveis por editores sem que isso exija código novo. Um modelo de evento pequeno o bastante para ser absorvido depois por um sistema sazonal.

**Non-Goals:** cache distribuído das definições (a tabela é pequena e é lida por job), upload de imagens novas de ícone, recálculo de XP histórico, mudanças no algoritmo de níveis e expressões de critério arbitrárias (sem DSL, sem SQL vindo do editor).

## Decisions

1. **Métricas em código, definições em tabela.** Cada métrica é um objeto registrado num mapa `key -> AchievementMetric` com: `key`, `description`, classe de critérios (class-validator, listas com `ArrayMaxSize(50)`), `supportsWindow`, `compute(manager, userId, criteria, window): Promise<number>` e `candidates(manager, criteria, window, afterUserId, limit): Promise<string[]>`. Ficam assim:

   | métrica | conta | filtros | janela por |
   |---|---|---|---|
   | `reviews_written` | reviews do usuário | `gameIds`, `themeIds`, `genreIds` | `review.createdAt` |
   | `library_games` | jogos distintos na biblioteca | `gameIds`, `themeIds`, `genreIds` | `collection_entry.createdAt` |
   | `games_finished` | entradas com `finishedAt` | `gameIds`, `themeIds`, `genreIds` | `finishedAt` |
   | `followers` | seguidores | nenhum | `user_follow.createdAt` |
   | `comments_written` | comentários do usuário (todas as tabelas de comentário) | nenhum | `createdAt` |
   | `awards_participation` | 1 se votou no ano | `year` (obrigatório) | sem janela |
   | `manual` | não é avaliada; `candidates` retorna vazio | nenhum | sem janela |

   *Alternativa:* critérios como SQL ou uma DSL na tabela. Foi rejeitada porque expõe o banco a quem edita e é difícil de validar. Com métricas fixas, o editor combina blocos seguros, e métrica nova é uma PR pequena.

2. **Modelo de dados.**
   - `achievement_event`: `id` (uuid), `slug` único, `name`, `description`, `startsAt`, `endsAt`, `status`, timestamps.
   - `achievement_definition`: `id varchar(36)` PK, que é o slug, compatível com o `achievementId` atual. Também `name`, `description`, `category` (o enum inteiro atual, mantido para agrupar e para o v1), `metric`, `criteria json`, `startsAt`/`endsAt` nulos, `eventId` nulo (FK), `icon json`, `isHidden`, `status` (`draft|published|archived`), `publishedAt` e timestamps.
   - `achievement_tier`: `id`, `definitionId` (FK), `level` (1..10), `threshold`, `expReward`, `obtainedCount`, com `UNIQUE(definitionId, level)`.
   - `achievement_progress`: PK `(profileUserId, definitionId)`, `value`, `updatedAt`.
   - `obtained_achievement`: ganha `tier int not null default 1`. O unique passa de `(achievementId, profile)` para `(achievementId, profileUserId, tier)`, e entra uma FK de `achievementId` para a definição.
   - `activity`: ganha `obtainedAchievementId` (FK nula, `ON DELETE CASCADE`), com unique `(profile, obtainedAchievement)`, como os outros tipos.
   - `achievement_code`: sem mudança; o resgate concede o tier 1.

   O ícone fica em `icon json`, como `{ kind: "glyph", name }`, `{ kind: "game_cover", gameId }` ou `{ kind: "image", name }`. No caso `image`, o nome precisa existir em `public/icons`.

3. **A janela efetiva é resolvida na leitura.** `window = event ? [event.startsAt, event.endsAt] : [def.startsAt, def.endsAt] | null`. A avaliação não depende de `now()`, e sim da data de cada fato, de modo que um job atrasado ou um backfill depois do fim do evento continua correto. Estender o fim do evento passa a valer na próxima avaliação.

4. **Avaliação por `(usuário, métrica)`.** O job é `{ userId, metric }`, com deduplicação BullMQ (`deduplication.id = ach:<userId>:<metric>`) e `delay` de cerca de 2s, para juntar rajadas como importação ou vários follows. O processor **aguarda** a avaliação e usa o retry padrão da fila. A avaliação:
   1. carrega as definições `published` da métrica cujo evento, se houver, também está `published`;
   2. agrupa por `(criteria, window)` e chama `compute` uma vez por grupo;
   3. para cada definição, faz upsert de `achievement_progress` e chama `grantTiers` para os tiers com `threshold <= value`.

5. **`grantTiers(manager, userId, def, levels, mode)` é o único caminho de concessão**, com `mode` em `live | backfill | manual`. Numa transação, para cada tier faz `INSERT IGNORE` em `obtained_achievement` e verifica `affectedRows` para saber se a linha é nova. Só para as linhas novas, incrementa `achievement_tier.obtainedCount` e soma o XP. Depois chama `LevelService.increaseExp(userId, total, manager)`; a assinatura ganha o `manager` opcional, e os chamadores atuais não mudam. Em `live`/`manual`, ainda dentro da transação, grava no outbox `achievement.unlocked` para o maior tier novo. Depois do commit, enfileira a activity desse tier. A activity fora da transação segue o padrão dos outros produtores; uma perda eventual afeta só o feed. Em `manual`, se nenhuma linha for nova, responde 400 ("já possui"), como hoje.
   *Alternativa:* um lock por usuário. Foi rejeitada porque o unique com `INSERT IGNORE` já garante a idempotência sem coordenação.

6. **O destaque é derivado na leitura.** Continua em `obtained_achievement.isFeatured`. Destacar e desmarcar atualiza todas as linhas da definição do usuário. A leitura agrupa por `achievementId` com `MAX(tier)` e `MAX(isFeatured)`, então um tier novo herda o destaque sem lógica no momento da concessão. O v1 usa o mesmo agrupamento para devolver um item por definição.

7. **Backfill encadeado e retomável.** Publicar uma definição ou acrescentar um tier enfileira `{ definitionId, afterUserId: null }` com `jobId` determinístico. O processor chama `candidates(..., afterUserId, 500)` em ordem de `userId` e roda `compute + grantTiers(mode: "backfill")` para cada usuário. Ao fim do lote, enfileira o próximo `{ afterUserId: último }`. Um reinício retoma o job pendente no BullMQ, e reprocessar um lote é inofensivo graças ao item 5. A concorrência dessa fila é 1, para não disputar as linhas de `obtainedCount`.

8. **Raridade.** `obtainedCount / totalProfiles`. O total vem de `COUNT(profile)` guardado no cache manager com TTL de 1h. A migração calcula `obtainedCount` dos dados legados.

9. **Notificação.** Novo `NotificationEventType` `"achievement.unlocked"`, v1, com payload `{ obtainedAchievementId: number, achievementId: string, tier: number }`, `actorUserId: null` e o destinatário igual ao usuário. O projector adiciona o target `{ type: "achievement", id: achievementId, tier }` e usa o nome da definição como preview. O item é individual, sem agrupamento.

10. **APIs.**
    - **v1 (compatível):** `GET /achievements` (catálogo no formato antigo, `expGainAmount` = XP do tier 1), endpoints de obtidos e destaque com o agrupamento do item 6, `POST /achievements/grant` (MOD/ADMIN, tier 1) e códigos.
    - **v2:** `GET /v2/achievements` (catálogo com tiers, ícone, evento e raridade; o `targetUserId` opcional revela as secretas obtidas por ele), `GET /v2/achievements/progress/:userId` e `GET /v2/achievements/events` (eventos publicados, separados em ativos, futuros e passados). O `PUT` de destaques v2 continua.
    - **Admin** (`AuthGuard` + `@Roles([ADMIN, EDITOR])`): `GET /achievements/admin/metrics`; CRUD de `definitions` e `events`; `POST .../:id/publish`, `POST .../:id/archive` e `POST /definitions/:id/simulate { userId }`. As regras de imutabilidade do spec são aplicadas no serviço, comparando com o estado salvo.

11. **Migração dos legados.** Os seeds ficam numa migração TypeORM:

    | slug | métrica | critérios | tier 1 |
    |---|---|---|---|
    | `space-station` | `library_games` | — | 100 |
    | `boo` | `library_games` | `themeIds: [19]` | 5 |
    | `a-survivor-is-born` | `library_games` | `gameIds: [1164]` | 1 |
    | `spooky` | `reviews_written` | `themeIds: [19]` | 1 |
    | `delivery-system` | `reviews_written` | `gameIds: [19564, 152063, 228530]` | 1 |
    | `take-off` / `crew` / `you-are-fireworks` | `followers` | — | 10 / 50 / 100 |
    | `awards_2025` | `awards_participation` | `year: 2025` | 1 |
    | `test-lab`, `dna`, `spaceman`, `area-42` | `manual` | — | 1 |

    Nome, descrição, categoria e XP são os atuais, e o ícone é `{ kind: "image", name: <slug> }`. Os três de seguidores continuam separados para preservar slugs, ícones e destaques. Depois, o editor pode criar uma definição em tiers nova.

## Risks / Trade-offs

- [`boo` muda de semântica: antes eram 5 jogos de terror numa mesma coleção, agora são 5 na biblioteca] → quem já tem o achievement não é afetado; a mudança fica registrada na descrição da migração.
- [`library_games` com janela conta jogos importados durante o evento, o que permite farmar com importação] → a descrição da métrica no catálogo avisa o editor, e eventos devem preferir `games_finished` ou `reviews_written`.
- [Backfill de uma definição ampla, como "1 jogo na biblioteca", percorre quase todos os usuários] → os lotes são limitados com concorrência 1; o trabalho é lento, mas não trava a fila ao vivo, que é separada.
- [Os seguidores de alguém popular disparam uma avaliação por follow] → a deduplicação com delay junta as rajadas num único job.
- [Um editor pode configurar XP excessivo] → o limite é de 5000 por tier, validado no DTO.
- [A activity é enfileirada depois do commit e pode se perder num crash] → mesmo trade-off dos produtores atuais; a conquista e a notificação já estão confirmadas.
- [Clientes antigos não veem tiers] → o v1 mostra o maior tier como item único, sem quebrar.

## Migration Plan

1. Uma migração cria as tabelas e colunas, insere eventos (nenhum), definições e tiers legados, faz `UPDATE obtained_achievement SET tier = 1`, troca o unique, cria a FK e calcula `obtainedCount`. Não concede XP nem cria notificações ou atividades.
2. Deploy do código, que passa a ler só das tabelas. `data/`, `models/` e as constantes de IDs são removidos.
3. Rollback: o `down` remove a FK, o unique novo, as colunas e as tabelas, depois de **apagar as linhas com `tier > 1`**, que são perdidas. Depois disso, o código anterior volta a funcionar com os dados legados.

## Open Questions

- Conjunto de glifos: é uma escolha do frontend (provavelmente Tabler). O servidor valida só o formato do nome, então decidir isso depois não muda o backend.
