# Spec Delta

## Purpose

Acompanha o progresso de cada usuário nos achievements da plataforma e concede tiers e XP de forma confiável, a partir das ações que ele realmente realiza. Os desbloqueios são visíveis para o próprio usuário e para a comunidade.

## ADDED Requirements

### Requirement: Ações relevantes disparam avaliação
Uma ação confirmada que altere uma métrica SHALL disparar a avaliação assíncrona das definições publicadas dessa métrica para o usuário afetado. São elas: criar review, adicionar jogo à biblioteca, finalizar jogo, ser seguido, comentar, votar no Awards e concluir uma importação. A falha da avaliação SHALL NOT desfazer nem bloquear a ação.

#### Scenario: Ser seguido avalia o usuário seguido
- **WHEN** um usuário passa a seguir outro, que agora tem 10 seguidores
- **THEN** o usuário seguido recebe o tier correspondente a 10 seguidores, se existir

#### Scenario: Importação em lote
- **WHEN** uma importação adiciona 200 jogos à biblioteca
- **THEN** a métrica da biblioteca é avaliada a partir do estado final, sem uma concessão por jogo importado

### Requirement: Progresso persistido e consultável
O sistema SHALL guardar, para cada usuário e definição avaliada, o valor atual da métrica. A consulta de progresso de um usuário SHALL retornar, por definição visível, o valor, o maior tier obtido e o limiar do próximo tier. Uma definição nunca avaliada para o usuário SHALL aparecer com valor 0.

#### Scenario: Progresso parcial
- **WHEN** um usuário com 37 jogos na biblioteca consulta uma definição de tiers 10, 50 e 100
- **THEN** a resposta indica valor 37, tier 1 obtido e próximo limiar 50

### Requirement: Concessão idempotente por tier
Cada tier SHALL ser obtido no máximo uma vez por usuário. Quando o valor atinge um ou mais limiares ainda não obtidos, a concessão de cada tier e seu XP SHALL ser confirmada atomicamente. Avaliações repetidas ou concorrentes SHALL NOT duplicar tiers, XP ou notificações. As avaliações SHALL ser repetidas em caso de falha.

#### Scenario: Avaliações concorrentes
- **WHEN** duas avaliações do mesmo usuário e definição atingem o mesmo limiar ao mesmo tempo
- **THEN** existe um único registro do tier, o XP é concedido uma vez e há uma única notificação

#### Scenario: Vários tiers de uma vez
- **WHEN** o valor salta de 0 para 60 numa definição de tiers 10 e 50
- **THEN** os tiers 1 e 2 são concedidos, com a soma do XP dos dois

### Requirement: Tiers obtidos não são revogados
Os tiers obtidos SHALL permanecer mesmo que a métrica diminua depois (unfollow, review excluída, jogo removido) ou que a definição seja arquivada. Uma queda e posterior recuperação do valor SHALL NOT conceder o tier de novo.

#### Scenario: Seguidores diminuem
- **WHEN** um usuário que obteve o tier de 50 seguidores cai para 40
- **THEN** ele mantém o tier e o progresso passa a mostrar 40

### Requirement: Backfill ao publicar ou acrescentar tier
Publicar uma definição ou acrescentar um tier a uma publicada SHALL avaliar, em lotes limitados e retomáveis, os usuários que têm fatos relevantes para a métrica. As concessões retroativas SHALL creditar XP sem gerar notificação nem atividade.

#### Scenario: Nova definição para usuários antigos
- **WHEN** uma definição de 1 review de terror é publicada e 3.000 usuários já atendem ao critério
- **THEN** todos recebem o tier 1 e o XP, sem notificações nem atividades no feed

#### Scenario: Reinício durante o backfill
- **WHEN** o servidor reinicia no meio de um backfill
- **THEN** o processamento continua a partir do último lote confirmado, sem concessões duplicadas

### Requirement: Concessões manuais
Administradores e moderadores SHALL poder conceder o primeiro tier de uma definição publicada a usuários específicos. Os códigos de resgate SHALL conceder o primeiro tier da definição associada a quem os resgata. A métrica `manual` SHALL só ser obtida por esses caminhos. Conceder um tier que o usuário já tem SHALL ser recusado, sem efeito colateral.

#### Scenario: Resgate de código
- **WHEN** um usuário resgata um código válido do achievement `test-lab`
- **THEN** ele recebe o tier 1 e o XP, e é notificado

#### Scenario: Concessão repetida
- **WHEN** um administrador ou moderador concede um achievement que o usuário já tem
- **THEN** a resposta indica que ele já o possui, e o XP não muda

### Requirement: Destaque no perfil por definição
O usuário SHALL poder destacar no perfil definições das quais obteve ao menos um tier, e o destaque exibe o maior tier obtido. Pedir o destaque de uma definição não obtida SHALL NOT destacá-la.

#### Scenario: Destaque após novo tier
- **WHEN** um usuário destacou uma definição no tier 1 e depois obtém o tier 2
- **THEN** o destaque passa a mostrar o tier 2, sem nova ação do usuário

### Requirement: Atividade de desbloqueio no feed
Toda concessão ao vivo, seja por avaliação de ação ou manual, SHALL gerar uma atividade de desbloqueio do usuário para o maior tier novo da definição naquela concessão. A atividade pode receber likes e comentários como as demais. Backfill e migração SHALL NOT gerar atividades.

#### Scenario: Desbloqueio visível ao seguidor
- **WHEN** um usuário desbloqueia o tier 2 de uma definição ao criar uma review
- **THEN** seus seguidores veem no feed uma atividade desse desbloqueio, que aceita like e comentário

### Requirement: Raridade por tier
O sistema SHALL manter, por tier, a contagem de perfis que o obtiveram, atualizada junto com a concessão. A raridade exposta SHALL ser essa contagem dividida pelo total de perfis, que pode ser cacheado por até uma hora.

#### Scenario: Concessão atualiza a contagem
- **WHEN** um usuário obtém um tier
- **THEN** a contagem desse tier aumenta em um na mesma confirmação
