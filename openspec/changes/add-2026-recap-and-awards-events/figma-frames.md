# 2026 Recap and Awards — Figma frame appendix

Appendix to `handoff-clients.md`. Read-only verification of the Figma canvas against the current
server code. It adds frame ids, frame names, section-level data maps and concrete gaps. It does not
replace the contract in `handoff-clients.md`; that document links this appendix as its design source,
and where the two disagree the handoff is the contract while this appendix records the difference
under [Real gaps](#real-gaps).

Figma file `ikcThguwowTdynGz0L2YkS` (the same file used by the client navigation design) contains
this 2026 events canvas at `5407:677`.

- Figma file: [GameNode, node `5407:677`](https://www.figma.com/design/ikcThguwowTdynGz0L2YkS/GameNode?node-id=5407-677)
- Canvas: `5407:677` — "Eventos 2026 · Retrospectiva + Awards"
- Figma session used for the read: `d0ee9a34-c289-474a-b3dc-320416f0cd6a` (created for this task; the
  session id supplied by the parent was rejected by the Figma MCP and was not reused)
- The only node id below that is not a canvas node is `5202:2233`, the topbar notification button
  returned by the Home design context (design-system component).
- Design reads on 2026-11-15: `get_metadata` for the canvas plus `get_design_context` for 33 nodes
  (all product screens and the Dock/Home entry frames). Source reads: CodeGraph and the current files
  under `src/`. No Figma write and no production-code change.

## What the canvas contains

The canvas declares **10 product screens in two sections, plus the component library** (`5409:773`,
row "10 telas em 2 seções, mais a biblioteca"):

| # | Screen | Figma node | Frame name | Status |
| --- | --- | --- | --- | --- |
| 1 | Recap web | `5415:922` | Retrospectiva 2026 — Web 1440 | Mapped |
| 2 | Story 1 | `5413:862` | Story 1 — 412 horas | Mapped |
| 3 | Story 2 | `5413:917` | Story 2 — Jogo do ano | Mapped |
| 4 | Story 3 | `5414:911` | Story 3 — Março | Mapped |
| 5 | Story 4 | `5413:945` | Story 4 — Opinião minoritária | Mapped |
| 6 | Story 5 | `5413:983` | Story 5 — Seu ano em um card | Mapped |
| 7 | Ballot web | `5410:689` | Awards 2026 — Cédula · Web 1440 | Mapped |
| 8 | Results web | `5410:888` | Awards 2026 — Resultado · Web 1440 | Mapped |
| 9 | Ballot mobile | `5412:845` | Awards 2026 — Cédula · Mobile 390 | Mapped |
| 10 | Results mobile | `5412:935` | Awards 2026 — Resultado · Mobile 390 | Mapped |

The canvas also has the entry system (Home, Dock, flow), the cover/concept frame and the component
library. Those are listed below; they are not counted among the 10 product screens.

There is **no frame** for: the Awards nominations screen (the flow marks it "A desenhar"), a
dedicated scoreboard page, or a notifications inbox. Those are gaps, not hidden frames.

Task 8.1 checklist:

| Required surface | Mapped in | Status |
| --- | --- | --- |
| Home event cards per phase | [Home event cards](#home-event-cards-by-phase-and-dead-periods) | Mapped, including dead periods |
| Dock | [Dock](#dock) | Mapped, option A recommended |
| Recap web sections | [Recap web](#recap-web-5415922) | Mapped |
| Five stories | [The five stories](#the-five-stories) | Mapped, exact frame names/ids |
| Ballot web and mobile | [Awards ballot](#awards-ballot-web-and-mobile) | Mapped |
| Results and scoreboard | [Awards results](#awards-results-and-scoreboard) | Mapped; no dedicated scoreboard frame |
| Notifications | [Notifications](#notifications) | Mapped; no inbox frame |

## Frame inventory (every top-level frame/symbol on the canvas)

Nested layers inside a screen (individual nominee cards, winner cards, day cells, buttons) are not
separate screens; the section tables below map their data. The inventory covers every top-level
frame/symbol plus the named sub-screens of the entry flow.

| Section | Node | Type | Name | Surface / use |
| --- | --- | --- | --- | --- |
| `5407:710` 00 · Capa & Conceito | `5409:688` | frame | GameNode 2026 — Capa & Conceito | Cover, phase calendar, rationale, screen index. Not a product screen. |
| `5407:711` 01 · Retrospectiva 2026 | `5415:922` | frame | Retrospectiva 2026 — Web 1440 | Product screen 1. |
| | `5408:829` | frame | Story Top | Five story-top components (`Step=1`…`Step=5`): `5408:769`, `5408:781`, `5408:793`, `5408:805`, `5408:817`. Not a screen. |
| | `5413:862` | frame | Story 1 — 412 horas | Product screen 2. |
| | `5413:917` | frame | Story 2 — Jogo do ano | Product screen 3. |
| | `5414:911` | frame | Story 3 — Março | Product screen 4. |
| | `5413:945` | frame | Story 4 — Opinião minoritária | Product screen 5. |
| | `5413:983` | frame | Story 5 — Seu ano em um card | Product screen 6. |
| `5407:712` 02 · Awards 2026 | `5410:689` | frame | Awards 2026 — Cédula · Web 1440 | Product screen 7. |
| | `5410:888` | frame | Awards 2026 — Resultado · Web 1440 | Product screen 8. |
| | `5412:845` | frame | Awards 2026 — Cédula · Mobile 390 | Product screen 9. |
| | `5412:935` | frame | Awards 2026 — Resultado · Mobile 390 | Product screen 10. |
| `5407:713` 03 · Componentes & Assets | `5407:714` | frame | `_assets · capas (IGDB) usadas como fill` | Cover assets. Client uses game repository covers. |
| | `5408:677` | symbol | Brand/Wordmark | Brand asset. |
| | `5408:685` | frame | Button | `Type=Primary` `5408:679`, `Secondary` `5408:681`, `Ghost` `5408:683`. |
| | `5408:695` | frame | Chip | `Tone=Brand` `5408:686`, `Played` `5408:689`, `Neutral` `5408:692`. |
| | `5408:716` | frame | Nominee Card | `State=Default` `5408:696`, `Selected` `5408:704`. |
| | `5408:731` | frame | Category Row | `State=Active` `5408:717`, `Voted` `5408:721`, `Pending` `5408:727`. |
| `5438:1294` 04 · Entrada | `5438:1295` | symbol | Icons/Nav/awards | New Dock icon. |
| | `5438:1302` | symbol | Icons/Nav/recap | New Dock icon. |
| | `5438:1308` | symbol | Icons/Nav/events | New Dock icon (option B only). |
| | `5440:1294` | frame | 04.2 · Dock — opções de entrada | Dock options A/B/C. |
| | `5444:2410` | frame | Home/Event Card | 15 card variants. |
| | `5445:1844` | frame | Home · Web 1440 · 15 nov (Indicações + Retrospectiva) | Home with two Half cards. |
| | `5445:2032` | frame | Home · Mobile 390 · 15 nov | Home carousel. |
| | `5445:9135` | frame | 04.1 · Fluxo até os eventos | Entry flow, display calendar, implementation notes. |

## Home event cards by phase and dead periods

Source of the phase display rules: `5445:9135`, "calendário de exibição" (`5445:9262`) and "notas de
implementação" (`5445:9367`). The rule is: **show the Awards card only while there is something to
do**. There is no Awards card in the dead periods 17–30 Nov and 21–26 Dec.

### Card variants present in Figma

| Design phase | Wide | Half | Mobile | Copy and data shown |
| --- | --- | --- | --- | --- |
| Awards · Indicações | `5444:1840` | `5444:2034` | `5444:2218` | "Awards 2026 · Indicações abertas"; "Quais foram os jogos do ano?"; "Indique até 3 jogos por categoria…"; chip "Fecha amanhã"; "Indicar jogos", "Ver categorias"; "+1000 XP e medalha por participar". |
| Awards · Votação | `5444:1886` | `5444:2077` | `5444:2261` | "Awards 2026 · Votação aberta"; "Faltam 5 categorias na sua cédula"; "Você jogou 4 dos 6 indicados a Jogo do Ano…"; chip "Fecha em 5 dias"; "Sua cédula 7 de 12 categorias"; "Continuar votando", "Ver cédula". |
| Awards · Resultado | `5444:1922` | `5444:2110` | `5444:2295` | "Awards 2026 · Resultado"; "Resident Evil Requiem é o Jogo do Ano"; "4.812 votos em 12 categorias. Você acertou 7 de 11."; "Ver vencedores", "Compartilhar". |
| Retrospectiva · Atualizando | `5444:1945` | `5444:2133` | `5444:2319` | "412 h"; "em 38 jogos · até hoje"; monthly strip; "Seu 2026 até agora"; "Nioh 3 ficou com 21% do seu ano…"; "Ver minha retrospectiva", "Compartilhar". |
| Retrospectiva · Fechada | `5444:1991` | `5444:2177` | `5444:2366` | "412 h"; "em 38 jogos · 2026 fechado"; "Seu 2026 fechou. Bora compartilhar?"; "412 horas, 38 jogos e 14 zerados, em 5 stories prontas para postar."; "Ver stories", "Baixar card". |

There are **no** card variants for `upcoming`, `nominations_closed`, `voting_closed`, a Recap that has
not opened, or the post-27-Jan result state. The design hides the cards in those windows instead.

### Period map

Dates below are the design's example dates. The real 2026 dates are admin data; map by `phase` and
the event's stored dates, never by the literal day numbers.

| Design period | Awards phase (API) | Home web | Home mobile | Dock | Notification | Reads |
| --- | --- | --- | --- | --- | --- | --- |
| Before 3 Nov | `upcoming` (with nominations) or `upcoming` (legacy) | No event card (design has no pre-3 Nov state) | No event card | Normal | None | `EVENT_CURRENT` returns 404; `EVENTS` if a future-card is ever wanted |
| 3–14 Nov | `nominations` | Awards · Indicações (Wide) | Awards · Indicações | Awards "Ao vivo" | "Indicações abertas" (3 Nov) | `EVENT_CURRENT` + `CATEGORIES` + `NOMINATIONS_ME` (auth) + `GAME_REPO` |
| 15–16 Nov | `nominations` (until end date) + Recap `live` | Awards · Indicações + Retrospectiva · Atualizando (Half + Half) | Carousel : Awards, Retrospectiva | Awards "Ao vivo" · Retrospectiva "Nova" | "Sua retrospectiva chegou" (15 Nov) · "Indicações fecham amanhã" | `EVENT_CURRENT`, `NOMINATIONS_ME`, `RECAP_CURRENT`, `RECAP_STATUS`, `RECAP` |
| 17–30 Nov | `nominations_closed` | **No Awards card**; Retrospectiva · Atualizando (Wide) | Retrospectiva | Awards without badge · Retrospectiva | None | `RECAP` only for the card |
| 1–20 Dec | `voting` | Awards · Votação + Retrospectiva · Atualizando (Half + Half) | Carousel : Awards, Retrospectiva | Awards "Ao vivo" | "Votação aberta" (1 Dec) · "Faltam 2 dias" (18 Dec, incomplete ballot only) | `EVENT_CURRENT`, `BALLOT`, `CATEGORIES` for the GOTY name/flag, `RECAP` |
| 21–26 Dec | `voting_closed` | **No Awards card**; Retrospectiva · Atualizando (Wide) | Retrospectiva | Awards without badge | None | `RECAP` only for the card |
| 27–31 Dec | `results` | Awards · Resultado + Retrospectiva · Atualizando (Half + Half) | Carousel : Awards, Retrospectiva | Awards "Novo" | "Saiu o resultado" (27 Dec) | `EVENT_CURRENT`, `RESULTS`, `SCOREBOARD`, `RECAP` |
| 1–27 Jan | `results` | Awards · Resultado + Retrospectiva · Fechada (Half + Half) | Carousel : Awards, Retrospectiva | Awards until 27 Jan · Retrospectiva in place of Wrapped | "Seu 2026 fechou" (1 Jan) | `EVENT_CURRENT`, `RESULTS`, `SCOREBOARD`, `RECAP` |
| 28 Jan onward | `results` (API keeps returning it) | **No event card**; normal Home | Normal Home | Normal Dock (Wrapped returns; Retrospectiva moves to profile) | None | None for the event surfaces |

The design's "Depois de participar" note (`5445:9374`) says a completed ballot removes the Awards
card from the top and it returns in the result phase. The server has no "ballot completed" field on
the event read; the client needs `BALLOT` (auth) to decide this.

### Home layout frames

| Frame | Node | Content | Reads |
| --- | --- | --- | --- |
| Home · Web 1440 · 15 nov | `5445:1844` | "Buscar jogos"; "Acontecendo no GameNode"; `duo` `5445:1850` with two Half cards (`5445:1851`, `5445:1894`); "Em alta"; the rest of the Home; option A collapsed Dock; topbar with bell count | `EVENT_CURRENT`, `CATEGORIES`/`NOMINATIONS_ME`, `RECAP_CURRENT`/`RECAP`, `INBOX.unreadCount`, `GAME_REPO` |
| Home · Mobile 390 · 15 nov | `5445:2032` | Top bar; "Buscar jogos"; "Eventos · carrossel" (`5445:2041`) with 300 px cards and peek; pagination; "Em alta" | Same reads; the carousel is client layout |

The card master is `5444:2410`; the 15 variants are listed above. The Home frame's topbar is the
existing shell (`Topbar/Bar`), not a new endpoint.

### Field map for the cards

| Card value | Source field |
| --- | --- |
| Event/year/phase/dates | `EVENT_CURRENT`: `year`, `phase`, `nominationStartDate`, `nominationEndDate`, `votingStartDate`, `votingEndDate`, `resultsDate`, `eligibilityCutoffDate`, `categoriesCount` |
| "12 categorias" / category names | `categoriesCount` (current event) or `BALLOT.categoriesTotal`; names from `CATEGORIES` |
| Nominations progress/picks | `NOMINATIONS_ME`: `categoryId`, `gameIds`; `CATEGORIES.suggestions` for the nominee state; `PUT` to save |
| Ballot progress | `BALLOT.categoriesVoted`, `BALLOT.categoriesTotal` |
| "Você jogou 4 dos 6 indicados a Jogo do Ano" | The GOTY category's `playedNomineesCount` and `nominees.length` from `BALLOT`; identify the GOTY category with `CATEGORIES.isGOTY` (not in `BALLOT`) |
| Winner and votes | `RESULTS` item whose `category.isGOTY` is true: `category`, `totalVotesCount`, `winners[position = 1].gameId` |
| "Você acertou 7 de 11" | `SCOREBOARD.totals.hits`, `SCOREBOARD.totals.scorable` |
| Recap card gate | `RECAP_STATUS.isRecapCreated` and `isRecapEligible`; do not call `RECAP` when `isRecapCreated` is false |
| Recap hours/games/finished | `RECAP.totalPlaytimeSeconds`, `RECAP.topGames.length`, `RECAP.totalFinishedGames`; use `topGames.length`, not `totalPlayedGames` |
| Recap monthly strip | `RECAP.calendar.monthlyPlaytimeSeconds` |
| "Nioh 3 ficou com 21% do seu ano" | `RECAP.topGames[0].share` and `topGames[0].gameId` |
| "5 stories" | Client constant (the server does not return a story list or story count) |
| Game cover/name/developer/platform | `GAME_REPO` by game id |

## Dock

The canvas recommends **Option A** (`5440:1300`, "Recomendada"): Awards goes into "Descobrir", the
Recap takes the place of Wrapped in "Seu espaço". The season is 3 Nov–31 Jan; outside it the Dock is
normal and Wrapped returns.

| Option | State | Node | Item labels / badges |
| --- | --- | --- | --- |
| A | Open | `5440:1484` | "Awards 2026" + "Ao vivo"; "Retrospectiva" + "Nova"; existing "Daily Nodes" + "Novo" |
| A | Collapsed | `5440:1685` | Same items, icon-only |
| B | Open | `5440:1897` | "Eventos 2026" (count) + "Wrapped" |
| B | Collapsed | `5440:2044` | Same, icon-only |
| C | Open | `5440:2208` | New group "Temporada 2026" with "Awards 2026" + "Retrospectiva" |
| C | Collapsed | `5440:2452` | Same, icon-only |

Option A data sources:

| Dock element | Source |
| --- | --- |
| Awards entry and phase | `EVENT_CURRENT` (or `EVENTS` for a future event). Visible from the first phase through 27 Jan in the design. |
| Awards badge "Ao vivo" / "Novo" | Client-local badge, driven by `phase` (`nominations`/`voting` → live; `results` → new). The server has no badge state. |
| Recap entry and phase | `RECAP_CURRENT` (`year`, `phase`, `opensAt`, `closesAt`) and `RECAP_STATUS` for a specific user/year. |
| Recap badge "Nova" | Client-local; hide after the first visit. |
| Notifications | Not a Dock item in the design; the bell is in the topbar (`5202:2233` in the design context) and uses `INBOX.unreadCount`. |
| Winter season boundary | Client rule from the event/recap dates. The server has no "Dock season" field. |

Option B would require a client-only hub route (`/eventos/2026`); there is no server hub endpoint. It
can compose `EVENT_CURRENT` + `RECAP_CURRENT`. Option C is only a different grouping of the same two
entries. Neither option adds a server endpoint.

Logged out: the public Awards entry may remain. The personalized Recap/notification entries must be
hidden or replaced by a sign-in CTA; `RECAP_STATUS` needs a `userId`, and `INBOX` returns 401 without a
session.

## Recap web (5415:922)

One public `RECAP` call supplies the screen data. Additional reads are the profile read for the hero
name/avatar, the goal read (session), and the Awards cross-link composition (`EVENT_CURRENT` +
`BALLOT` + `CATEGORIES`). The Awards CTA is not part of the Recap payload.

| Section | Node | Visible copy | Fields | Notes |
| --- | --- | --- | --- | --- |
| Page header | `5429:947` | "Eventos 2026" · "Retrospectiva" · "Awards" | none | Segmented navigation; no API. |
| 01 Hero | `5415:923` | "Retrospectiva 2026 · @marinacosta"; "412 horas de jogo."; "Marina, você jogou 38 jogos e zerou 14…"; "Seu ano em 38 nós"; legend "Tamanho = horas no jogo" / "Atualiza todo dia até 31 dez"; "Hoje · 15 nov" | `year`, `profileUserId`, `totalPlaytimeSeconds`, `topGames.length`, `totalFinishedGames`, `calendar.monthlyPlaytimeSeconds`, `topGames[0..3]` (`gameId`, `totalPlaytimeSeconds`), `dailyPlaytimeSeconds` | The narrative sentence is client copy; the server has no narrative field. The "until today" data is `updatedAt`/generation time, not a dedicated `dataThrough`. Profile name/avatar via the existing profile read. |
| 02 Jogo do ano | `5417:941` | "Mais jogado em 2026"; "Nioh 3 ficou com 21% do seu ano."; "86 h jogadas"; "14 mar zerado, no difícil"; "9,0 sua nota"; "Seu top 5 por horas" | `topGames[0]`: `gameId`, `totalPlaytimeSeconds`, `share`, `finishedAt`, `rating`; `topGames[0..4]` and `platformIds` | "no difícil" has no provider field and is excluded by the proposal. Platform names come from `playedGames[].platform` or existing platform data; `topGames` only carries ids. |
| 03 Calendário | `5418:941` | "Calendário de jogo"; "Março foi o seu mês: 71 horas."; "Cada quadrado é um dia…"; "71 h em março…"; "23 dias seguidos…"; "Sábado é o seu dia: 31% das suas horas caíram no fim de semana" | `calendar.monthlyPlaytimeSeconds`, `calendar.topMonth` (`month`, `playtimeSeconds`), `calendar.longestStreak` (`start`, `end`, `days`), `calendar.topWeekday` (`weekday`, `share`), `calendar.weekendShare`, `dailyPlaytimeSeconds` | Use `topWeekday.weekday` for "Sábado" and `weekendShare` for "31% … fim de semana"; they are different fields. The daily array is UTC and has 365/366 entries. |
| 04 Você vs. comunidade | `5419:941` | "Você vs. comunidade GameNode"; "Marathon dividiu você e a comunidade."; "Opinião minoritária"; "Você 9,0"; "Média 6,4"; "Só 12% de quem avaliou deu 9 ou mais."; "Em sintonia"; "Você 9,5"; "Média 9,3"; "Você e mais 2.140 pessoas no mesmo tom."; "Gêneros" percentages; "Plataformas" percentages/hours | `communityHighlights.minority` and `.inTune`: `gameId`, `userRating`, `communityAverage`, `reviewCount`, `beyondShare`, `sameRangeCount`; `distributionByGenre` (`criteriaName`, `count`, `finishedCount`); `playtimeByPlatform` (`platform`, `totalPlaytimeSeconds`, `share`) | `communityHighlights` is stored at generation and can be `null` for old Recaps. Genre percentages are not returned as shares; derive them from the counts. Platform names must be resolved from platform data; `playtimeByPlatform` carries the numeric id. |
| 05 Backlog e próximo passo | `5420:945` | "Backlog"; "Você adicionou 52 jogos e zerou 14."; "O backlog cresceu 32…"; "14 zerados"; "6 abandonados"; "32 na fila"; "Awards 2026 · votação aberta"; "Você jogou 4 dos 6 indicados a GOTY."; "Suas notas de 2026 já aparecem na cédula…"; "Abrir minha cédula"; "Meta para 2027"; "Zerar 18 jogos, 4 a mais que em 2026."; "A gente te lembra em julho…"; "Salvar meta" | `totalAddedGames`, `totalFinishedGames`, `totalDroppedGames`, `backlogGrowth`; `GOAL_GET` (`target`, `finished`); `BALLOT` for the GOTY count; `CATEGORIES` for the GOTY flag; `EVENT_CURRENT` for the awards phase | The Recap response has no awards CTA data and no "target compared to last year" field. The CTA is a composition of `EVENT_CURRENT` + `BALLOT` + `CATEGORIES`; "4 a mais que em 2026" is `target - 2026.totalFinishedGames`. |
| Footer | `5420:945` | "De 1 jan a 15 nov de 2026 · Horas de PSN, Steam e Nintendo conectados · Atualiza todo dia até 31 dez" | No source field for the connected-source list; `updatedAt` is the generation timestamp; `isFinal`/`phase` for the close state | The owner's connected sources come from the existing connections endpoints; a logged-out shared Recap cannot show them (documented limitation). Do not derive the sources from `playedGames` (that lists platforms, not providers). |

## The five stories

All five read the same public `RECAP` response. There is no story-specific endpoint and no server-side
image. Story order from the cover index (`5409:773`): Abertura, jogo do ano, calendário, contra a
maioria, card final.

| # | Figma frame | Node | Copy | Fields | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Story 1 — 412 horas (Abertura) | `5413:862` | "Sua retrospectiva 2026"; "412 horas de jogo."; "38 jogos, 14 zerados e um ano que coube em 38 nós."; months; "1 / 5 · toque para seguir"; "Compartilhar" | `totalPlaytimeSeconds`, `topGames.length`, `totalFinishedGames`, `calendar.monthlyPlaytimeSeconds`, `topGames[0..3]` | "38 jogos"/"38 nós" = distinct games, so use `topGames.length`; `totalPlayedGames` counts source/platform rows and can be larger. |
| 2 | Story 2 — Jogo do ano | `5413:917` | "Mais jogado em 2026"; "Nioh 3"; "86 horas, 21% do seu ano. Zerado em 14 de março, no difícil."; "2 / 5…" | `topGames[0]`: `gameId`, `totalPlaytimeSeconds`, `share`, `finishedAt`, `rating` | "no difícil" unavailable (proposal exclusion). |
| 3 | Story 3 — Março (Calendário) | `5414:911` | "Calendário de jogo"; "Março foi o seu mês."; "71 h no mês"; "23 dias seguidos"; "Sábado seu dia"; "3 / 5…" | `calendar.topMonth`, `calendar.longestStreak`, `calendar.topWeekday`, `calendar.weekendShare`, `dailyPlaytimeSeconds` (March slice) | The card shows a March calendar; slice the daily array. The "31% weekend" copy is not in the story frame but in the web section; use `weekendShare`. |
| 4 | Story 4 — Opinião minoritária (Contra a maioria) | `5413:945` | "Opinião minoritária"; "Em Marathon, você foi contra a maioria."; "9,0 Sua nota"; "6,4 Média da comunidade"; "Só 12% de quem avaliou deu 9 ou mais. Em Resident Evil Requiem… 9,5 contra 9,3."; "4 / 5…" | `communityHighlights.minority` and `.inTune`: `gameId`, `userRating`, `communityAverage`, `reviewCount`, `beyondShare`, `sameRangeCount` | `beyondShare` is 0–1; multiply by 100 for the copy. The in-tune sentence uses `sameRangeCount` (2,140). |
| 5 | Story 5 — Seu ano em um card (Card final) | `5413:983` | "Seu ano em um card"; "@marinacosta"; "412 h em 2026"; "38 jogos"; "14 zerados"; "Março mês mais intenso"; "Nioh 3 jogo do ano"; "Compartilhar nos stories"; "Votar no Awards 2026"; "Você jogou 4 dos 6 indicados a GOTY." | `profileUserId` (profile read for @), `totalPlaytimeSeconds`, `topGames.length`, `totalFinishedGames`, `calendar.topMonth`, `topGames[0]`; `BALLOT` + `CATEGORIES` for the GOTY count | The story card is client-rendered; no server image. The GOTY count needs the global GOTY category flag, which `BALLOT` does not return. The "Votar no Awards 2026" CTA is only actionable in `voting`; hide or sign-in-gate it otherwise. |

## Awards ballot (web and mobile)

Both sizes use the same authenticated `BALLOT` response. There is no mobile-specific endpoint or
summary shape. The design's category 01 is "Jogo do Ano" (global GOTY) and category 12 is "Seu GOTY
pessoal"; the server's order is the reverse (personal order 0, global order 1) — see gaps.

| Block | Web node | Mobile node | Visible copy | Fields |
| --- | --- | --- | --- | --- |
| Page header | `5429:1156` | mobile top bar | "Eventos 2026" · "Awards" · "Retrospectiva"; "Sua cédula" | none (navigation) |
| Event band | `5410:708` | — | "GameNode Awards 2026 · Votação da comunidade"; "Vote no melhor de 2026."; "12 categorias. Você vê em cada indicado se já jogou, quanto e que nota deu."; "Indicações 3 a 16 nov"; "Votação 1 a 20 dez · agora"; "Resultado 27 dez" | `BALLOT.year`, `phase`, `categoriesTotal`; `CATEGORIES.votingStartDate`/`votingEndDate`; event dates; `categoriesCount` if using `EVENT_CURRENT` |
| Progress | `5410:736`/`5410:740` | `5412:854` | "Sua cédula"; "7 de 12" | `BALLOT.categoriesVoted`, `categoriesTotal` |
| Category list | `5410:735` | `5412:867` | "Categoria 01 de 12" … "12 Seu GOTY pessoal"; row states "Escolhendo", "Votar", "Seu voto" | `BALLOT.categories[]`: `id`, `name`, `order`, `isPersonalGOTY`, `voteGameId`; the "voted/active/pending" state is client-derived |
| Category panel | `5410:807` | `5412:867` | "Jogo do Ano"; "Lançados entre 1 jan e 30 nov de 2026. Indicados pela comunidade em novembro."; "Todos · 6"; "Que joguei · 4" | `category.name`, `description`, `order`; `nominees.length`; `playedNomineesCount`; the description is admin copy, not an eligibility field |
| Nominee card | `5408:716` (`Default`), `5408:704`/`5408:696` | `5412:878`…`5412:917` | "Nioh 3"; "Koei Tecmo · PS5, PC"; "Você jogou · 86 h · nota 9"; "Na sua lista de desejos"; "Ainda não jogou"; "Seu voto" | `nominees[]`: `gameId`, `status`, `playtimeSeconds`, `rating`; hydrate name/developer/platform/cover with `GAME_REPO` |
| Filters | `5410:813` | `5412:872` | "Todos · 6"; "Que joguei · 4" | `nominees.length`; `playedNomineesCount`; filtering is client-side |
| Personal GOTY suggestion | category row 12 | category row 12 | "Sugerido: Nioh 3" | `suggestedGameId` (non-null only for the personal-GOTY category) |
| Vote bar / sticky | `5410:877` | `5412:925` | "Seu voto em Jogo do Ano"; "Nioh 3"; "Pular por agora"; "Confirmar e ir para Direção de Arte" | `voteGameId`; `POST /v1/awards/vote`; next category from the client's display order |
| Share | category list button | — | "Compartilhar minha cédula" | `SHARED_BALLOT`; public page |

Status mapping is exact: `played` → "Você jogou · {hours} · nota {rating}" (rating omitted when null);
`planned` → "Na sua lista de desejos" (mobile: "Na sua lista"); `not_played` → "Ainda não jogou"
(mobile: "Não jogou"). The server has no wishlist entity; `planned` is the design's wishlist.

The filter counts are `nominees.length` and `playedNomineesCount`; never hard-code the design's `6`
and `4` (the event's `nomineeCount` can differ and finalization can return fewer games).

The personal-GOTY category is not a nominee grid: it has no nominations, may return an empty
`nominees` array, and uses `suggestedGameId` plus free search among eligible games. Do not render the
six-card grid for category 12; render the suggestion and the vote picker.

## Awards results and scoreboard

Both sizes use the public `RESULTS` read. The "Seu placar" chips need the public `SCOREBOARD` read as
well; `RESULTS` alone does not contain the viewer's vote.

| Block | Web node | Mobile node | Visible copy | Fields |
| --- | --- | --- | --- | --- |
| Page header | `5429:1280` | mobile top bar | "Eventos 2026" · "Awards" · "Retrospectiva"; "Resultado" | none |
| Featured winner | `5410:907` | `5412:947` | "Resultado · Jogo do Ano · 4.812 votos"; "Resident Evil Requiem é o Jogo do Ano." | The `RESULTS` item with `category.isGOTY`: `totalVotesCount`, `winners[position = 1]` |
| Vote filter | `5410:914` | `5412:953` | "Todos os votos"; "Só quem jogou" | Client toggle between `winners[].votesPercentage` and `winners[].playedVotesPercentage` |
| Vote share list | `5410:920` — `5410:969` | `5412:958` — `5412:1002` | "Resident Evil Requiem 31%"; "Saros 22%"; "Marvel's Wolverine 18%"; "Nioh 3 14%"; "Pragmata 9%"; "Phantom Blade Zero 6%" | `winners[]`: `gameId`, `position`, `totalVotes`, `votesPercentage`, `playedVotes`, `playedVotesPercentage` |
| "Seu voto" chip | `5410:950` (Nioh 3) | `5412:983` | "Seu voto" | `SCOREBOARD.categories[]` with `outcome: "miss"` and `votedGameId`, or the user's `BALLOT.voteGameId` |
| Played-only note | `5410:973` | `5412:1005` | "Contando só quem jogou, a disputa aperta: Resident Evil Requiem 29%, Saros 27%."; "2.391 votos de quem marcou o jogo como jogado. A diferença para Saros cai de 9 para 2 pontos." | `categoryResult.totalPlayedVotesCount`; `winners[].playedVotes`, `playedVotesPercentage`; the percentage-point difference is computed client-side |
| Scoreboard card | `5410:977` / `5410:978` | `5412:1008` / `5412:1010` | "Seu placar"; "Você acertou 7 de 11 categorias."; "Compartilhar meu placar"; mobile "7 de 11 acertos"; "Ver categorias" | `SCOREBOARD.totals.hits`, `voted`, `scorable`; `SCOREBOARD.categories[]`; `SCOREBOARD.personalGOTY` |
| All-category winners | `5410:982` | mobile scroll | "Direção de Arte — Saros"; "Narrativa — Resident Evil Requiem"; …; "Seu GOTY pessoal — Nioh 3" | `RESULTS` per category; `category.isGOTY`/`isPersonalGOTY` to split the featured winner, the 10 scorable cards and the personal card; `SCOREBOARD` outcomes for the chips |
| Result chips | each `winner/*` card | — | "Seu voto venceu" (hit); "Seu voto" on the voted game (miss); "Você não votou" (not_voted) | `SCOREBOARD.categories[].outcome`; `votedGameId`; `winningGameId` |
| Personal GOTY card | `5410:1063` | — | "Seu GOTY pessoal"; "Nioh 3"; "Também é o GOTY pessoal de 312 pessoas no GameNode." | `SCOREBOARD.personalGOTY.gameId`, `otherUsersCount`; `otherUsersCount` excludes the user |

Scoreboard shape check: `totals.scorable` is the number of non-personal categories **with a result**,
not a hard-coded 11; `categories[]` contains one item per such category. The design's "7 de 11" is
correct only when all 11 non-personal categories have results. The response's `categories[]` has no
`name` or `order`; a detailed scoreboard screen would need `CATEGORIES` to label and order the rows.
`SCOREBOARD` is public and returns 404 before results exist (which also covers an unknown event); the
design only shows it after results, so this is a guard, not a screen state.

`RESULTS` returns `[]` before computation. The result screen should therefore be gated by `phase ===
"results"` (or by a non-empty results read); a result page opened during voting would have no featured
winner.

There is **no dedicated scoreboard frame**. The only scoreboard surfaces are the aggregate "Seu placar"
block on the web result frame and the score card on the mobile result frame. The endpoint returns
per-category outcomes that the design only uses as chips on the result cards.

## Notifications

There is **no notifications inbox frame** on this canvas. The only notification surfaces are the
topbar bell with an unread count (`TopbarNotificationButton`, design-context node `5202:2233`, count 3
in the Home frame) and the flow/calendar annotations. The inbox itself is the existing
`GET /v1/notifications` list.

Design copy and timing from `5445:9135` and the display calendar (`5445:9262`):

| Design entry | Design timing | Server event / milestone | Target | Recipients | Trigger |
| --- | --- | --- | --- | --- | --- |
| "Indicações abertas" | 3 Nov | `awards.milestone` / `nominations_open` | `{type:"awards", eventId, year, phase:"nominations"}` | Everyone not banned/suspended | `nominationStartDate` |
| "Indicações fecham amanhã" | 15–16 Nov | `awards.milestone` / `nominations_close_reminder` | same awards target | Users with no nomination in the event | `nominationEndDate - 24h` |
| "Sua retrospectiva chegou" | 15 Nov | `recap.milestone` / `available` | `{type:"recap", userId, year}` | The Recap owner, once, when the first Recap with data is created | First generation with data (daily 04:00 UTC job) |
| "Votação aberta" | 1 Dec | `awards.milestone` / `voting_open` | `{type:"awards", eventId, year, phase:"voting"}` | Everyone not banned/suspended | `votingStartDate` |
| "Faltam 2 dias" | 18 Dec, incomplete ballot only | `awards.milestone` / `voting_close_reminder` | same awards target | Users whose ballot is incomplete | `votingEndDate - 48h` |
| "Saiu o resultado" | 27 Dec | `awards.milestone` / `results_published` | `{type:"awards", eventId, year, phase:"results"}` | Everyone not banned/suspended | Once results exist |
| "Seu 2026 fechou" | 1 Jan | `recap.milestone` / `closed` | `{type:"recap", userId, year}` | The Recap owner, once, when a Recap with data is marked final | Final generation with data |
| Goal reminder | July (Recap page copy) | `goal.reminder` | `{type:"goal", year}` | Users with a goal for the year | 1 July 12:00 UTC |

Inbox item fields (all types): `id`, `type`, `actors` (empty for system notifications), `preview`,
`target`, `eventCount`, `actorCount`, `lastEventAt`, `version`, `readVersion`. `preview.text` is fixed
English in the current projector; the design copy is Portuguese. `preview.target`/`finished` exist only
for `goal.reminder`. The `awards` target's `phase` is one of `nominations`, `voting`, `results`; the
`recap` target carries the recipient `userId` and `year`; the `goal` target carries `year`.

Read state: `PATCH /v1/notifications/read` and `PATCH /v1/notifications/read-all`; `GET
/v1/notifications?filter=unread&limit=1` gives `unreadCount` for the bell. The server fans out Awards
milestones in batches and resumes; the design does not show this infrastructure.

## Other entry surfaces in the flow

| Surface | Node | Reads | Notes |
| --- | --- | --- | --- |
| Home · card do evento | `5445:9145` | `EVENT_CURRENT`, `BALLOT`, `RECAP` | Main entry; one Wide card when one event is active, two Half cards when both; mobile carousel. |
| Dock | `5445:9155` | `EVENT_CURRENT`, `RECAP_CURRENT`, `INBOX` | See [Dock](#dock). |
| Notificações | `5445:9167` | `INBOX` | Design summary mentions four milestones; the server also sends the reminders and recap-closed notification listed above. |
| Perfil · Feitos | `5445:9175` | `GET /v2/achievements`, `GET /v2/achievements/progress/:userId` | "Feito Awards 2026 (+1000 XP e medalha)" is an admin-created achievement with `awards_ballot_completed`, category `EVENTS`. The API has no `pending` flag; derive pending from `value`/`tier`. |
| Link compartilhado | `5445:9183` | `RECAP`, `RECAP_STATUS`, `SCOREBOARD`, `SHARED_BALLOT` | Public pages with a signup CTA. The server does not render OG/preview pages. |
| Awards · Indicações | `5445:9197` | `CATEGORIES`, `NOMINATIONS_ME`, `NOMINATIONS_PUT`, `GAME_REPO` | **No frame**: the flow says "A desenhar" and proposes reusing the ballot with game search. The server has no candidate-search endpoint; use the existing game search and let the server validate. |
| Awards · Cédula | `5445:9208` | `BALLOT`, `VOTE`, `CATEGORIES`, `GAME_REPO` | Product screen 7/9. |
| Awards · Resultado | `5445:9219` | `RESULTS`, `SCOREBOARD`, `CATEGORIES`, `GAME_REPO` | Product screen 8/10. |
| Retrospectiva 2026 | `5445:9230` | `RECAP_CURRENT`, `RECAP_STATUS`, `RECAP`, `GOAL_GET` | Product screen 1 + stories. |
| Seletor Retrospectiva ↔ Awards | `5445:9246` | none | Client navigation; the two screens are separate reads. |
| Cross-link no conteúdo | `5445:9250` | `RECAP` + `EVENT_CURRENT`/`BALLOT` | The Recap "Awards 2026 · votação aberta" card and the Story 5 "Votar no Awards 2026" CTA are client compositions. |
| Compartilhar | `5445:9254` | none | Client share; public reads exist; no server image. |
| Recompensa | `5445:9258` | `awards_ballot_completed` metric, `GET /v2/achievements/progress/:userId` | "Feito + 1000 XP e medalha" is admin data; the metric is evaluated after a vote. |

## Components and assets

| Component | Node | States | Data mapping |
| --- | --- | --- | --- |
| Brand/Wordmark | `5408:677` | — | Brand asset, not API. |
| Button | `5408:685` | Primary `5408:679`, Secondary `5408:681`, Ghost `5408:683` | CTAs only. |
| Chip | `5408:695` | Brand `5408:686`, Played `5408:689`, Neutral `5408:692` | Play status/result chips: `played`, `planned`, `not_played`; `hit`/`miss`/`not_voted`. |
| Nominee Card | `5408:716` | Default `5408:696`, Selected `5408:704` | `BALLOT.nominees[]`: `gameId`, `status`, `playtimeSeconds`, `rating`; `voteGameId` for Selected. |
| Category Row | `5408:731` | Active `5408:717`, Voted `5408:721`, Pending `5408:727` | `BALLOT.categories[]`: `voteGameId`; active category is client state. |
| Covers/assets | `5407:714` | — | `GAME_REPO` covers. |
| Nav icons | `5438:1295`, `5438:1302`, `5438:1308` | — | Client assets; `events` icon is only for Dock option B. |

## Cross-cutting client rules (confirmed against code)

- **Ratings:** server is 0–5; design is 0–10. Convert once: `rating * 2` (`4.5 → 9.0`, `3.2 → 6.4`).
  `null` means "not rated", not zero.
- **Games are ids only.** `BALLOT`, `RESULTS`, `RECAP.topGames`, `RECAP.playedGames` and
  `SCOREBOARD` carry game ids, not full game objects. Hydrate with the existing public game
  repository; use one batched call per screen.
- **`planned` is the design's wishlist.** There is no wishlist entity. A library entry that is not
  played (`planned`) renders "Na sua lista de desejos".
- **Logged out:** public reads work (`EVENT_CURRENT`, `EVENTS`, `CATEGORIES`, `RESULTS`,
  `SCOREBOARD`, `RECAP_CURRENT`, `RECAP_STATUS`, `RECAP`, `SHARED_BALLOT`). Auth reads return 401
  (`BALLOT`, `NOMINATIONS_ME`, `NOMINATIONS_PUT`, `VOTE`, `GOAL_GET`, `GOAL_PUT`, `INBOX`). Hide
  personalized cards or show a sign-in CTA; never treat a 401 as an empty ballot.
- **Vote restriction:** an event with both nomination dates accepts only the category's nominees,
  except personal GOTY, which accepts any eligible game. Legacy events keep the old rules. The client
  must offer nominees in 2026 categories, not free search.
- **UTC everywhere:** event dates, Recap days, streaks, weekdays and goal years are UTC. Do not apply
  the viewer's timezone.
- **`phase`, not `isVotable`:** `isVotable` is the legacy event-level boolean and uses second
  precision; the design's screen state is `phase`.
- **Dates are data:** the design's 3–16 Nov and 15 Nov are examples. Admins can set the 2026 calendar
  and Recap opening without a deploy.
- **Caching:** the Recap read is cached server-side for 15 minutes and cleared on write; the Recap
  edition window is cached for 60 s and cleared by the admin PUT. A client query cache can still hold
  an older result.
- **Images/OG/Dock badges/difficulty:** share images, story images, OG/preview pages, the Dock "new"
  badge and difficulty ("no difícil") are explicitly out of server scope (proposal "Not included" and
  design "Non-Goals"). The clients render/share images and own the badges.

## Real gaps

These are concrete mismatches or missing data between the design and the current server. Each one has
the stated client workaround or is a documented limitation; none requires a new endpoint in this
change.

| # | Gap | Evidence | Impact / action |
| --- | --- | --- | --- |
| G1 | `BALLOT` has no `isGOTY`, and its categories start in the auto-created order (personal GOTY 0, global GOTY 1), while the design shows global "Jogo do Ano" first and "Seu GOTY pessoal" last. | `src/awards/dto/awards-ballot.dto.ts:13` (no `isGOTY`); `src/awards/admin/awards-admin.service.ts:92-108` (initial orders 0/1); design `5410:689` category list | Identify the global GOTY from `CATEGORIES.isGOTY` by category id — two reads, `BALLOT` + `CATEGORIES`. The server sorts both reads by `order` and admins configure `order` (including the special categories), so render the payload order and derive "Categoria NN de MM" from it. Do not use the English names or the initial 0/1 values. |
| G2 | The auto-created special categories have English names ("Your Game of the Year", "Game of the Year"). | `src/awards/admin/awards-admin.service.ts:92-108` (names and initial orders), `:111-130` (the category save omits both flags) | Names and descriptions are admin data. The category save no longer writes `isGOTY`/`isPersonalGOTY`, so an admin may rename the special categories without clearing their flags; clients still localize by `isPersonalGOTY` and `CATEGORIES.isGOTY` rather than by name. |
| G3 | The design hides the Awards card in dead periods (17–30 Nov, 21–26 Dec) and has no pre-3 Nov card. | design `5445:9135` calendar; `handoff-clients.md` "Awards card by phase" (now marks those phases as no card) | Render no Awards card in `upcoming`, `nominations_closed`, `voting_closed`, or after 27 Jan. The handoff's phase table is reconciled with this calendar. |
| G4 | `RECAP_CURRENT` never returns `upcoming`: before the current year opens it returns the previous year with `closed`. The future year's `opensAt` is not public; `RECAP_STATUS` needs a `userId`. | `src/recap/recap-window.service.ts:58-70`; design calendar row 3–14 Nov (no Recap card) | Before the opening, render no Recap card. This is intentional (design 9b) and the contract has no public future-edition read; a logged-out visitor cannot show "opens on …" from the API alone. Operations copy uses the known calendar. |
| G5 | The Recap response has no list of connected sources and no explicit data-through field. The footer says "Horas de PSN, Steam e Nintendo conectados". | `YearRecapDto` / `YearRecap` fields; design `5420:945` footer | `updatedAt` is the generation timestamp, not a source list. For the owner, read the existing connections endpoints; a logged-out shared Recap cannot list providers, which is a documented limitation. Do not infer providers from `playedGames` (those are platforms). |
| G6 | There is no Figma frame for the nominations screen. The flow marks "Awards · Indicações" as "A desenhar" and proposes reusing the ballot with game search. | `5445:9197`; cover index `5409:773` counts 10 screens, none of them nominations | The Home "Indicar jogos" CTA has no designed target. The server endpoints exist (`CATEGORIES`, `NOMINATIONS_ME`, `NOMINATIONS_PUT`), but there is no candidate-search endpoint; use the existing game search and server validation. This is a client design gap, not a missing endpoint. |
| G7 | Notification `preview.text` is fixed English in the projector; the design copy is Portuguese ("Indicações abertas", "Sua retrospectiva chegou", etc.). | `src/notifications/notifications-projector.service.ts:54-60`, `766-770`, `797`; design `5445:9167` | `preview.text` stays an English fallback. The client renders the design copy from `milestone`/`type` (design 8), so the server copy is not changed in this contract. |
| G8 | The "card leaves after a complete ballot" rule has no server field on the event read. Deciding it requires an authenticated `BALLOT`. | design `5445:9374`; `BALLOT` only | The Home card needs one extra auth read to know `categoriesVoted === categoriesTotal`. This is within the "at most two calls" goal, but it means a logged-out viewer cannot know completion. |
| G9 | `RESULTS` does not contain the viewer's vote, so the result chips ("Seu voto venceu", "Seu voto", "Você não votou") need `SCOREBOARD` (or the user's `BALLOT`). | `AwardsScoreboardDto`; design `5410:888` chips | Two reads for a personalized result page. A logged-out result page has no chips; show only the public result. |
| G10 | `totalPlayedGames` counts `playedGames` rows (game × source × platform), not distinct games. The design says "38 jogos" and "38 nós". | `YearRecap.totalPlayedGames`; `RecapCreateService` played rows; `handoff-clients.md` known gap 3 (totalPlayedGames duplication) | Use `topGames.length` for the design's game counts. Otherwise a game played on two sources inflates the number. |
| G11 | `topGames` carries `platformIds`, not platform names; `distributionByGenre` carries counts, not shares. The design shows platform names and genre percentages. | `RecapTopGameDto`; `ProfileMetricsTypeDistributionItem` | Map `platformIds` to the `playedGames[].platform` objects (same response) or existing platform data; compute genre percentages from the counts. No extra endpoint. |
| G12 | The design's "Sábado é o seu dia: 31% das suas horas caíram no fim de semana" combines two different fields. | `RecapCalendarDto.topWeekday.share` vs `weekendShare`; design `5418:941` | "Sábado" comes from `topWeekday.weekday`; "31% … fim de semana" comes from `weekendShare`. Do not use `topWeekday.share` for the weekend sentence. |
| G13 | There is no dedicated scoreboard frame and no dedicated notifications inbox frame on the canvas. The scoreboard endpoint returns per-category detail that the design only shows as chips/aggregate. | canvas inventory; `5410:977`, `5412:1008`; `5445:9167` | Reuse the existing inbox for notifications. For scoreboard, either show only the aggregate card (design) or build a detail screen from `SCOREBOARD.categories[]` + `CATEGORIES` for names/order; there is no design target for that detail. |
| G14 | The "Feito Awards 2026" pending state has no explicit `pending` field. | `AchievementProgressDto`; design `5445:9175` | Derive pending from `value`/`tier`/`nextThreshold` and the definition window. XP/medal are admin data; no code seed. |
| G15 | The result/home copy "4.812 votos em 12 categorias" has no direct aggregate endpoint. `RESULTS` is per category. | `AwardsCategoryResult`; design `5410:888`, `5444:1922` | If "4.812" means the featured category's votes, use that result's `totalVotesCount`; if it means all categories, sum `RESULTS[].totalVotesCount` (votes, not unique users). "12 categorias" comes from `categoriesCount`/`BALLOT.categoriesTotal`. |
| G16 | `SCOREBOARD.totals.scorable` counts non-personal categories that have a result; the design copy hard-codes "11". `personalGOTY.otherUsersCount` excludes the user, while the copy "312 pessoas" can read as including them. | `src/awards/result/awards-result.service.ts:83-123`, design `5410:888` | Use API totals, not a hard-coded 11, and word the personal GOTY count as "other people" (or add 1 in the client copy). |
| G17 | `BALLOT.nominees` is sorted by `gameId` ascending; the design puts the user's vote/selected card first and otherwise shows an editorial-looking order. | `src/awards/ballot/awards-ballot.service.ts:89-99` | Move `voteGameId` first and apply the design's order client-side. `CATEGORIES.suggestions` is unordered; do not treat either order as a ranking. |
| G18 | `RESULTS` is ordered by category id, not category `order`; `SCOREBOARD.categories[]` has no name/order. The design uses the category order (Jogo do Ano first, personal GOTY last). | `src/awards/result/awards-result.service.ts:47`; `AwardsScoreboardDto` | Sort `RESULTS` by `category.order` for display; join `CATEGORIES` for scoreboard labels/order. |
| G19 | Category descriptions such as "Lançados entre 1 jan e 30 nov de 2026…" are admin-managed `description` text, not generated from `eligibilityCutoffDate`. | `AwardsCategory.description`; design `5410:689` | Operations write the description; the API does not compose the release-window sentence. Editing the special categories' name or description is safe now that the save preserves their flags (G2). |
| G20 | The nominations screen has no candidate-search endpoint; the design proposes reusing the ballot with a game search. | `5445:9197`; no awards candidate endpoint in `src/awards` | Use the existing game search/repository and filter by event year/cutoff in the client; the server validates every id. No new endpoint is required. |

## Caveats and exclusions already planned

These are **not** missing implementation. They are either client work or explicitly out of scope in
`proposal.md` ("Not included") and `design.md` ("Non-Goals"):

- Client UI, share-image/story rendering and the Dock "new" badge state are client work.
- Difficulty ("no difícil") has no provider and is not returned. The Story 2/GOTY copy must drop it or
  use a client-authored label.
- OG/preview pages are not server work.
- The server does not render images or stories; `Baixar card`, `Compartilhar nos stories` and
  `Compartilhar meu ano` are client renders/shares.
- There are no per-user timezones; all day boundaries are UTC.
- Old Recaps can have `dailyPlaytimeSeconds: null` and `communityHighlights: null`; hide the calendar
  and community sections in that case (the read returns `calendar: null`).
- Recap reads are cached 15 minutes; edition windows 60 s. Do not build a tight polling loop for them.
- The hourly Awards tick can deliver a milestone up to ~59 minutes late; Recap availability is tied to
  the 04:00 UTC daily generation, not to 15 Nov 00:00. The design's dates are day-granular, so this is
  acceptable, but the notification copy should not promise an exact minute.
- `GET /v1/awards/events/current` returns 404 before the first phase; a future `upcoming` card, if
  wanted, needs `GET /v1/awards/events` and is outside the design's calendar.
- `isVotable` is the legacy event-level flag; use `phase`.
- `CATEGORIES.suggestions` is unordered; the ballot sorts by game id. Do not present either as a
  ranking.
- An `ongoing` library entry with no dates and no playtime is reported as `planned` and uses the
  design's wishlist label; the design has no `ongoing` state.
- `YearRecapDto` also returns raw `genres`, `themes`, `modes` and `platforms` relations; use the
  `distributionBy*` arrays and `playtimeByPlatform` instead of those raw rows.

## Verification log

- **Figma coverage.** `get_metadata` on `5407:677` returned 234,591 bytes / 2,682 lines; it was parsed
  locally and only the relevant frame/text sections were extracted, not printed in full. The five
  sections and all 26 top-level frames/symbols are listed in the inventory. The 10 product screens are
  all mapped. `get_design_context` was read for 33 nodes: 15 Home card variants, 5 Recap web sections
  + header, 5 stories, 4 Awards screens, 3 Dock/Home entry frames. The frame ids and names above are
  taken from the metadata, not guessed. The `figma-design-to-code` skill was loaded from
  `skill://figma/figma-design-to-code/SKILL.md` before the first `get_design_context`; the
  `skillNames` argument was sent on every call.
- **Source coverage.** The endpoints/fields were read from the current code via CodeGraph and the
  files cited below. No build or integration suite was run; that belongs to task 9.2.
- **Docs checks.** All canvas frame ids cited in this appendix exist in the Figma metadata; `5202:2233`
  is a design-system node from `get_design_context`, not a canvas frame. All endpoint paths cited exist
  in the controllers; all JSON examples in `handoff-clients.md` still parse. No Markdown link in this
  appendix points outside the file except the Figma URL.
- **Scope compliance.** This appendix and the correction round's documentation edits
  (`handoff-clients.md`, `tasks.md` 8.1) only; no Figma, code, spec, commit, push, sync, archive or
  publish action was taken.

## Source files read for this appendix

- `src/awards/awards.controller.ts` — event/category/results/scoreboard routes.
- `src/awards/awards.service.ts` — current event, category read, phase mapping.
- `src/awards/awards.utils.ts` — `getAwardsPhase`, `assertGameEligible`.
- `src/awards/dto/awards-event.dto.ts`, `src/awards/dto/awards-ballot.dto.ts`,
  `src/awards/dto/votable-awards-category.dto.ts`.
- `src/awards/entity/awards-event.entity.ts`, `awards-category.entity.ts`,
  `awards-category-suggestion.entity.ts`, `awards-category-result.entity.ts`,
  `awards-category-winner.entity.ts`, `awards-nomination.entity.ts`.
- `src/awards/ballot/awards-ballot.controller.ts`, `awards-ballot.service.ts`.
- `src/awards/nomination/awards-nomination.controller.ts`, `awards-nomination.service.ts`.
- `src/awards/vote/awards-vote.controller.ts`, `awards-vote.service.ts`.
- `src/awards/result/awards-result.service.ts`, `awards-result.processor.ts`.
- `src/awards/admin/awards-admin.service.ts`, `awards-admin.controller.ts`.
- `src/recap/recap.controller.ts`, `recap.service.ts`, `recap-window.service.ts`,
  `recap-goals.service.ts`, `recap.utils.ts`, `recap-create.service.ts`.
- `src/recap/dto/year-recap.dto.ts`, `year-recap-played-game.dto.ts`,
  `recap-derivations.dto.ts`, `recap-window.dto.ts`, `recap-status.dto.ts`, `recap-goal.dto.ts`.
- `src/recap/entity/year-recap.entity.ts`, `year-recap-played-game.entity.ts`.
- `src/notifications/notifications.controller.ts`, `notifications.types.ts`,
  `notifications-projector.service.ts`, `dto/notifications-response.dto.ts`.
- `src/achievements/achievements.controller.ts`, `v2/achievements-v2.controller.ts`,
  `dto/achievement-v2.dto.ts`, `achievements.constants.ts`.

## Status

This appendix is the frame-level evidence for task 8.1: every product screen in the Figma canvas is
listed with a data source, and the remaining mismatches are recorded above. It does not:

- change the Figma file or add a server endpoint;
- run `yarn build` or the integration suites (task 9.2).

The client contract is `handoff-clients.md`. The gaps above are client work or documented
limitations; none is a pending server decision.
