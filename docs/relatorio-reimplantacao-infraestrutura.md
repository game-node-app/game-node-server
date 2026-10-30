# GameNode — relatório de implantação da infraestrutura do zero

Data: 30/10/2026. Destino: `130.254.47.92`, hostname `gamenode-vps`, 4 vCPU, 12 GB de RAM e disco contratado de 500 GB.

Este é um plano de execução para uma instalação nova, sem dados, usuários ou infraestrutura de aplicação a recuperar. A consulta para este relatório não alterou DNS, R2, aplicações ou configurações da VPS.

## 1. Situação atual e decisões

A consulta anterior registrou a base da VPS preparada: Ubuntu LTS, SSH por chave, firewall IPv4/IPv6 com proteção para portas Docker, Docker, Coolify, proxy e monitoramento do próprio Coolify. Confirmar essa base antes do deploy; os recursos do GameNode serão criados do zero. O painel está acessível em `https://coolify.gamenode.app`, protegido pelo Cloudflare Access, com funcionamento confirmado pelo responsável. O túnel `ssh -N gamenode-coolify`, em `http://localhost:8000`, permanece como acesso de emergência.

Não há bancos, usuários, catálogo, uploads, conteúdo editorial ou filas de produção a preservar. Não é necessário obter dumps, restaurar backups, converter dados legados ou recuperar chaves antigas para iniciar. O catálogo será populado pelo fluxo IGDB; contas e conteúdo serão criados na nova instalação. Um eventual backup da VPS/Coolify protege somente essa base, não provisiona a aplicação.

Decisões recomendadas:

- Uma VPS, Docker Compose e uma réplica inicial por aplicação. Builds no CI, sem Swarm.
- Usar `gamenode.app`, `server.gamenode.app`, `search.gamenode.app`, `admin.gamenode.app` e `s3.gamenode.app`, conforme a configuração dos clientes.
- API, processamento de filas, sincronização IGDB e busca HTTP no backend atual. Manticore continua como engine interna.
- Uma instância MySQL **gerenciada pelo Coolify** (recurso de banco standalone, fora do Compose), com databases e usuários separados para GameNode (`gamenode`), SuperTokens (`supertokens`) e Directus (`blog_cms`). O motivo é o backup nativo do Coolify para o R2: ele só aparece para bancos standalone ou de Services, não para um MySQL dentro de uma aplicação Docker Compose. O provisionamento dos databases extras é um passo manual obrigatório (seção 6.3). Os Composes de desenvolvimento e de testes continuam com MySQL próprio.
- Dois Redis: cache descartável e filas persistentes com `noeviction`.
- R2 separado em uploads públicos e backups privados. Os arquivos do Directus continuam nos volumes previstos pelo código.
- Acessar o Coolify por `https://coolify.gamenode.app`, protegido pelo Cloudflare Access; manter o túnel SSH como acesso de emergência.

### Domínio e acesso ao Coolify regularizados

A zona `gamenode.app` foi ativada na Cloudflare. As consultas públicas posteriores na Cloudflare e no Google resolveram `coolify.gamenode.app` sem `SERVFAIL`, com endereços do proxy Cloudflare. Os registros A de `@` e `coolify` foram configurados para `130.254.47.92`, com proxy ativado. O responsável confirmou a configuração do Cloudflare Access e o funcionamento do painel pelo domínio. O bloqueio de DNS está resolvido; a publicação dos demais serviços continua pendente.

## 2. O que você precisa providenciar

| Item | O que reunir ou decidir | Finalidade |
| --- | --- | --- |
| Domínio e registrador | Manter acesso ao registrador de `gamenode.app` e à conta Cloudflare que administra a zona ativa | Configurar os registros dos demais serviços |
| R2 | Conta com R2 habilitado, Account ID, endpoint S3 e buckets | Uploads e cópias externas |
| Esquema inicial | Baseline revisada e versionada do esquema atual, validada em banco vazio | Criar a aplicação sem depender de dumps ou arquivos locais ignorados |
| Chave de conexões | Gerar uma nova `CONNECTION_CREDENTIAL_ENCRYPTION_KEY` e guardá-la como secret | Cifrar as credenciais que forem cadastradas |
| OAuth de login | IDs e secrets de Google, Discord e Twitter/X; acesso às configurações de callback | Configurar login social |
| Integrações | Twitch/IGDB, Steam, Xbox OAuth e credenciais PSN/Xbox ainda usadas | Catálogo, bibliotecas e conquistas |
| Directus | `CMS_LICENSE_KEY` válida para a instalação final, segredo do CMS e contas editoriais | Ativar o CMS e as políticas já adotadas |
| Repositórios e registry | Acesso ao backend e ao monorepo de clientes; credenciais de publicação/pull no registry escolhido | Produzir e implantar imagens correspondentes ao código atual |
| Operação | Responsável pela implantação e destino dos alertas | Executar migrações, configurar backups recorrentes e reagir a falhas |
| Analytics, se adotado | Escolher e configurar a ferramenta | Medição opcional, sem bloquear a implantação |

Não publicar secrets neste relatório, no Git ou em variáveis `NEXT_PUBLIC_*`/`VITE_PUBLIC_*`. Fornecê-los por canal privado e inseri-los como secrets no Coolify/CI. A chave de conexões deve resolver para 32 bytes. Depois de começar a cifrar credenciais, preservar essa chave; substituí-la exige rotação dos dados cifrados.

O código atual de login usa provedores sociais; não é preciso instalar um servidor de email para isso. SMTP ou webhook pode ser necessário para o canal de alertas escolhido.

## 3. Serviços que precisam existir

| Componente | Instância inicial | Acesso e persistência |
| --- | --- | --- |
| Next.js web | `game-node-clients/apps/web`, porta interna 3000 | Público pelo proxy; sem volume de dados da aplicação |
| Next.js admin | `game-node-clients/apps/admin`, porta interna 3000 | `admin.gamenode.app`; autenticação e permissões administrativas |
| NestJS API e workers | `game-node-server`, porta interna 5000 | `server.gamenode.app`; também atende o hostname de busca |
| MySQL compartilhado | Recurso MySQL gerenciado pelo Coolify, `mysql:8.4.13`; databases `gamenode`, `supertokens` e `blog_cms` | Volume do próprio recurso; usuários com acesso apenas ao próprio database; sem porta pública; backup nativo para o R2 (seção 6.3) |
| SuperTokens Core | Imagem MySQL `10.1.4`, compatível com CDI `5.3` do SDK Node `22.0.1` | Porta interna 3567; sem domínio público próprio |
| Redis cache | Versão fixa, 512 MiB, `allkeys-lru` | Sem persistência nem volume; sem portas públicas; perda do cache não apaga filas |
| Redis BullMQ | Instância distinta do cache | AOF, `noeviction`, volume em `/data`; backup consistente |
| Manticore | `manticoresearch/manticore:29.9.0` | Volume `/var/lib/manticore`; 9306/9308 privadas; índices reconstruídos do MySQL |
| Directus blog | `directus/directus:12.6.0`, com extensões do repositório | Porta interna 8055; origem editorial `cms.gamenode.app` |
| Mídia Directus | Volumes privados e publicados separados | API monta `gamenode-blog-public-media` somente para leitura |
| Cloudflare R2 | Serviços externos à VPS | Bucket de uploads e bucket de backups, com credenciais distintas |

