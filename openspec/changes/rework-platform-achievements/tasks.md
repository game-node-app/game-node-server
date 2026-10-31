# Tasks

## 1. Modelo de dados e migração

- [x] 1.1 Criar as entidades `AchievementEvent`, `AchievementDefinition`, `AchievementTier` e `AchievementProgress`, e adaptar `ObtainedAchievement` (coluna `tier`, unique `(achievementId, profileUserId, tier)`, FK para a definição) e `Activity` (`obtainedAchievementId` + unique), conforme o design (item 2). Verificar que o servidor sobe sem erro de metadata do TypeORM.
- [x] 1.2 Gerar a migração (`yarn migration:generate`), conferir que ela só cria e altera o previsto, e acrescentar o seed dos 13 achievements legados (design, item 11), `tier = 1` nos obtidos e o cálculo de `obtainedCount`. Verificar com `yarn migration:run` sobre um dump com obtidos, destaques e códigos: nada é perdido, o XP não muda e o `down` restaura o esquema anterior.

## 2. Métricas

- [x] 2.1 Criar o registro de métricas (interface, mapa e classes de critério com class-validator) com `reviews_written`, `library_games`, `games_finished`, `followers`, `comments_written`, `awards_participation` e `manual`, implementando `compute` e `candidates` com suporte a janela onde aplicável. Verificar em spec de integração por métrica: contagem com e sem filtros, fato fora da janela não contado, e `candidates` paginando por `userId`.

## 3. Gestão do catálogo (admin)

- [x] 3.1 Criar o serviço e o controller admin de definições (`ADMIN`/`EDITOR`): CRUD de rascunhos, `publish`, `archive`, validação de tiers (1..10, limiares crescentes, XP de 0 a 5000), critérios pela métrica, descritor de ícone (glifo, jogo existente, ícone em `public/icons`), janela própria exclusiva com evento, e imutabilidade pós-publicação (só é permitido acrescentar tiers). Verificar no spec do serviço cada cenário de `achievement-catalog` sobre definições, ciclo editorial e ícones, além da recusa para usuário comum.
- [x] 3.2 Criar o CRUD admin de eventos com o mesmo ciclo editorial, início imutável e fim apenas extensível após a publicação. Verificar no spec os cenários de eventos.
- [x] 3.3 Expor `GET /achievements/admin/metrics` e `POST /definitions/:id/simulate`. Verificar em spec que a simulação de um rascunho devolve o valor e os tiers atingíveis sem gravar progresso, tiers, XP ou outbox.

## 4. Avaliação e concessão

- [x] 4.1 Adicionar o parâmetro opcional `manager` a `LevelService.increaseExp`. Verificar que `level.service.spec.ts` passa e que os chamadores atuais não mudam.
- [x] 4.2 Implementar `grantTiers` (design, item 5): `INSERT IGNORE` por tier, `obtainedCount` e XP só para as linhas novas, e o modo `manual` recusando quando nada é novo. Verificar em spec de integração: concessão concorrente sem duplicação, salto de vários tiers somando o XP, e tier mantido após a queda da métrica.
- [x] 4.3 Reescrever a fila: job `{ userId, metric }` com deduplicação e delay, processor que aguarda a avaliação, e avaliação agrupada por `(criteria, window)` com upsert de progresso, ignorando rascunhos, arquivadas e definições de evento não publicado. Verificar no spec do processor e do serviço, e confirmar que os specs antigos de `achievements*.spec.ts` foram atualizados ou removidos junto com `data/`, `models/` e as constantes.
- [x] 4.4 Trocar os produtores para métricas: reviews (`reviews_written`), coleções e entradas (`library_games`, `games_finished`), Awards (`awards_participation`), importer (`library_games`, `games_finished`), follow (`followers` do seguido) e comentários (`comments_written`). Verificar com teste que cada produtor enfileira a métrica correta, incluindo o cenário de follow que concede o tier de 10 seguidores.
- [x] 4.5 Implementar o backfill encadeado (publicação e novo tier), em modo silencioso e com concorrência 1. Verificar em spec de integração: concessão retroativa sem outbox nem activity, e um lote reprocessado sem duplicar nada.
- [x] 4.6 Migrar a concessão manual (`POST /grant`) e o resgate de códigos para `grantTiers(mode: "manual")`, no tier 1. Verificar que os specs de controller e de código existentes continuam passando, e que a concessão repetida é recusada sem alterar o XP.

