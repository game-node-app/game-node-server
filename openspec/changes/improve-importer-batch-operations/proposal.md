# Proposal

## Why

A seleção de jogos importáveis exige consultas individuais de biblioteca e capas, enquanto importações e descartes em chamadas sequenciais podem deixar resultados parciais ou sobrescrever dados do usuário. As conexões também não mostram quantos jogos estão disponíveis para importar.

## What Changes

- Acrescentar à listagem do importador a indicação de presença na biblioteca e um filtro opt-in `excludeInLibrary`, mantendo a listagem padrão compatível, e incluir `game.cover`.
- Oferecer importação transacional por fonte, com seleção explícita ou importação de todos, status e coleções opcionais, preservando entradas existentes e retornando contagens de criados e ignorados.
- Oferecer atualização de status em lote sem alterar o endpoint individual existente.
- Acrescentar contagem de jogos disponíveis às respostas de conexões próprias, com ausência da contagem quando não for possível determiná-la; usar a última descoberta bem-sucedida existente como informação opcional de sincronização.
- Manter compatíveis os contratos existentes, os fluxos de importação automática e a privacidade das conexões públicas. A change ativa `optimize-player-data-imports` continua responsável pelo agendamento e recuperação da descoberta automática.

## Capabilities

### New Capabilities

- `library-import-queue`: Listagem de candidatos, operações manuais em lote e visibilidade da disponibilidade por conexão.

### Modified Capabilities

Nenhuma.

## Impact

- `src/importer`, `src/connection`, serviços de coleções e de jogos externos, DTOs e OpenAPI; testes de controlador, serviço e integração transacional.
- O importador atual deriva candidatos dos provedores e de marcadores de status, não de uma tabela de fila. A contagem precisa respeitar essa origem e não tratar falhas como fila vazia.
- Sem mudança no wrapper, clientes ou provedores neste repositório; sua geração e adoção são posteriores. Não inclui novo agendamento, fornecedor ou funcionalidade de interface.