Os serviços internos do **Coolify**, como proxy, PostgreSQL, Redis e Sentinel, não substituem os bancos e Redis do GameNode.

O app mobile é um artefato distribuído, não um servidor a hospedar na VPS. A versão escolhida precisa ser compatível com os endpoints implantados. O monorepo atual contém o admin; usar essa aplicação.

Não provisionar os serviços legados `game-node-search` e o produtor externo `game-node-sync-igdb`: a busca HTTP e o fluxo IGDB estão integrados ao backend atual. O hostname `search.gamenode.app` será atendido pela API.

## 4. Cloudflare: zona ativa e configuração dos serviços

### 4.1. Delegação e acesso ao painel concluídos

Os nameservers configurados no registrador são `karsyn.ns.cloudflare.com` e `norman.ns.cloudflare.com`. A Cloudflare reconheceu a delegação e ativou a zona. O hostname `coolify.gamenode.app` já resolve pelo proxy Cloudflare e atende o painel com proteção pelo Access.

Preservar a zona ativa, seus registros e as políticas de acesso ao configurar os demais serviços. Registrar os valores anteriores a qualquer alteração e preservar registros de email e validações que ainda sejam usados.

Referências: [nameservers da Cloudflare](https://developers.cloudflare.com/dns/nameservers/update-nameservers/) e [gestão dos registros](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/).

### 4.2. Registros para a publicação

Em **Cloudflare → zona gamenode.app → DNS → Records**, criar ou editar os registros abaixo. Os nomes são relativos à zona.

| Tipo | Nome | Conteúdo/destino | Proxy no estado final | Uso |
| --- | --- | --- | --- | --- |
| A | `@` | `130.254.47.92` | Proxied, nuvem laranja | Web principal |
| A | `coolify` | `130.254.47.92` | Proxied | Painel já acessível, protegido pelo Cloudflare Access |
| CNAME | `www` | `gamenode.app` | Proxied | Alias; configurar redirecionamento para o domínio principal no proxy/app |
| A | `server` | `130.254.47.92` | Proxied | API NestJS |
| A | `search` | `130.254.47.92` | Proxied | Mesmo backend NestJS, preservando `/search/*` e `/v1/search/*` |
| A | `admin` | `130.254.47.92` | Proxied | Admin Next.js |
| A | `cms` | `130.254.47.92` | Proxied | Directus editorial, protegido por acesso de equipe |
| Gerenciado pelo R2 | `s3` | Domínio personalizado associado ao bucket `gamenode-user-uploads` | Gerenciado pela integração R2 | Leitura pública dos uploads |

Os registros `@` e `coolify` já foram criados; configurar os demais conforme os serviços forem provisionados. Para os registros da VPS, usar TTL **Auto** quando proxied. Durante a preparação dos novos serviços, registros DNS-only podem usar TTL curto, por exemplo 300 segundos. Fazer os novos apontamentos públicos depois dos testes de origem; não há tráfego de produção da aplicação a interromper.

Não criar `s3 → 130.254.47.92` se os uploads forem servidos pelo R2. A associação desse hostname é feita em **R2 → bucket → Settings → Custom Domains**, conforme a seção seguinte; não inventar um CNAME para o endpoint S3.

Não é necessário criar wildcard `*`, hostname de banco, Redis, Manticore ou SuperTokens.

Na implantação inicial, usar os registros A. Remover ou corrigir eventuais registros A/AAAA/CNAME conflitantes **somente dos hostnames configurados**. O IPv6 da VPS é `2607:adc0:5::27d`, mas só adicionar AAAA após validar os serviços HTTPS também nesse caminho; o teste de SSH não valida o HTTPS da aplicação.

### 4.3. TLS, proxy e cache

1. Cadastrar os domínios HTTPS nos recursos do Coolify e apontá-los às portas internas corretas; na aplicação Compose, pelo campo **Domains** de cada serviço, por exemplo `https://server.gamenode.app:5000,https://search.gamenode.app:5000` no `server` e `https://cms.gamenode.app:8055` no `cms`. Só serviços com domínio recebem tráfego externo, e sempre pelo proxy do Coolify: o `docker-compose.prod.yml` não publica nenhuma porta no host (`ports:` contornaria o proxy e o UFW). DNS sozinho não configura roteamento de containers.
2. Emitir certificados de origem válidos, preferencialmente Let's Encrypt gerenciado pelo Coolify. Para o primeiro certificado por HTTP-01, pode-se usar temporariamente DNS-only, com TCP 80 acessível; voltar ao proxy laranja depois de validar HTTPS.
3. Na Cloudflare, usar **SSL/TLS → Overview → Full (strict)** quando as origens estiverem com certificados válidos. Não usar Flexible. Conferir o impacto sobre outras origens da mesma zona.
4. Ativar redirecionamento HTTP→HTTPS após a validação. Configurar o alias `www` no proxy; um CNAME não cria redirecionamento HTTP sozinho.
5. Em **Caching → Cache Rules**, criar uma regra de bypass para os hostnames de API, busca, admin, CMS e Coolify. Inicialmente, não aplicar Cache Everything ao HTML dinâmico do site.

Se já houver registros CAA, conferir que permitem a autoridade certificadora escolhida. Preservar MX/TXT de email e validações existentes; não é necessário criar SPF/DKIM/DMARC novos só para colocar o site no ar.

Expressão sugerida para a regra de bypass:

```text
http.host in {"server.gamenode.app" "search.gamenode.app" "admin.gamenode.app" "cms.gamenode.app" "coolify.gamenode.app"}
```

Ação: **Cache eligibility → Bypass cache**. Manter previews, respostas autenticadas e cookies fora do cache compartilhado; não criar uma regra posterior que anule essa proteção. É possível otimizar arquivos estáticos depois da implantação funcional.

Proteger o CMS com Cloudflare Access e contas editoriais próprias, se esse for o mecanismo adotado. A API acessa o CMS pelo endereço Docker interno, sem depender da tela de login do Access. Não colocar desafios de navegador ou Access sobre toda a API pública: isso quebraria app mobile, OAuth e chamadas automáticas.

Manter a proteção do Cloudflare Access em `coolify.gamenode.app` e avaliar as rotas de webhook usadas no deploy. Ainda é necessário validar certificado de origem, Full (strict) e restrições de acesso direto à VPS para impedir que o Access seja contornado; o funcionamento no navegador não comprova esses controles.

Fontes: [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/) e [regras de bypass de cache](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/).

## 5. R2: uploads e backups são configurações diferentes

### 5.1. Buckets e permissões

| Bucket | Visibilidade | Conteúdo | Credencial |
| --- | --- | --- | --- |
| `gamenode-user-uploads` | Leitura pública pelo domínio `s3.gamenode.app` | Avatares, imagens e outros objetos enviados pela aplicação | Somente backend, limitada a esse bucket |
| `gamenode-backups` | Privado, sem domínio público e sem acesso público `r2.dev` | Dumps, arquivos de recuperação, estado consistente e configurações cifradas | Somente processo de backup/Coolify, limitada a esse bucket |

O nome `gamenode-user-uploads` é obrigatório no código atual de `UploadService`. `gamenode-backups` é um nome proposto; pode ser ajustado antes da configuração. Não misturar arquivos públicos e backups.

No painel da Cloudflare:

1. Habilitar R2 na conta e verificar cobrança/limites disponíveis.
2. Criar os dois buckets vazios. Não há objetos antigos a copiar.
3. Em **R2 → API Tokens**, criar credenciais com **Object Read & Write**, limitadas ao bucket correspondente. Separar uploads e backup. Esse acesso permite operações de escrita/remoção: a credencial da aplicação não deve alcançar o bucket de backups.
4. Guardar Access Key ID, Secret Access Key e o endpoint S3 exibido. Não confundir essas credenciais com um token comum da API de DNS Cloudflare.

Fontes: [autenticação R2](https://developers.cloudflare.com/r2/api/tokens/) e [endpoint S3 do R2](https://developers.cloudflare.com/r2/get-started/s3/).

### 5.2. Endpoint de escrita e domínio de leitura

Configuração da API:

```dotenv
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=SEGREDO_DA_CREDENCIAL_DE_UPLOAD
S3_SECRET_ACCESS_KEY=SEGREDO_DA_CREDENCIAL_DE_UPLOAD
```

Usar o endpoint real da conta/bucket, inclusive eventual jurisdição indicada pela Cloudflare. Não acrescentar o bucket ao endpoint e não usar `https://s3.gamenode.app` como endpoint de escrita. O SDK atual já usa região `auto`.

Para leitura, entrar em **R2 → gamenode-user-uploads → Settings → Custom Domains → Connect Domain**, informar `s3.gamenode.app` e concluir a associação. Se houver um registro com esse nome, revisar e remover o conflito durante a configuração. Aguardar domínio e certificado ativos.

Os clientes usam:

```dotenv
NEXT_PUBLIC_S3_BUCKET_URL=https://s3.gamenode.app
```

Um arquivo deve abrir como `https://s3.gamenode.app/NOME_DO_OBJETO`, sem prefixar novamente `gamenode-user-uploads`. Validar com um objeto de teste.

O domínio personalizado publica a leitura dos objetos desse bucket. Não colocar drafts privados do CMS ou backups ali. Usar o domínio personalizado para produção; não depender do endereço de desenvolvimento `r2.dev`. Fonte: [buckets públicos e domínios R2](https://developers.cloudflare.com/r2/buckets/public-buckets/).

### 5.3. CORS do bucket público

No bucket de uploads, em **Settings → CORS Policy**, se os clientes precisarem de leitura cross-origin por JavaScript/canvas, usar inicialmente:

```json
[
  {
    "AllowedOrigins": ["https://gamenode.app", "https://www.gamenode.app", "https://admin.gamenode.app"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

O upload atual passa pela API NestJS, que usa o SDK S3 no servidor. Não é necessário autorizar PUT público no navegador nem enviar credenciais R2 ao frontend. Para o mobile, conferir a origem efetiva do Capacitor antes de acrescentá-la à política, se necessário. CORS não transforma um bucket privado em público nem autentica usuários. Fonte: [CORS no R2](https://developers.cloudflare.com/r2/buckets/cors/).

### 5.4. Conectar o bucket privado ao Coolify

Em **Coolify → S3 Storage → New storage**:

| Campo | Valor |
| --- | --- |
| Nome | `R2 GameNode Backups` |
| Bucket | `gamenode-backups` |
| Protocol | `https` |
| Host | `ACCOUNT_ID.r2.cloudflarestorage.com`, conforme endpoint real, sem `https://` |
| Port / Path | Vazios para o endpoint padrão |
| Region | Usar o padrão indicado pela integração R2; clientes S3 podem exigir `auto` |
| Access Key / Secret Key | Credencial exclusiva do bucket de backups |

Executar **Validate Connection & Continue**. Depois selecionar esse destino em cada rotina de backup. Validar a conexão não cria automaticamente backups de todos os recursos. Fonte: [Cloudflare R2 no Coolify](https://coolify.io/docs/core/s3-storage/r2).

Para essa configuração manual de DNS e emissão HTTP-01, não é necessário um token de edição DNS na VPS. Se futuramente houver automação DNS ou desafio DNS-01, criar outro token, restrito à zona e às permissões necessárias; não reutilizar a credencial R2.

## 6. Ajustes obrigatórios no código/configuração de deploy

O `docker-compose.prod.yml` define os serviços de aplicação de produção, incluindo Directus e a inicialização da mídia. O MySQL **não** está nele: é um recurso gerenciado do Coolify, alcançado pela rede `gamenode` (destino dedicado do Coolify, separado da rede `coolify` onde ficam o painel, o PostgreSQL e o Redis internos do Coolify) no host informado em `DB_HOST`. Carregar esse arquivo do Git pelo build pack Docker Compose do Coolify; manter secrets e domínios no painel e registrar os passos necessários para recriar o ambiente. A consolidação não resolve sozinha as demais pendências desta seção.

| Achado | Ação antes do deploy |
| --- | --- |
| Orçamento de memória do Redis | **Aplicado:** 1 GiB para filas (`noeviction`, AOF) e 512 MiB para cache (`allkeys-lru`, sem persistência). `noeviction` recusa novas escritas ao encher; alertar antes disso |
| Volume do Redis de filas | **Aplicado:** volume em `/data`, caminho usado pela imagem oficial. O cache não tem volume |
| Imagens de Redis e backend | **Aplicado:** Redis com versão fixa; API e executor de migrations usam a tag imutável `lamarcke/game-node-server:1.9.1`. A cada release, publicar uma tag nova e atualizá-la no Compose; nunca sobrescrever uma tag publicada |
| Réplicas da API | **Aplicado:** uma réplica. Medir API, jobs e RAM antes de aumentar. Não aplicar o limite de heap da API como se fosse seu consumo total |
| MySQL compartilhado | Recurso gerenciado do Coolify, provisionado conforme a seção 6.3. O Compose não espera o banco: ele sobe antes, com o healthcheck do próprio recurso, e os serviços dependentes usam `restart`. Sem portas de banco publicadas |
| `SUPERTOKENS_CORE_URI` | **Aplicado:** `http://supertokens:3567`; testar autenticação no deploy |
| Variáveis do `server` | **Aplicado:** só chega ao container o que está em `environment:`. Foram incluídos `NODE_ENV=production`, `CONNECTION_CREDENTIAL_ENCRYPTION_KEY` (obrigatória) e `PLAYER_DATA_SYNC_ENABLED` (padrão `false`). Xbox OAuth fica de fora até a funcionalidade ser implementada. A `.env.example` também não lista todos os provedores de login/Twitch |
| Volume `/app/public/uploads` da API | **Removido:** nenhum código grava ali; uploads vão para o R2 |
| Redes externas e bind mounts precisam existir | Adaptar ao checkout/redes do Coolify; API, migrations, SuperTokens, Directus e Manticore entram também na rede externa `gamenode` para alcançar o MySQL gerenciado; a antiga rede `game_node_app_public` foi removida, porque o proxy do Coolify alcança os serviços com domínio por conta própria; garantir configurações Manticore, extensões Directus e `blog-media.cjs` no caminho esperado |
| API depende do volume público do CMS | O Compose cria `gamenode-blog-public-media` e aguarda `cms-media-init`; Directus escreve e API lê somente |
| `trust proxy` aceita apenas loopback, mas Traefik chega por bridge Docker; CORS reflete qualquer origem com credentials | Revisar proxies confiáveis, cabeçalhos/IP real, cookies e allowlist de origens. Testar web, admin e origens mobile antes da publicação |
| Dockerfiles dos clientes usam Node 20 | Atualizar para uma base LTS suportada, por exemplo Node 22, e validar os builds Next.js atuais |
| `.env.production` do admin sem `NEXT_PUBLIC_BLOG_CMS_URL` (conferido em 30/10/2026, clientes `f3df31d`; as URLs de servidor, busca, site e S3 estão corretas em web, admin e mobile) | **Aplicado:** `NEXT_PUBLIC_BLOG_CMS_URL=https://cms.gamenode.app`; refazer o build do admin, senão o link do CMS fica vazio |
| Pipeline atual publica no Docker Hub; PDF propunha GHCR | Escolher um registry. Pode-se manter Docker Hub na implantação inicial; GHCR exige alterar CI e credenciais, não acontece automaticamente |

Imagens selecionadas em 30/10/2026, alinhadas entre produção, desenvolvimento e os Composes de testes pertinentes:

- MySQL da aplicação, autenticação e CMS: `mysql:8.4.13`, na linha LTS 8.4.
- Redis cache e filas: `redis:8.10.3-alpine3.23`.
- Manticore: `manticoresearch/manticore:29.9.0`.
- SuperTokens MySQL: `registry.supertokens.io/supertokens/supertokens-mysql:10.1.4`, com CDI `5.3` compatível com o SDK atual; não trocar pela versão mais recente de outro backend de banco.
- Directus: manter `directus/directus:12.6.0`, já correspondente à versão estável publicada.
- Backend: `lamarcke/game-node-server:1.9.1`, definido diretamente no Compose para API e executor de migrations.

Os três databases usam a mesma instância MySQL gerenciada. `gamenode` e o usuário `DB_USER` são criados pelo Coolify ao criar o recurso; `supertokens`, `blog_cms` e seus usuários são criados uma única vez por `docker/mysql/init-databases.sh`, executado manualmente (seção 6.3). Usar `DB_USER` não-root, distinto de `SUPERTOKENS_DB_USER` e de `blog_cms`, e preencher os secrets de produção do `.env.example`. Alterar secrets depois não troca senhas já gravadas no MySQL. O desenvolvimento e os ensaios descartáveis mantêm MySQL próprio no Compose.

As tags foram conferidas nos registries dos fornecedores. Referências: [MySQL 8.4](https://dev.mysql.com/doc/relnotes/mysql/8.4/en/), [Redis](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/), [Manticore](https://manual.manticoresearch.com/Changelog), [SuperTokens MySQL](https://hub.docker.com/r/supertokens/supertokens-mysql/tags) e [Directus](https://github.com/directus/directus/releases).

Criar volumes novos para a instalação inicial. Essa seleção não autoriza substituir imagens sobre volumes locais existentes sem verificar a atualização de cada engine. O MinIO local passa a `bitnamilegacy/minio:2025.7.23-debian-12-r5`, limitado a desenvolvimento; não faz parte da infraestrutura de produção baseada em R2. Os resultados históricos de carga continuam documentando as versões em que foram medidos.

Na atualização anterior das imagens, os cinco arquivos Compose então existentes renderizaram; passaram 116 testes unitários de busca, 9 integrações de busca e 28 integrações IGDB nas novas versões. Em recursos descartáveis, SuperTokens criou usuário/sessão e revogou a sessão pelo SDK atual, Directus inicializou seu banco e autenticou/criou/leu conteúdo em MySQL 8.4.13, e MinIO provisionou o bucket e passou escrita/leitura/remoção via S3. Isso não valida a baseline completa da aplicação nem constitui deploy na VPS.

Na consolidação atual, passaram 25 testes focados no Compose e no script de inicialização. Um ensaio com volume vazio subiu Directus e SuperTokens reais na mesma instância MySQL; verificou criação dos três databases, senhas com caracteres especiais, negação de acesso cruzado e de acesso root por TCP, autenticação/criação de conteúdo no CMS e criação de usuário no SuperTokens. A mídia foi escrita pelo CMS e lida em montagem somente de leitura por um cliente mínimo com os mounts da API; esse cliente também verificou os nomes de rede. Reiniciar o MySQL e repetir o deploy preservou dados e credenciais nos três databases. O ensaio não iniciou a API GameNode nem validou a licença na URL definitiva. Esse ensaio usou o MySQL dentro do Compose, layout substituído pelo recurso gerenciado; o SQL do script é o mesmo, mas a execução manual no recurso gerenciado e o bloqueio de root por TCP (`MYSQL_ROOT_HOST=localhost`, não configurável no recurso) não foram ensaiados.

Fontes locais: [Compose de produção](../docker-compose.prod.yml), [inicialização MySQL](../docker/mysql/init-databases.sh), [bootstrap HTTP](../src/main.ts), [configuração Redis](../src/utils/getRedisConfig.ts) e [workflow atual](../.github/workflows/docker-build-push.yml). Para a base Node, conferir o [ciclo oficial de versões](https://nodejs.org/en/about/previous-releases).

### 6.1. Esquema inicial versionado

A baseline `src/migrations/1793500000000-InitialSchema.ts` cria o esquema completo (sem blog interno, sem armazenamento legado de notificações e sem o ledger de cutover) e a linha singleton de `igdb_catalog_state`. Ela foi capturada de um MySQL 8.4.13 descartável e comparada coluna a coluna, índice a índice e FK a FK com o resultado da cadeia histórica, que foi removida: `src/migrations/` tem um único conjunto versionado e o DataSource carrega `src/migrations/*.ts`. A validação em CI a partir de um clone limpo (criação em banco vazio e segunda execução sem pendências) ainda precisa ser configurada.

As entidades de estatísticas e de `importer_batch_effect` divergem do banco em FKs, índices e defaults, porque suas tabelas nasceram de SQL cru. Alinhar as entidades ao banco antes de gerar a próxima migration, senão o `migration:generate` traz esse ruído.

Referências locais: [blog/CMS](blog-cms.md), [notificações](notifications.md), [estatísticas](statistics.md), [sincronização de jogadores](player-data-imports.md) e [.gitignore](../.gitignore).

### 6.2. Criar no desenvolvimento, executar no servidor

**Executar uma migration versionada no servidor é recomendado; criá-la apenas nele não é o fluxo recomendado.** O arquivo precisa acompanhar o código, passar por revisão e ser reproduzível em outro ambiente. O TypeORM já instalado atende a isso; não é necessário acrescentar outra ferramenta.

Fluxo proposto:

1. No desenvolvimento, alterar as entidades e gerar a migration contra um banco descartável no estado da última release. Para a baseline inicial, usar banco vazio. Revisar SQL, nomes, índices e qualquer operação destrutiva antes de commitar.
2. No CI, aplicar as migrations em MySQL descartável na mesma versão de produção. Após a primeira release, testar também a atualização do esquema anterior com dados de teste. Publicar uma imagem imutável contendo o código e as migrations aprovadas.
3. No deploy, a migration roda **automaticamente**: o serviço `server_migration` do `docker-compose.prod.yml` executa `yarn migration:run` uma vez e termina (`restart: "no"`), e o `server` depende dele com `service_completed_successfully`. Assim existe **um único executor de migrations** por deploy, mesmo com várias réplicas da API; migrations nunca rodam no startup das réplicas. Sem migrations pendentes, o serviço termina na hora. A tag da imagem de `server_migration` é independente da do `server`. Com `restart: "no"`, o Coolify deixa o container encerrado fora do status da aplicação, que não fica "degradada".
4. Se a migration falhar, a API não sobe e o deploy aparece como falho no Coolify: inspecionar os logs do `server_migration` e o esquema antes de tentar de novo. Na primeira instalação, o mesmo deploy cria o esquema pela baseline e só então sobe a API. Depois que houver dados de produção, executar **Backup now** no MySQL antes de todo deploy que traga migration nova, porque ela roda sem intervenção.

Comandos já disponíveis para desenvolvimento, com `DB_*` apontando somente para o banco descartável:

```bash
yarn typeorm migration:generate ./src/migrations/DescribeChange -d ./data-source.ts
yarn migration:run
yarn typeorm migration:show -d ./data-source.ts
```

`InitialSchema` é a baseline; migrations seguintes devem descrever sua alteração.

O runner atual (`yarn migration:run`) usa TypeScript e o DataSource procura em `src/`; por isso o `server_migration` usa a imagem completa do backend, com o layout e as dependências do Dockerfile atual. Para uma imagem futura contendo somente o build, ajustar o DataSource para carregar entidades/migrations compiladas e executar a CLI JavaScript; apenas trocar o comando para `dist/` não basta. Ver [execução de migrations TypeORM](https://orkhan.gitbook.io/typeorm/docs/docs/migrations/05-executing).

Após haver dados em produção, manter migrations já aplicadas imutáveis. Para escalar com deploys graduais, adicionar primeiro tabelas/colunas compatíveis, publicar o código que as usa, preencher dados em lotes quando necessário e remover o esquema antigo somente em outra release, após retirar todos os consumidores antigos. Não há necessidade de preencher dados na instalação vazia.

No MySQL, DDL como `CREATE`, `ALTER` e `DROP` provoca commits implícitos; uma falha pode deixar parte da migration aplicada. Não confiar em uma transação TypeORM ou em `down` como recuperação automática. Durante o bootstrap sem dados, é possível recriar somente o banco novo confirmado como descartável; depois de receber dados, planejar correção e recuperação antes de mudanças destrutivas. Fonte: [commits implícitos no MySQL](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html).

### 6.3. MySQL gerenciado: provisionamento obrigatório em produção

**Executar uma única vez, antes do primeiro deploy do Compose.** Sem este passo, SuperTokens e Directus não sobem: os databases `supertokens` e `blog_cms` e seus usuários não existem.

1. **Criar o destino dedicado.** Em **Coolify → Servers → localhost → Destinations**, adicionar o destino `gamenode` (rede Docker `gamenode`). Usar esse destino no MySQL e na aplicação Compose; trocar o destino depois exige recriar o recurso. Não usar o destino padrão `coolify`, que expõe os containers internos do Coolify aos serviços do GameNode.

2. **Criar o recurso.** Em **Coolify → projeto GameNode → New Resource → Database → MySQL**, destino `gamenode`:

   | Campo | Valor |
   | --- | --- |
   | Image | `mysql:8.4.13` |
   | Initial database | `gamenode` |
   | Normal user / password | Os mesmos `DB_USER` / `DB_PASS` da aplicação |
   | Root password | Senha forte própria, guardada como secret de recuperação |
   | Make it publicly available | **Desligado** |

   Iniciar e aguardar o recurso ficar saudável pelo healthcheck do Coolify. O UUID do recurso é o nome do container e o hostname interno: usá-lo como `DB_HOST` na aplicação.

3. **Executar o script de provisionamento** (`docker/mysql/init-databases.sh`). Ele lê `MYSQL_USER` e `MYSQL_ROOT_PASSWORD` do próprio container e cria `supertokens`, `blog_cms`, o usuário `SUPERTOKENS_DB_USER` e o usuário `blog_cms`, cada um com acesso só ao próprio database. As senhas são as mesmas cadastradas como secrets da aplicação Compose.

   ```bash
   # Na máquina local, a partir da raiz do repositório
   scp docker/mysql/init-databases.sh gamenode-vps:/tmp/
   ssh gamenode-vps

   # Na VPS
   MYSQL_CONTAINER=UUID_DO_RECURSO_MYSQL   # conferir com: docker ps --filter name=UUID_DO_RECURSO_MYSQL
   export SUPERTOKENS_DB_USER=supertokens
   read -rsp 'SUPERTOKENS_DB_PASS: ' SUPERTOKENS_DB_PASS; echo; export SUPERTOKENS_DB_PASS
   read -rsp 'CMS_DB_PASSWORD: ' CMS_DB_PASSWORD; echo; export CMS_DB_PASSWORD
   docker exec -i -e SUPERTOKENS_DB_USER -e SUPERTOKENS_DB_PASS -e CMS_DB_PASSWORD \
     "$MYSQL_CONTAINER" bash -s < /tmp/init-databases.sh
   rm /tmp/init-databases.sh
   ```

   As senhas são lidas sem eco e passadas por nome em `-e`, sem aparecer no histórico nem na linha de comando. O script não é idempotente de propósito: numa segunda execução, `CREATE DATABASE` falha sem alterar usuários existentes. Nunca apagar o volume populado para executá-lo de novo.

4. **Conferir.**

   ```bash
   docker exec "$MYSQL_CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot \
     -e "SHOW DATABASES; SELECT user, host FROM mysql.user;"'
   ```

   Devem aparecer `gamenode`, `supertokens`, `blog_cms` e os usuários `DB_USER`, `SUPERTOKENS_DB_USER` e `blog_cms`.

5. **Configurar o backup** em **recurso MySQL → Backups**: destino `R2 GameNode Backups` (seção 5.4), seleção **All databases** (um único dump com os três databases e os usuários), frequência `0 */6 * * *` e retenção de 14 dias. Executar **Backup now** antes de cada migração. Ativar a notificação de falha de backup do Coolify. Validar com uma restauração em recurso descartável (seção 8).

6. **Configurar a aplicação Compose** no destino `gamenode`, com `DB_HOST` igual ao UUID do recurso. O `docker-compose.prod.yml` liga API, migrations, SuperTokens, Directus e Manticore à rede externa `gamenode`, onde o recurso está.

Limite conhecido: o recurso gerenciado não aplica `MYSQL_ROOT_HOST=localhost`. Root continua alcançável por TCP a partir dos containers do GameNode na rede `gamenode`; a proteção é a senha forte, a rede dedicada e a ausência de porta pública.

## 7. Variáveis, autenticação e builds

### 7.1. API no Coolify

Valores de conexão esperados, ajustando aliases às redes efetivamente criadas:

```dotenv
NODE_ENV=production
SERVER_PORT=5000
DOMAIN_API=https://server.gamenode.app
DOMAIN_WEBSITE=https://gamenode.app
DB_HOST=UUID_DO_RECURSO_MYSQL
DB_PORT=3306
DB_DATABASE=gamenode
DB_USER=USUARIO_DA_APLICACAO
DB_PASS=SEGREDO
REDIS_URL=redis://server-redis:6379
BULLMQ_REDIS_URL=redis://server-redis-bullmq:6379
SUPERTOKENS_CORE_URI=http://supertokens:3567
MANTICORE_URL=http://manticore:9308
BLOG_CMS_URL=http://blog-cms:8055
BLOG_CMS_PUBLIC_URL=https://cms.gamenode.app
BLOG_PUBLIC_MEDIA_PATH=/app/blog-public-media
PLAYER_DATA_SYNC_ENABLED=false
```

Acrescentar secrets de uploads, `CONNECTION_CREDENTIAL_ENCRYPTION_KEY`, `BLOG_CMS_DELIVERY_TOKEN`, `BLOG_CMS_PREVIEW_TOKEN`, os seis campos `PROVIDER_{GOOGLE,DISCORD,TWITTER}_CLIENT_{ID,SECRET}`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` e integrações utilizadas.

Os tokens de delivery e preview do blog devem ser distintos. Gerar a chave criptográfica nova antes de cadastrar conexões. Xbox OAuth ainda não está implementado e fica fora do Compose; quando estiver, acrescentar ao `server`: `XBOX_OAUTH_CLIENT_ID`, `XBOX_OAUTH_CLIENT_SECRET` e `XBOX_OAUTH_REDIRECT_URI=https://gamenode.app/connections/callback/xbox`; fornecer credenciais PSN/Xbox de serviço quando o código selecionado as usar.

`PLAYER_DATA_SYNC_ENABLED=false` serve para pausar refreshes automáticos de jogadores durante a validação inicial; **não desliga todos os workers nem a sincronização IGDB**. O IGDB atual começa automaticamente quando elegível. Planejar o primeiro start da API com migrations completas, credenciais válidas e recursos disponíveis para a carga inicial do catálogo.

Não acrescentar senha ao Redis e presumir que todas as conexões ficarão autenticadas: partes do código atual extraem apenas host/porta. Se autenticação Redis for adotada, adaptar e testar todos os consumidores antes. Enquanto isso, isolamento de rede e ausência de portas públicas são obrigatórios.

### 7.2. Web, admin e mobile

As variáveis públicas Next.js são incorporadas **no build**. Alterá-las somente no runtime do Coolify não atualiza o JavaScript já compilado.

| Variável | Web | Admin |
| --- | --- | --- |
| `NEXT_PUBLIC_DOMAIN_SERVER` | `https://server.gamenode.app` | Mesmo valor |
| `NEXT_PUBLIC_SERVER_URL` | `https://server.gamenode.app` | Mesmo valor |
| `NEXT_PUBLIC_SEARCH_URL` | `https://search.gamenode.app` | Mesmo valor |
| `NEXT_PUBLIC_DOMAIN_WEBSITE` | `https://gamenode.app` | `https://admin.gamenode.app` |
| `NEXT_PUBLIC_DOMAIN_MAIN_WEBSITE` | Se usada | `https://gamenode.app` |
| `NEXT_PUBLIC_S3_BUCKET_URL` | `https://s3.gamenode.app` | Mesmo valor |
| `NEXT_PUBLIC_BLOG_CMS_URL` | Se usada | `https://cms.gamenode.app` para o link editorial |

O mobile usa equivalentes `VITE_PUBLIC_*`; validar os contratos de busca, blog, notificações, estatísticas e autenticação da versão que será distribuída.

No CI, construir backend, web e admin dos SHAs aprovados, executar as verificações necessárias e publicar tags imutáveis/digests. Configurar acesso do Coolify ao registry, healthchecks e deploy controlado. O workflow atual da API dispara em release; os de web/admin são manuais. Automatizar o deploy ou manter o acionamento manual é uma decisão operacional explícita.

### 7.3. OAuth

Revisar callbacks nas contas Google/Discord/Twitter/X de acordo com o fluxo efetivo do SuperTokens e dos clientes. Não confundir o endpoint API `/v1/auth` com a página de retorno do navegador em `/auth/callback/...`.

Registrar as origens e callbacks exatos exigidos pelos fluxos usados no web e no admin; conferir também retorno mobile. Para Xbox conectado, manter o callback `/connections/callback/xbox`. Para Steam, conferir a origem/realm e o retorno usados pelo frontend. Manter os mesmos domínios reduz mudanças, mas não dispensa o teste de cookies, HTTPS e sessão entre web e admin.

Criar ou configurar os aplicativos OAuth para esta instalação; não há identidades antigas a preservar. No web, o `websiteBasePath` do SuperTokens varia com o locale, inclusive `/pt-BR/auth`; validar os callbacks efetivamente gerados nos idiomas suportados.

## 8. Backups recorrentes e recuperação

Backups passam a proteger os dados e configurações produzidos pela nova instalação. **Não existe backup antigo a restaurar nem ensaio de restauração como bloqueio para o primeiro deploy.** Configurar a rotina para operar desde a entrada em uso e agendar o primeiro ensaio com dados de teste após o provisionamento.

Política inicial proposta, em UTC, alinhada ao plano de continuidade:

| Ativo | Frequência | Destino e retenção |
| --- | --- | --- |
| MySQL gerenciado: `gamenode`, `supertokens` e `blog_cms` | `0 */6 * * *` e antes de migrações | Backup nativo do Coolify, **All databases**; R2 privado, 14 dias; coordenar `blog_cms` com os assets |
| Banco/configuração Coolify | Diário | Backup da instância + `.env`/`APP_KEY` e arquivos necessários fora da VPS |
| Redis BullMQ | Diário e antes de migrações | Cópia consistente do estado AOF/RDB; sem copiar AOF ativo de forma ingênua |
| Uploads R2 | Conforme perda aceitável; começar com cópia diária | Conjunto independente, privado, preservando objetos; não só o bucket público original |
| Assets privados e publicados Directus, uploads locais | Diário | Arquivo consistente com o DB correspondente, cifrado no R2 privado |
| Manticore | Guardar configuração; reconstruir do MySQL restaurado | Snapshot de índices é opcional se a reconstrução atender ao prazo de recuperação |

O MySQL é recurso nativo do Coolify justamente para usar o backup dele para o R2 (seção 6.3). Os Redis e volumes que continuam no Compose não têm esse backup na interface. **Não presumir que o backup da instância Coolify inclua os dados dos bancos/volumes da aplicação.** Fonte: [backup da instância](https://coolify.io/docs/core/backup-and-recovery/instance-backup) e [backups de bancos](https://coolify.io/docs/databases/backups).

No backup do MySQL, usar **All databases**; o padrão de copiar apenas `MYSQL_DATABASE=gamenode` deixaria autenticação e CMS sem cobertura. Coordenar os arquivos do CMS com o dump.

O antigo script `.infra/db_backup.sh` foi removido; o backup do MySQL é exclusivamente o do Coolify.

No bucket privado, criar prefixes/conjuntos separados por ativo e controlar retenção. Regras Lifecycle de expiração podem complementar a rotina, mas não devem apagar a única cópia de objetos ainda em uso ou uma baseline de recuperação guardada deliberadamente. Não aplicar expiração global de 14 dias ao bucket público de uploads. Fonte: [Lifecycle do R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

Guardar separadamente: `APP_KEY` do Coolify, chave de conexões da API, secrets necessários à recuperação, chaves SSH e senha de descriptografia. Configurar alertas de falha de backup, falha de envio ao R2, disco e memória. Um resultado local bem-sucedido não comprova cópia externa disponível.

Após o provisionamento, produzir um backup com dados de teste, baixá-lo do R2 e restaurar em recursos isolados. Conferir login, biblioteca, imagens, conteúdo e integridade dos dados criados no teste. Repetir um ensaio de recuperação mensal como rotina operacional. A meta inicial de perda de dados MySQL é até 6 horas, condicionada a backups íntegros; o prazo de recuperação só será conhecido após o ensaio. Snapshot do provedor é complementar.

## 9. Sequência de implantação

1. **Confirmar a base.** DNS e acesso ao Coolify pelo domínio já estão regularizados. Verificar os demais recursos da VPS e os controles de origem do painel. Escolher a release conjunta de backend/clientes e as versões dos serviços. Não há origem a inventariar ou restaurar.
2. **Preparar R2 e secrets.** Criar buckets vazios e credenciais, associar `s3.gamenode.app` e testar escrita S3 e leitura pública com um objeto de teste. Gerar a chave de conexões e os demais secrets. O upload pela API será testado quando ela estiver no ar.
3. **Corrigir os artefatos de deploy.** Preparar a baseline atual versionada e seu teste em banco vazio conforme a seção 6.1. Ajustar Redis/volumes/recursos, redes, imagens e variáveis. Produzir builds imutáveis no CI. O executor único de migrations é o serviço `server_migration` do Compose (seção 6.2).
4. **Criar recursos privados no Coolify.** Criar o MySQL gerenciado, executar o provisionamento e configurar o backup (seção 6.3). Depois, implantar pelo Compose Redis cache/filas vazios, SuperTokens, Directus, redes e volumes novos. Manter a API parada até a baseline estar pronta. Configurar limites, healthchecks e backups recorrentes. Somente serviços que recebem HTTP público entram no proxy; não publicar portas de banco.
5. **Criar o esquema no primeiro deploy do Compose.** O `server_migration` aplica a baseline e a API só sobe depois que ele termina com sucesso (seção 6.2). Conferir nos logs dele o sucesso e a ausência de migrations pendentes. Não executar cutover de notificações, importar dumps ou fornecer referências fictícias de backup.
6. **Provisionar o Directus.** Criar modelo/contas com `setup.py`, `model-constraints.sql` e `provision-readers.py`. Validar licença na URL definitiva, políticas editoriais e tokens distintos. O Compose gerencia o volume público compartilhado com a API. Ver [deploy CMS](blog-cms.md) e [licenciamento Directus](https://directus.io/docs/licensing/overview).
7. **Subir Manticore, API e clientes em validação controlada.** Uma réplica inicial, refreshes de jogadores pausados quando aplicável. Conferir o início automático do IGDB interno com `yarn igdb:catalog status`. Após a carga inicial, executar e validar a indexação sem esperar pelo cron; conferir jogos às 03:00 UTC e usuários a cada hora. Busca vazia antes de importar o catálogo não indica perda de dados.
8. **Configurar hosts e TLS no proxy.** Web em 3000, API/busca em 5000, admin em 3000, CMS em 8055. Configurar pelo campo **Domains** de cada serviço; nenhum serviço publica porta no host. Confirmar no primeiro domínio que o proxy do Coolify alcança serviços no destino `gamenode`. Manter o MySQL compartilhado apenas na rede privada, com isolamento de permissões entre databases.
9. **Publicar os demais serviços e abrir o acesso.** Completar a tabela de registros, certificados, proxy laranja, Full (strict), proteção editorial e bypass de cache, preservando o acesso ao Coolify já configurado. `search` deve encaminhar POST e corpo diretamente para a API, sem 301/302 de migração. Validar criação de contas, login, conteúdo, uploads e busca no web/admin/mobile e nos dois domínios da API/busca.
10. **Ativar rotinas e observar.** Liberar refreshes de jogadores após os smokes e confirmar jobs, backups externos e alertas. Registrar a release inicial e agendar o ensaio de recuperação com dados de teste como rotina operacional, sem depender de backups anteriores.

## 10. Critérios para considerar a implantação concluída

- [x] Zona Cloudflare ativa e bloqueio de DNS resolvido; acesso a `coolify.gamenode.app` protegido pelo Access e confirmado pelo responsável.
- [ ] Demais hostnames da aplicação configurados e resolvendo corretamente, sem `SERVFAIL`.
- [ ] Certificados válidos para web, API, busca, admin, CMS e uploads; sem loops HTTPS.
- [ ] `/v1/health` saudável; web/admin carregam sem erros de assets ou configuração de build.
- [ ] Login social, sessão, logout e permissões testados no web/admin; Xbox/Steam e mobile verificados quando utilizados.
- [ ] MySQL gerenciado provisionado pelo script da seção 6.3; backup **All databases** para o R2 executado e restaurado em recurso descartável.
- [ ] Esquema criado em banco vazio pela baseline versionada, sem migrations pendentes ou cutover legado.
- [ ] Carga inicial IGDB e indexação verificadas; criação de perfil, coleção e biblioteca testada com contas novas.
- [ ] Busca por ambos os caminhos/hostnames funciona com POST e CORS.
- [ ] Upload autenticado chega ao R2 e a imagem abre no domínio público.
- [ ] CMS publica artigo e imagem; visitante não consegue acessar drafts, tokens ou assets privados.
- [ ] Notificações/estatísticas/clientes correspondem à mesma versão de contrato.
- [ ] Filas persistem após reinício sem duplicação indevida; cache não remove jobs; limites de memória são compatíveis com a VPS.
- [ ] Nenhum MySQL, Redis, Manticore ou SuperTokens está exposto em porta pública; dashboards técnicos têm controle de acesso e proteção contra acesso direto à origem.
- [ ] Backups recorrentes configurados e chaves guardadas separadamente; ensaio de recuperação agendado como rotina operacional.
- [ ] Alertas e responsável operacional definidos.

Durante o bootstrap, antes de receber dados que precisem ser preservados, pode-se corrigir a baseline e recriar somente os recursos novos confirmados como descartáveis. Depois da entrada em uso, rollback por imagem anterior só é seguro se o esquema permanecer compatível. Restaurar um dump anterior descartaria gravações posteriores; priorizar uma migration corretiva e planejar a recuperação quando necessária.

## 11. Base da análise e limites

Foram lidos o Compose, Dockerfile, workflows, migrations, serviços de auth/upload/Redis e os runbooks do backend, além dos Dockerfiles, variáveis públicas e configurações dos clientes web/admin/mobile. Referências de checkout: backend `b704de9`, clientes `1ef73ca`. As observações de arquivos locais ignorados são adicionais a esses commits.

O PDF fornecido orientou a arquitetura, mas a contratação atual é diferente do exemplo de 8 GB/100 GB e o código atual inclui Directus e Redis separados. A situação da VPS foi consultada por SSH. Consultas posteriores por DNS-over-HTTPS na Cloudflare e no Google confirmaram a resolução de `coolify.gamenode.app`, e a consulta HTTPS confirmou o redirecionamento para o login do Access. O responsável confirmou a ativação da zona e o funcionamento do painel após configurar o domínio.

Não houve acesso autenticado à Cloudflare, registrador, R2 ou registry. Não foram confirmados buckets, licença na conta, callbacks atuais ou imagens publicadas. As telas citadas podem variar conforme idioma e atualizações do painel.

O relatório contempla a implantação do zero, o fluxo recomendado de migrations e a atualização das imagens dos Composes; a baseline não está implementada. Esta atualização documental registra o bloqueio de DNS como resolvido e o acesso ao Coolify confirmado pelo responsável; não executou deploy na VPS, migrações de produção ou mudanças DNS/R2, nem refez consultas à VPS/DNS. Em 30/10/2026 decidiu-se usar o MySQL gerenciado do Coolify em produção, pelo backup nativo para o R2 (seção 6.3). As pendências para publicar são: confirmar os demais recursos da VPS e os controles de origem do painel, disponibilizar o bootstrap versionado e testado em banco vazio, concluir as correções dos artefatos de deploy e configurar serviços/secrets e os demais hostnames. Não há bloqueio de restauração de backup ou recuperação de dados antigos.
