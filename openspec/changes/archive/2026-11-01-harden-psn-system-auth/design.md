# Design

## Context

`PsnSyncAuthService` (`src/sync/psn/auth`) é o único dono da credencial PSN global. Ele lê `PSN_NPSSO_KEY` uma única vez no construtor e guarda `PSNTokenInfo` no Redis (cache global `CACHE_MANAGER`, sem TTL padrão) na chave `psn-auth-access-token-<NPSSO>`, com TTL igual à validade do refresh token. Todos os métodos de `PsnSyncService` chamam `getValidAccessToken()`.

`exchangeRefreshTokenForAuthTokens` do `psn-api` não lança erro quando a Sony rejeita o refresh: ele devolve os campos `undefined`, e `setToStore` estoura `RangeError: Invalid time value`. Assim, a entrada antiga continua no cache e todas as chamadas seguintes repetem o mesmo refresh morto. O campo `error` da Sony é descartado pelo `psn-api`. Já `exchangeNpssoForCode` lança um `Error` próprio quando o NPSSO é inválido.

`ScheduleModule` já está registrado, e `StatisticsRankingScheduler` é o padrão de cron com flag `running`. Rotas de admin usam `AuthGuard` + `@Roles([EUserRoles.ADMIN])` (ex.: `AwardsAdminController`).

## Goals / Non-Goals

**Goals:** Corrigir a falha na raiz, dentro do serviço de autenticação, sem alterar o contrato de `getValidAccessToken()` com os chamadores. Alertar via log, que é o canal que já existe.

**Non-Goals:** Integração com canais externos de alerta, outcome novo na classificação de falhas de sync (`providerFailure`), lock distribuído do refresh, frontend.

## Decisions

1. **Validar o retorno do refresh e cair para o NPSSO uma vez.** Depois do refresh, se `accessToken` vier vazio, lançar um erro descritivo. Em qualquer falha do refresh, apagar a chave do cache e chamar o caminho do NPSSO. Se ele também falhar, lançar `Error` com a mensagem prefixada pelo marcador `PSN_SYSTEM_AUTH_FAILED` e com a causa. O caminho do NPSSO lê a credencial do banco (decisão 3). Não cria classe de erro nova: o erro sem `status` continua classificado como `failed` por `providerFailure`, como hoje. *Alternativa:* chamar o endpoint de token da Sony direto para ler `error`. Foi rejeitada porque duplica o `psn-api` só para melhorar a mensagem.
2. **`setToStore` passa a ser aguardado.** Hoje o `set` é fire-and-forget. A rotação e o fallback precisam da garantia de que o token foi gravado antes de responder.
3. **NPSSO no MySQL, criptografado com a chave das conexões.** Nova entidade `PsnSystemCredential`, tabela de uma linha (`id` fixo `1`, `npssoEncrypted text`, `updatedAt`), criada por migração. Cifrada com `ConnectionCredentialCryptoService` (AES-256-GCM, `CONNECTION_CREDENTIAL_ENCRYPTION_KEY`). O serviço é registrado direto nos providers do `PsnSyncModule`, porque `ConnectionsModule` já importa `PsnSyncModule` e importar de volta criaria ciclo. Como ele não guarda estado além da chave lida do env, e essa chave já é obrigatória no boot por causa do `ConnectionsModule`, isso não cria requisito novo. Resolução: linha do banco, se existir; senão, `PSN_NPSSO_KEY`. *Alternativa:* Redis sem TTL. Foi rejeitada porque o NPSSO some num flush ou eviction, enquanto o banco sobrevive e fica cifrado em repouso.
4. **Chave do token fixa e NPSSO lido só quando necessário.** A chave do cache passa de `psn-auth-access-token-<NPSSO>` para `psn-auth-access-token`. Com isso o caminho normal (token válido ou refresh) não consulta o banco, que só é lido no fallback para o NPSSO e na verificação de presença do cron. O NPSSO também deixa de aparecer em claro no nome da chave no Redis. A rotação sobrescreve essa chave depois de validar o NPSSO. Consequência: no primeiro deploy, a entrada antiga fica órfã até o TTL e o sistema faz uma troca de NPSSO a mais. *Alternativa:* manter a chave derivada do NPSSO, o que exigiria ler e decifrar o banco em toda chamada PSN.
5. **Verificação agendada horária.** `PsnSyncAuthScheduler` com `@Cron("0 * * * *", { timeZone: "UTC" })` e flag `running`. Ele chama `getValidAccessToken()`; se não houver NPSSO, retorna sem logar (o construtor já avisa). Em falha, registra `logger.error` com o marcador. Em sucesso, se `refreshTokenExpiresAt` estiver a menos de 7 dias, registra `logger.warn` com a data. A cadência horária acompanha a validade aproximada do access token, detecta em até 1h e custa no máximo um refresh por hora por instância. Com várias instâncias rodando o cron ao mesmo tempo, cada uma pode renovar o token, o que já acontece hoje com o tráfego de usuários.
6. **Endpoint `PUT /v1/psn/admin/npsso`.** Um controlador no `PsnSyncModule`, com DTO `{ npsso: string }` (`IsString`, `IsNotEmpty`). O serviço troca o NPSSO por tokens; se falhar, responde `BadRequestException` sem mudar nada. Se der certo, faz upsert do NPSSO cifrado, depois sobrescreve o token no cache, e responde `{ refreshTokenExpiresAt }`. O NPSSO nunca vai para log nem para a resposta. A ordem validar → gravar NPSSO → gravar token garante que nada não validado é persistido. Se a gravação no cache falhar depois do upsert, o próximo fallback usa o NPSSO novo de qualquer forma.

## Risks / Trade-offs

- [Sem canal de alerta externo, o log ainda depende de alguém olhar] → o marcador estável permite plugar um alerta no agregador de logs, ou depois um webhook, sem mudar o fluxo.
- [Com uma linha no banco, editar `PSN_NPSSO_KEY` no env não tem efeito] → documentar no README que, depois da primeira rotação, a troca é pelo endpoint. O env vale só como valor inicial.
- [Rotacionar `CONNECTION_CREDENTIAL_ENCRYPTION_KEY` impede decifrar o NPSSO] → a falha cai no marcador de erro do cron. Repetir o `PUT` regrava com a chave nova, como já acontece com as credenciais de conexão.
- [A Sony pode não estender a validade do refresh token] → o aviso de 7 dias cobre esse caso; a validade aparece no log de cada gravação e na resposta do endpoint.

## Migration Plan

Rodar a migração que cria a tabela, que é aditiva e começa vazia. Depois do deploy, o NPSSO do env continua sendo usado até o primeiro `PUT`. Rollback: reverter o código e rodar o `down` da migração, que remove a tabela. O env volta a ser a única fonte, e o código antigo recria o token na chave derivada do NPSSO.
