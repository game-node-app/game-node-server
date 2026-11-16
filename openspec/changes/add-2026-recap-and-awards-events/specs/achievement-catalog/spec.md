# Spec Delta

## ADDED Requirements

### Requirement: Métrica de cédula completa do Awards
O catálogo SHALL incluir a métrica `awards_ballot_completed`, que aceita o filtro de ano e vale 1 quando o usuário votou em todas as categorias do evento Awards daquele ano, e 0 caso contrário, incluindo quando o evento não existe ou não tem categorias.

#### Scenario: Cédula completa
- **WHEN** o evento de 2026 tem 12 categorias e o usuário votou nas 12
- **THEN** a métrica com ano 2026 vale 1 para o usuário

#### Scenario: Cédula incompleta
- **WHEN** o usuário votou em 11 das 12 categorias de 2026
- **THEN** a métrica com ano 2026 vale 0

#### Scenario: Filtro aceito
- **WHEN** um editor cria uma definição com a métrica `awards_ballot_completed` e o filtro de ano 2026
- **THEN** a definição é aceita
