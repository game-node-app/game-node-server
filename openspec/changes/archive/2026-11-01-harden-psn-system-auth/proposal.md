# Proposal

## Why

A credencial PSN do sistema (NPSSO -> access/refresh token) cai com frequência, e a falha só é percebida dias depois, em testes manuais. Um refresh rejeitado pela Sony fica preso no cache até o fim do TTL, sem fallback para o NPSSO e com um erro opaco (`Invalid time value`). Para recuperar, é preciso editar o env e reiniciar o servidor.

## What Changes

- Detectar a resposta inválida do refresh com um erro descritivo. Descartar o token em cache e tentar o NPSSO atual uma única vez antes de falhar.
- Adicionar uma verificação agendada que renova a credencial periodicamente, mantendo a cadeia de refresh ativa sem tráfego. Ela registra um erro identificável quando a autenticação falha e um aviso quando o refresh token estiver perto de expirar.
- Adicionar um endpoint administrativo para substituir o NPSSO em tempo de execução. O NPSSO enviado é validado na Sony antes de ser salvo, fica no banco criptografado com a mesma chave das credenciais de conexão e prevalece sobre `PSN_NPSSO_KEY`, que continua como fallback.
- Fora do escopo: a interface no frontend para o endpoint administrativo, canais externos de alerta (Discord, e-mail etc.), outcome dedicado para falha de credencial global nos jobs de sync e automação do login na Sony.

## Capabilities

### New Capabilities

- `psn-system-auth`: Ciclo de vida da credencial PSN compartilhada pelo sistema: obtenção, renovação e recuperação, monitoramento e rotação administrativa do NPSSO.

### Modified Capabilities

Nenhuma.

## Impact

- `src/sync/psn/auth` (serviço de autenticação), um novo agendador e um novo controlador admin no `PsnSyncModule`, DTO e OpenAPI (`server_swagger.json`).
- MySQL: nova tabela de uma linha para o NPSSO criptografado, com migração. Reaproveita `CONNECTION_CREDENTIAL_ENCRYPTION_KEY`, sem variável nova.
- O token em cache no Redis passa a usar uma chave fixa: no primeiro deploy, há uma troca de NPSSO a mais.
- Sem dependência nova. O README menciona o novo fluxo de rotação.
