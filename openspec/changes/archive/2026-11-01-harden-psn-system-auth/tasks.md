# Tasks

## 1. Recuperação do refresh (A)

- [x] 1.1 Aguardar `setToStore`, validar `accessToken` no retorno do refresh e, em falha, apagar a chave do cache e tentar o NPSSO uma vez, lançando erro com o marcador `PSN_SYSTEM_AUTH_FAILED` se ele também falhar; verificar em `psn-sync-auth.service.spec.ts` (novo, `psn-api` mockado) os casos: refresh ok, refresh rejeitado com NPSSO válido, ambos inválidos (cache vazio depois) e primeiro acesso sem cache.

## 2. NPSSO em runtime e rotação administrativa (D)

- [x] 2.1 Criar a entidade `PsnSystemCredential` e sua migração (`yarn migration:generate`, conferindo que só cria a tabela); verificar com `yarn migration:run` e o `down` em banco local.
- [x] 2.2 Registrar `ConnectionCredentialCryptoService` e o repositório no `PsnSyncModule`; trocar a chave do token por `psn-auth-access-token` e resolver o NPSSO (banco cifrado, fallback env) só no caminho de troca por NPSSO; verificar no spec do serviço: banco prevalece sobre env, env sem linha, e o caminho com token válido não consulta o banco.
- [x] 2.3 Adicionar `rotateNpsso(npsso)` ao serviço (validar → upsert cifrado → gravar token; erro da Sony vira `BadRequestException` sem alterar estado); verificar no spec do serviço o sucesso (valor persistido é cifrado e decifra para o NPSSO), a rejeição sem mudança de estado e que nada contém o NPSSO em logs/retorno.
- [x] 2.4 Criar o controlador `PUT /v1/psn/admin/npsso` (`AuthGuard` + `@Roles([EUserRoles.ADMIN])`, DTO validado, resposta `{ refreshTokenExpiresAt }`), registrá-lo no `PsnSyncModule` e regenerar `server_swagger.json`; verificar com teste de controlador e com o servidor subindo sem erro de DI.

## 3. Verificação agendada (B)

- [x] 3.1 Criar `PsnSyncAuthScheduler` horário com flag `running`, skip silencioso sem NPSSO, `logger.error` com o marcador em falha e `logger.warn` com a data quando faltarem < 7 dias para o refresh expirar; registrar no `PsnSyncModule` e verificar em spec os casos: saudável, falha, expiração próxima, sem NPSSO e execução concorrente ignorada.

## 4. Documentação e integração

- [x] 4.1 Documentar no README (seção de env/PSN) a rotação via endpoint, que o env só vale enquanto não houver NPSSO no banco, e o marcador de log; executar `npm run test -- psn` e `npm run build` sem falhas.
