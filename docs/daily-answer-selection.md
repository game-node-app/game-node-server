# Daily answer selection

New automatic answers need at least one IGDB external critic score (`aggregatedRatingCount`). This is distinct from GameNode reviews and IGDB community ratings. One score cannot guarantee familiarity, and a local popularity score of 1 is insufficient evidence of recognition. Raise `MINIMUM_CRITIC_REVIEWS` in `daily-pool.service.ts` if policy changes.

The picker filters main games without theme 42 for each mode: cover or artwork URL, eight named keywords, or a genre, platform, developer or publisher, and a released date for specs. Same-mode reservations later than the target date minus 365 days, including future reservations, are excluded. Other modes do not exclude a game. It orders by critic count descending and ID ascending, caps at 1,000, then draws randomly. There is no unrestricted fallback; exhaustion leaves the slot empty and the scheduler retries later.

## Baseline and rollout

Read-only production observations on 2026-11-04 São Paulo (2026-11-05 UTC) found eligible counts of 13,445 cover, 8,905 artwork, 5,250 keywords and 12,744 specs; available counts were 13,444, 8,905, 5,246 and 12,743. The corresponding top-1,000 minimum counts were 8, 8, 6 and 8, with medians 11, 11, 10 and 11. The catalog median treating null as zero was zero; the reviewed main-game median excluding mature themes was two. These are snapshots, not current guarantees. ClueFinders 5th Grade Adventures: The Secret of the Living Volcano (ID 77048) had no critic count and local score 1.

Twenty-two of 28 queued future answers failed the floor in that snapshot. Existing puzzles and results remain unchanged, so old-policy answers can remain for up to seven days. Before deployment rerun the audits and check all eight slots per mode against existing reservations and the 365-day rule. Do not deploy if a mode cannot fill its missing slots. Inspect EXPLAIN on representative data and sample names across eras and platforms. Roll back picker code if necessary; preserve puzzles and results.

## Read-only audit (MySQL 8)

Set the target date to the São Paulo date being checked. Run this block for each of the eight dates, in order. For a conservative horizon check, require available counts at least equal to the number of still-missing slots in each mode; also inspect future reservations, since they are excluded even when later than the target date. This check does not reserve games and concurrent catalog or queue changes require a recheck.

```sql
SET @target = '2026-11-04';
WITH modes AS (
 SELECT 'cover' mode UNION ALL SELECT 'artwork' UNION ALL SELECT 'keywords' UNION ALL SELECT 'specs'
), eligible AS (
 SELECT m.mode, g.id, g.name, g.aggregatedRatingCount AS reviews
 FROM game g CROSS JOIN modes m
 WHERE g.category = 0 AND g.aggregatedRatingCount >= 1
 AND NOT EXISTS (SELECT 1 FROM game_themes_game_theme t WHERE t.gameId=g.id AND t.gameThemeId=42)
 AND CASE m.mode
 WHEN 'cover' THEN EXISTS (SELECT 1 FROM game_cover c WHERE c.gameId=g.id AND c.url IS NOT NULL)
 WHEN 'artwork' THEN EXISTS (SELECT 1 FROM game_artwork a WHERE a.gameId=g.id AND a.url IS NOT NULL)
 WHEN 'keywords' THEN (SELECT COUNT(*) FROM game_keywords_game_keyword gk JOIN game_keyword k ON k.id=gk.gameKeywordId WHERE gk.gameId=g.id AND k.name IS NOT NULL) >= 8
 WHEN 'specs' THEN EXISTS (SELECT 1 FROM game_genres_game_genre x WHERE x.gameId=g.id)
 AND EXISTS (SELECT 1 FROM game_platform_games_game x WHERE x.gameId=g.id)
 AND EXISTS (SELECT 1 FROM game_involved_companies_game_involved_company x JOIN game_involved_company ic ON ic.id=x.gameInvolvedCompanyId WHERE x.gameId=g.id AND (ic.developer=1 OR ic.publisher=1)) AND g.firstReleaseDate <= NOW()
 END
), ranked AS (
 SELECT e.*, NOT EXISTS (SELECT 1 FROM daily_puzzle p WHERE p.mode=e.mode AND p.gameId=e.id AND p.date > DATE_SUB(@target, INTERVAL 365 DAY)) AS available FROM eligible e
), numbered AS (
 SELECT r.*, ROW_NUMBER() OVER (PARTITION BY mode ORDER BY reviews DESC, id ASC) AS n FROM ranked r WHERE available
)
SELECT m.mode, (SELECT COUNT(*) FROM eligible e WHERE e.mode=m.mode) eligible,
 (SELECT COUNT(*) FROM ranked r WHERE r.mode=m.mode AND r.available) available,
 (SELECT MIN(reviews) FROM numbered n WHERE n.mode=m.mode AND n.n<=1000) top_min,
 (SELECT GROUP_CONCAT(CONCAT(n.name, ' (', n.reviews, ')') ORDER BY n.n SEPARATOR '; ') FROM numbered n WHERE n.mode=m.mode AND n.n IN (1, 500, 1000)) sample_names,
 (SELECT AVG(reviews) FROM numbered n WHERE n.mode=m.mode AND n.n IN (FLOOR((LEAST((SELECT COUNT(*) FROM ranked r WHERE r.mode=m.mode AND r.available),1000)+1)/2), FLOOR((LEAST((SELECT COUNT(*) FROM ranked r WHERE r.mode=m.mode AND r.available),1000)+2)/2))) top_median
FROM modes m;
```

