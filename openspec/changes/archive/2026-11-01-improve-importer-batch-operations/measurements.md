# Batch importer measurements

Measured on 2026-10-27 with the disposable local MySQL 8 fixture and a mocked Steam library response. The test compares one candidate with 25 candidates; the listing uses the default 20-item page. Counts include transaction statements. Each operation makes one call to the mocked provider library method.

| Operation | Candidates | Local SQL statements | Provider method calls | Elapsed |
| --- | ---: | ---: | ---: | ---: |
| Filtered listing | 1 | 5 | 1 | 14.4 ms |
| Filtered listing | 25 | 5 | 1 | 6.5 ms |
| One connection summary | 1 | 6 | 1 | 6.3 ms |
| One connection summary | 25 | 6 | 1 | 5.3 ms |
| Import all | 1 | 17 | 1 | 23.4 ms |
| Import all | 25 | 17 | 1 | 29.6 ms |

The query count did not grow per game in this range; inserts are chunked at 500 rows. Summary requests make one library discovery per eligible connection, in parallel, plus one shared library read and one shared sync-state read. The timings are single local observations, not production latency estimates. Provider method calls here are mocked: live Steam, PSN, or Xbox calls may paginate, use caches, take longer, or consume additional provider quota. Post-commit effects are delivered separately and are not included in the import timing.

Reproduce with:

```sh
IGDB_TEST_MYSQL_PORT=13306 yarn test --runInBand --testTimeout=120000 importer/importer-batch-import.integration.spec.ts -t 'measures provider calls'
```
