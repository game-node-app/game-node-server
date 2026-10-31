# Spec Delta

## Purpose

Define quais achievements da plataforma existem, como são obtidos, como são apresentados e quem pode criá-los e mantê-los, sem exigir código ou arte manual para cada achievement novo.

## ADDED Requirements

### Requirement: Definições persistidas compostas por métrica, critérios e tiers
Cada achievement SHALL ser uma definição persistida com identificador estável (slug), nome, descrição, categoria, métrica, critérios, de 1 a 10 tiers e descritor de ícone. Cada tier SHALL ter limiar inteiro positivo e recompensa de XP entre 0 e 5000, com limiares estritamente crescentes. Criar uma definição SHALL NOT exigir deploy.

#### Scenario: Definição com tiers válidos
- **WHEN** um editor cria a definição `horror-critic` com a métrica `reviews_written`, o critério de tema terror e os tiers 1, 5 e 25
- **THEN** a definição é salva como rascunho com três tiers ordenados

#### Scenario: Limiares fora de ordem
- **WHEN** os tiers enviados têm limiares 5 e 5, ou 10 e 3
- **THEN** a requisição é rejeitada com erro de validação e nada é salvo

#### Scenario: Slug duplicado
- **WHEN** um editor cria uma definição com um slug já existente, inclusive de definição arquivada
- **THEN** a requisição é rejeitada e a definição existente não é alterada

### Requirement: Catálogo fechado de métricas com critérios validados
As métricas SHALL vir de um catálogo mantido pelo sistema. Cada métrica declara os filtros que aceita e se suporta janela de tempo. Uma definição SHALL referenciar uma métrica existente, e seus critérios SHALL conter apenas filtros aceitos por ela, com listas de no máximo 50 identificadores. O catálogo SHALL ser consultável pela API administrativa.

#### Scenario: Filtro não suportado
- **WHEN** uma definição com a métrica `followers` envia o filtro de tema
- **THEN** a requisição é rejeitada indicando o filtro inválido

#### Scenario: Métrica inexistente
- **WHEN** uma definição referencia uma métrica fora do catálogo
- **THEN** a requisição é rejeitada

#### Scenario: Consulta do catálogo
- **WHEN** um editor consulta o catálogo de métricas
- **THEN** recebe cada métrica com a descrição, os filtros aceitos e o suporte a janela de tempo

### Requirement: Ciclo editorial de definições
As definições SHALL seguir o ciclo rascunho -> publicada -> arquivada. Só definições publicadas são avaliadas e aparecem no catálogo público. Rascunhos SHALL poder ser editados e excluídos. Publicadas e arquivadas SHALL NOT ser excluídas. Depois da publicação, métrica, critérios, janela e limiares existentes SHALL ser imutáveis, e só é permitido acrescentar tiers com limiar maior que o último.

#### Scenario: Edição de critério após a publicação
- **WHEN** um editor tenta mudar a métrica, os critérios ou o limiar de um tier existente de uma definição publicada
- **THEN** a requisição é rejeitada e a definição continua igual

#### Scenario: Novo tier em definição publicada
- **WHEN** um editor acrescenta um tier com limiar maior que o último
- **THEN** o tier é salvo e passa a ser avaliado

#### Scenario: Arquivamento
- **WHEN** uma definição publicada é arquivada
- **THEN** ela deixa de ser avaliada e de aparecer no catálogo público
- **AND** os tiers já obtidos continuam visíveis nos perfis

### Requirement: Eventos com janela de tempo
Um evento SHALL ter nome, slug, descrição, início e fim (UTC, fim posterior ao início) e o mesmo ciclo editorial das definições. Uma definição ligada a um evento SHALL usar a janela do evento e só ficar visível no catálogo público quando definição e evento estiverem publicados. Depois de publicado, o início SHALL ser imutável e o fim SHALL só poder ser estendido.

#### Scenario: Evento ainda em rascunho
- **WHEN** uma definição publicada pertence a um evento em rascunho
- **THEN** ela não aparece no catálogo público e não é avaliada

#### Scenario: Extensão de evento
- **WHEN** um editor adia o fim de um evento publicado
- **THEN** a janela das definições do evento passa a terminar na nova data

#### Scenario: Antecipação do fim
- **WHEN** um editor tenta antecipar o fim ou mudar o início de um evento publicado
- **THEN** a requisição é rejeitada

### Requirement: Janela de tempo restringe os fatos contados
Uma definição com janela, própria ou herdada do evento, SHALL contar apenas fatos cuja data de ocorrência esteja dentro da janela. Janela própria e evento SHALL ser mutuamente exclusivos. Uma métrica sem suporte a janela SHALL NOT ser usada em definição com janela.