## 5. Notificação e atividade

- [x] 5.1 Adicionar `achievement.unlocked` (tipo, payload, versão, validação), gravar no outbox dentro de `grantTiers` nos modos `live`/`manual` só para o maior tier novo, e projetar o target `achievement` como item individual com o nome da definição como preview. Verificar em `notifications-*.spec.ts` e em integração: atomicidade com a concessão, uma notificação para vários tiers, nenhuma no backfill e dois desbloqueios no mesmo dia como itens separados. Rodar `yarn test:notifications`.
- [x] 5.2 Adicionar `ActivityType.ACHIEVEMENT_UNLOCKED`, enfileirado depois do commit para concessões ao vivo, com a leitura do feed incluindo a origem. Verificar em spec que o desbloqueio gera uma única activity, que aceita like e comentário pelos fluxos existentes, e que o backfill não gera nenhuma.

## 6. Leitura pública e compatibilidade

- [x] 6.1 Reescrever a leitura v1 (catálogo, obtidos, destaque e `PUT` v2 de destaques) sobre as tabelas, com o agrupamento por definição (maior tier e destaque derivado), omitindo secretas não obtidas, rascunhos e arquivadas. Verificar com specs de controller que comparam o formato da resposta com o atual.
- [x] 6.2 Criar os endpoints v2 de catálogo (tiers, ícone, evento, raridade com total de perfis em cache de 1h, secretas mascaradas), de progresso por usuário (valor, maior tier, próximo limiar, 0 sem avaliação) e de eventos. Verificar com specs que cobrem os cenários de catálogo público, de secretas e de progresso.
- [x] 6.3 Regenerar `server_swagger.json` e documentar no README o fluxo do editor (papel `editor`, métricas, ciclo editorial, eventos e backfill). Verificar com `npm run build`, `yarn test` e o servidor subindo sem erro de DI.

## 7. Frontend (`game-node-clients`, depois do backend)

- [ ] 7.1 Regenerar o wrapper do servidor (`@repo/wrapper/server`) a partir do novo `server_swagger.json`. Verificar com o typecheck dos pacotes.
- [ ] 7.2 Criar o componente de insígnia procedural (moldura e cor por tier, glifo, capa de jogo ou ícone legado) e usá-lo em `AchievementItem`/`AchievementLogo`. Verificar visualmente com tiers e tipos de ícone distintos.
- [ ] 7.3 Refazer as telas de achievements (web e mobile) com o v2: progresso com barra e próximo limiar, tiers, raridade, secretas, seção de eventos ativos e passados, e uma única consulta de progresso no lugar das N consultas atuais. Verificar nas páginas `achievements/[targetUserId]` e `feats`.
- [ ] 7.4 Renderizar a notificação `achievement.unlocked` na inbox e a activity `ACHIEVEMENT_UNLOCKED` no feed (web e mobile). Verificar com um desbloqueio real em ambiente local.
- [ ] 7.5 Criar no `apps/admin` as telas de definições (formulário guiado pelo catálogo de métricas, tiers, ícone, simulação, publicar e arquivar) e de eventos, acessíveis a `editor`. Verificar o fluxo completo de um evento criado e publicado pelo designer.

## 8. Integração

- [ ] 8.1 Verificar ponta a ponta em ambiente local: um editor cria um evento com uma definição de 3 tiers e publica; outro usuário cria reviews dentro da janela e recebe tiers, XP, notificação e activity; uma review fora da janela não conta; depois do fim do evento, a definição aparece como passada e os tiers obtidos continuam no perfil.

## Workflow follow-up

- Arquivar a change após a revisão (`/opsx:archive`).
