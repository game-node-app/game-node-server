# Spec Delta

## Purpose

Permite aos usuários identificar e processar jogos disponíveis de suas conexões com segurança e visibilidade da importação.

## ADDED Requirements

### Requirement: Listagem compatível com presença e capa
`GET /v1/importer/{source}` SHALL incluir `isInLibrary` para cada jogo e `game.cover` quando houver capa. `excludeInLibrary` SHALL ser opcional e ter padrão `false`, sem alterar os estados de importação.

#### Scenario: Cliente existente
- **WHEN** a listagem é solicitada sem `excludeInLibrary`
- **THEN** ela mantém candidatos e paginação existentes e identifica os jogos já presentes na biblioteca

#### Scenario: Filtro antes da paginação
- **WHEN** `excludeInLibrary=true` é solicitado
- **THEN** jogos presentes na biblioteca do usuário são excluídos antes da busca, contagem e paginação
- **AND** outros usuários não influenciam o resultado

#### Scenario: Jogo sem capa
- **WHEN** um candidato não possui capa
- **THEN** o jogo é retornado com a relação de capa vazia ou nula

#### Scenario: Nenhum candidato elegível
- **WHEN** o filtro resulta em zero candidatos para a fonte
- **THEN** o endpoint mantém a convenção existente de resposta para ausência de itens

### Requirement: Importação em lote por fonte
`POST /v1/importer/{source}/import` SHALL aceitar exatamente uma seleção não vazia de `externalGameIds` ou `importAll=true`, um status válido opcional e `collectionIds` opcionais. O status padrão SHALL ser `PLANNED` e a plataforma SHALL ser resolvida pelo servidor.

#### Scenario: Seleção válida
- **WHEN** o usuário solicita candidatos não processados da própria conexão com coleções de sua propriedade
- **THEN** o sistema cria as entradas ausentes com o status solicitado, coleções e plataforma preferida
- **AND** marca todos os candidatos selecionados como processados e retorna `importedCount` e `skippedCount`

#### Scenario: Importação de toda a fonte
- **WHEN** `importAll=true` é solicitado
- **THEN** o sistema processa todos os candidatos não processados da fonte no snapshot obtido para a solicitação, sem depender da paginação
- **AND** uma seleção vazia resulta em ambas as contagens iguais a zero

#### Scenario: Entrada da biblioteca existente
- **WHEN** um candidato já está na biblioteca do usuário
- **THEN** a entrada existente e todos os seus dados permanecem inalterados, o candidato é marcado como processado e `skippedCount` aumenta

#### Scenario: Entrada inválida ou não autorizada
- **WHEN** a seleção é ambígua, contém IDs inválidos, ausentes, ignorados, processados, de outra fonte ou fora da biblioteca do provedor do usuário, ou uma coleção não pertence ao usuário
- **THEN** a requisição falha sem alterar biblioteca ou estados do importador

#### Scenario: IDs repetidos
- **WHEN** a seleção contém IDs repetidos
- **THEN** cada ID distinto é marcado uma única vez e cada jogo distinto é contabilizado uma única vez

#### Scenario: IDs diferentes para o mesmo jogo
- **WHEN** IDs válidos distintos da seleção apontam para o mesmo jogo
- **THEN** todos os IDs são marcados como processados, mas o jogo é criado e contabilizado uma única vez

### Requirement: Atomicidade e concorrência da importação
As alterações locais de uma importação em lote SHALL ser confirmadas integralmente ou revertidas integralmente. A importação SHALL preservar entradas criadas por outro fluxo concorrente e evitar duplicatas de jogo por usuário.

#### Scenario: Falha durante o lote
- **WHEN** uma escrita local falha após o início da importação
- **THEN** nenhuma entrada, associação ou marca de processado do lote é confirmada

#### Scenario: Criação concorrente
- **WHEN** outra operação cria ou altera uma entrada do mesmo usuário e jogo durante o lote
- **THEN** a importação não sobrescreve seus dados nem cria uma segunda entrada para o mesmo jogo

### Requirement: Atualização de status em lote
`POST /v1/importer/status/batch` SHALL aceitar uma fonte, uma lista não vazia de IDs externos e `status` igual a `processed` ou `ignored`. A atualização SHALL ser atômica e restrita aos candidatos da conexão autenticada e da fonte indicada.

#### Scenario: Ignorar vários candidatos
- **WHEN** uma seleção válida de candidatos não processados é enviada com `ignored`
- **THEN** todos são marcados como ignorados numa única operação de lote e deixam de aparecer na listagem

#### Scenario: Repetição e conflito de estado
- **WHEN** um ID já possui o status solicitado
- **THEN** ele é tratado como sucesso idempotente sem duplicar registros
- **WHEN** um ID possui o status oposto ou não pertence à biblioteca do provedor da conexão indicada
- **THEN** o lote falha sem alterar qualquer estado

#### Scenario: Endpoint anterior
- **WHEN** um cliente usa `POST /v1/importer/status` com o contrato existente
- **THEN** o comportamento desse endpoint permanece compatível

### Requirement: Disponibilidade por conexão própria
As respostas de `GET /v1/connections/own` e `GET /v1/connections/own/{type}` SHALL incluir `unprocessedCount` quando a disponibilidade puder ser determinada. A contagem SHALL representar os candidatos distintos não processados nem ignorados e ainda ausentes da biblioteca, sem filtro de busca.

#### Scenario: Contagem disponível
- **WHEN** a consulta à fonte é concluída com sucesso
- **THEN** a contagem coincide com o total da listagem com `excludeInLibrary=true`, inclusive zero quando não há candidatos

#### Scenario: Disponibilidade desconhecida
- **WHEN** a consulta do provedor falha ou a conexão não é elegível
- **THEN** a contagem é omitida e a resposta de conexão continua disponível
- **AND** a indisponibilidade não é apresentada como zero

#### Scenario: Dados privados da conexão
- **WHEN** conexões são consultadas por endpoints públicos ou usados internamente
- **THEN** a consulta não expõe a contagem privada nem provoca descoberta adicional

### Requirement: Data da última descoberta
Quando existir data de descoberta concluída com sucesso para a conexão atual, os endpoints de conexões próprias SHALL expô-la opcionalmente como `lastSyncedAt` em formato ISO; quando desconhecida, SHALL retornar null ou omitir o campo.

#### Scenario: Conexão recém-criada
- **WHEN** ainda não houve descoberta bem-sucedida para a conta atualmente vinculada
- **THEN** não é apresentada uma data de sucesso de outra conta ou de uma tentativa falha
