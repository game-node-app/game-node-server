import { MigrationInterface, QueryRunner } from "typeorm";

/** Backfills the game cover url into activity targets materialized before it existed. */
export class AddNotificationGameCoverUrl1795100000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        // Idempotent: only rows that still lack the key are written, so a re-run is a no-op.
        await runner.query(
            `UPDATE notification_inbox inbox
            LEFT JOIN game g ON g.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(inbox.target, '$.game.id')) AS UNSIGNED)
            LEFT JOIN game_cover c ON c.gameId = g.id
            SET inbox.target = JSON_SET(inbox.target, '$.game.coverUrl', c.url)
            WHERE JSON_CONTAINS_PATH(inbox.target, 'one', '$.game.id') = 1
              AND JSON_CONTAINS_PATH(inbox.target, 'one', '$.game.coverUrl') = 0`,
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            `UPDATE notification_inbox
            SET target = JSON_REMOVE(target, '$.game.coverUrl')
            WHERE JSON_CONTAINS_PATH(target, 'one', '$.game.coverUrl') = 1`,
        );
    }
}
