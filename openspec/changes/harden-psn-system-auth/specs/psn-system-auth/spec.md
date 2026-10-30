# Spec Delta

## Purpose

Mantém válida a credencial PSN compartilhada pelo sistema, usada nas sincronizações e consultas de catálogo. Torna sua falha visível rapidamente e permite rotacionar o NPSSO sem redeploy.

## ADDED Requirements

### Requirement: Recuperação de refresh rejeitado
Quando a Sony rejeitar a renovação do token (resposta sem access token), o sistema SHALL descartar o token em cache e tentar uma única vez obter uma nova credencial a partir do NPSSO atual. Se essa tentativa também falhar, o erro SHALL identificar a etapa (refresh ou NPSSO) e o motivo informado pela Sony, quando disponível.

#### Scenario: Refresh rejeitado com NPSSO ainda válido
- **WHEN** o access token expirou, a renovação é rejeitada e o NPSSO atual é válido
- **THEN** o sistema obtém e armazena uma nova credencial a partir do NPSSO, e a chamada original prossegue

#### Scenario: Refresh rejeitado e NPSSO inválido
- **WHEN** a renovação é rejeitada e a troca do NPSSO também falha
- **THEN** a chamada falha com um erro que identifica a falha de autenticação PSN do sistema
- **AND** nenhum token inválido permanece em cache, de modo que a próxima chamada tenta de novo a partir do NPSSO vigente

### Requirement: Verificação periódica da credencial
O sistema SHALL verificar periodicamente, sem depender de tráfego de usuários, se consegue obter uma credencial PSN válida, renovando-a quando necessário. Falhas SHALL gerar um log de erro com um marcador estável e pesquisável. Execuções concorrentes no mesmo processo SHALL ser ignoradas.

#### Scenario: Credencial saudável
- **WHEN** a verificação periódica roda e a credencial é válida ou renovável
- **THEN** nenhum erro é registrado e a cadeia de refresh permanece ativa

#### Scenario: Credencial inválida
- **WHEN** a verificação periódica não consegue obter uma credencial válida
- **THEN** um log de erro com o marcador estável de falha de autenticação PSN é emitido na mesma execução

#### Scenario: NPSSO ausente
- **WHEN** nenhum NPSSO está configurado (nem em runtime, nem no ambiente)
- **THEN** a verificação não chama a Sony e não registra erro repetido a cada execução

### Requirement: Aviso de expiração próxima
A verificação periódica SHALL emitir um aviso quando faltarem menos de 7 dias para a expiração do refresh token armazenado, informando a data de expiração.

#### Scenario: Refresh token perto de expirar
- **WHEN** a verificação roda e o refresh token expira em menos de 7 dias
- **THEN** um aviso com a data de expiração é registrado

### Requirement: Rotação administrativa do NPSSO
Um endpoint restrito a administradores SHALL aceitar um novo NPSSO, validá-lo na Sony e, só se for válido, armazená-lo e passar a usá-lo em todas as instâncias sem reinício. O NPSSO definido em runtime SHALL prevalecer sobre o do ambiente, que continua como fallback. O NPSSO SHALL ser persistido criptografado em repouso e sobreviver a reinícios e à limpeza do cache. O valor do NPSSO SHALL NEVER ser retornado em respostas nem registrado em logs.

#### Scenario: Rotação com NPSSO válido
- **WHEN** um administrador envia um NPSSO válido
- **THEN** o sistema obtém uma credencial com ele, passa a usá-lo nas próximas chamadas PSN e responde com sucesso, informando a validade do refresh token mas sem ecoar o NPSSO

#### Scenario: Rotação com NPSSO inválido
- **WHEN** um administrador envia um NPSSO que a Sony rejeita
- **THEN** o sistema responde com HTTP 400 e mantém o NPSSO e a credencial anteriores

#### Scenario: Usuário sem permissão
- **WHEN** um usuário não autenticado ou sem papel de administrador chama o endpoint
- **THEN** a requisição é rejeitada e nada é alterado

#### Scenario: Sem NPSSO em runtime
- **WHEN** nenhum NPSSO foi definido pelo endpoint
- **THEN** o sistema usa `PSN_NPSSO_KEY` do ambiente, como antes

#### Scenario: Cache limpo após rotação
- **WHEN** o NPSSO foi definido pelo endpoint e depois o cache é limpo ou o servidor reinicia
- **THEN** o sistema obtém nova credencial com o NPSSO definido pelo endpoint, e não com o do ambiente