Catalog and reviewed-only medians (null counts treated as zero only for the catalog):

```sql
WITH counts AS (
 SELECT 'catalog' population, COALESCE(aggregatedRatingCount,0) reviews FROM game
 UNION ALL
 SELECT 'reviewed main' population, aggregatedRatingCount FROM game g WHERE category=0 AND aggregatedRatingCount>=1 AND NOT EXISTS (SELECT 1 FROM game_themes_game_theme t WHERE t.gameId=g.id AND t.gameThemeId=42)
), ordered AS (
 SELECT population, reviews, ROW_NUMBER() OVER (PARTITION BY population ORDER BY reviews) n, COUNT(*) OVER (PARTITION BY population) total FROM counts
)
SELECT population, AVG(reviews) median FROM ordered WHERE n IN (FLOOR((total+1)/2), FLOOR((total+2)/2)) GROUP BY population;

WITH RECURSIVE dates AS (
 SELECT @target AS d UNION ALL SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM dates WHERE d < DATE_ADD(@target, INTERVAL 7 DAY)
), modes AS (SELECT 'cover' mode UNION ALL SELECT 'artwork' UNION ALL SELECT 'keywords' UNION ALL SELECT 'specs')
SELECT modes.mode, COUNT(*) missing_slots FROM modes CROSS JOIN dates
WHERE NOT EXISTS (SELECT 1 FROM daily_puzzle p WHERE p.mode=modes.mode AND p.date=dates.d)
GROUP BY modes.mode;

SELECT id, name, aggregatedRatingCount FROM game WHERE id=77048 OR name LIKE '%ClueFinders%';
SELECT p.mode, p.date, p.gameId, g.name, g.aggregatedRatingCount FROM daily_puzzle p JOIN game g ON g.id=p.gameId WHERE p.date > @target ORDER BY p.date, p.mode;
```

The count query samples the first, 500th and 1,000th available titles in each pool. Inspect additional titles across eras and platforms. The following is the actual cover picker plan; substitute the corresponding mode predicate from the count query and mode string for the other modes:

```sql
EXPLAIN SELECT candidate.id FROM (
 SELECT g.id FROM game g
 WHERE g.category=0 AND g.aggregatedRatingCount>=1
 AND EXISTS (SELECT 1 FROM game_cover c WHERE c.gameId=g.id AND c.url IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM game_themes_game_theme t WHERE t.gameId=g.id AND t.gameThemeId=42)
 AND g.id NOT IN (SELECT p.gameId FROM daily_puzzle p WHERE p.mode='cover' AND p.date > DATE_SUB(@target, INTERVAL 365 DAY))
 ORDER BY g.aggregatedRatingCount DESC, g.id ASC LIMIT 1000
) candidate ORDER BY RAND() LIMIT 1;
```

These statements only read data.