#### Scenario: Fato fora da janela
- **WHEN** uma definição de outubro exige 3 jogos de terror finalizados e o usuário finalizou 2 em outubro e 1 em setembro
- **THEN** o progresso da definição é 2

#### Scenario: Métrica sem suporte a janela
- **WHEN** uma definição com janela usa uma métrica que não suporta janela
- **THEN** a requisição é rejeitada

### Requirement: Ícones descritos sem arte específica
Cada definição SHALL ter um descritor de ícone de um destes tipos: glifo nomeado (identificador em kebab-case, até 64 caracteres), capa de jogo (ID de jogo existente) ou imagem estática já publicada pelo servidor (nome de um ícone existente, como os legados). O catálogo SHALL expor o descritor e o tier de cada item obtido, para que o cliente componha a apresentação.

#### Scenario: Ícone de capa de jogo
- **WHEN** uma definição usa ícone de capa com o ID de um jogo existente
- **THEN** o catálogo expõe o tipo e o ID do jogo, com dados suficientes para obter a capa

#### Scenario: Jogo inexistente
- **WHEN** o descritor referencia um ID de jogo que não existe
- **THEN** a requisição é rejeitada

### Requirement: Gestão restrita a administradores e editores
Criar, editar, publicar, arquivar e simular definições e eventos SHALL exigir sessão autenticada com papel `admin` ou `editor`. As demais pessoas SHALL receber recusa de acesso. Rascunhos SHALL NOT aparecer em respostas públicas.

#### Scenario: Usuário comum tenta criar
- **WHEN** um usuário sem esses papéis chama a API de gestão
- **THEN** a requisição é recusada e nada é alterado

#### Scenario: Leitura pública de rascunho
- **WHEN** alguém consulta publicamente o catálogo ou o slug de uma definição em rascunho
- **THEN** a definição não é retornada

### Requirement: Simulação de definição
Administradores e editores SHALL poder simular uma definição, inclusive em rascunho, para um usuário: o resultado informa o valor atual da métrica e os tiers que seriam atingidos. A simulação SHALL NOT conceder tiers, gravar progresso, conceder XP ou gerar notificação.

#### Scenario: Simulação de rascunho
- **WHEN** um editor simula um rascunho para o próprio usuário
- **THEN** recebe o valor e os tiers atingíveis, e nenhum estado do usuário muda

### Requirement: Definições secretas
Uma definição SHALL poder ser marcada como secreta. No catálogo público, uma secreta não obtida pelo usuário consultado SHALL aparecer sem nome, descrição, critérios ou ícone. Depois de obtida, ela aparece completa para quem a vê no perfil desse usuário.

#### Scenario: Secreta não obtida
- **WHEN** um usuário consulta o catálogo com uma definição secreta que ainda não obteve
- **THEN** o item aparece como oculto, sem revelar o conteúdo

#### Scenario: Secreta obtida
- **WHEN** o usuário obtém o primeiro tier de uma definição secreta
- **THEN** o catálogo e o perfil dele passam a mostrá-la completa

### Requirement: Catálogo público com tiers, eventos e raridade
O catálogo público SHALL listar com paginação as definições publicadas e visíveis, com tiers, descritor de ícone, evento e janela, além da raridade de cada tier: o percentual de perfis que o obtiveram, que pode ter atraso de até uma hora.

#### Scenario: Consulta do catálogo
- **WHEN** um visitante consulta o catálogo
- **THEN** recebe as definições publicadas com tiers, ícones, eventos e raridade, sem rascunhos nem arquivadas

### Requirement: Migração dos achievements existentes
Os achievements legados SHALL ser migrados para definições publicadas de um tier, preservando slug, nome, descrição, XP e ícone. Os achievements obtidos, os destaques, os códigos e as datas de obtenção SHALL ser preservados, com o tier 1 associado. A migração SHALL NOT conceder XP nem gerar notificações ou atividades.

#### Scenario: Conquista preservada
- **WHEN** a migração roda para um usuário que tinha `space-station` em destaque
- **THEN** ele continua com `space-station` no tier 1, em destaque e com a data original, e o XP dele não muda

### Requirement: Compatibilidade com os clientes publicados
Os endpoints v1 de achievements SHALL manter o formato de resposta atual. Cada definição é apresentada com o XP do primeiro tier, e cada achievement obtido aparece uma vez, no maior tier obtido. Secretas não obtidas, rascunhos e arquivadas SHALL ser omitidos do catálogo v1.

#### Scenario: Cliente antigo lista achievements obtidos
- **WHEN** um cliente antigo lista os achievements de um usuário que tem os tiers 1 e 2 de uma definição
- **THEN** recebe um único item dessa definição, no formato v1
