import { RabbitMQQueueConfig } from "@golevelup/nestjs-rabbitmq";

/**
 * BullMQ queue name, not to be confused with RabbitMQ queue name.
 */
export const IGDB_SYNC_QUEUE_NAME = "igdb-sync-queue";

/**
 * BullMQ queue job name
 */
export const IGDB_SYNC_JOB_NAME = "igdb-sync";

export const IGDB_SYNC_RABBITMQ_QUEUE_CONFIG: RabbitMQQueueConfig = {
    name: "sync-igdb",
    routingKey: "sync-igdb",
    exchange: "sync",
    options: {
        durable: true,
    },
    createQueueIfNotExists: true,
};

export const IGDB_SYNC_FETCH_JOB_NAME = "igdb-sync-fetch";

export const IGDB_FETCH_FIELDS = [
    "id",
    "name",
    "slug",
    "checksum",
    "aggregated_rating",
    "aggregated_rating_count",
    "status",
    "summary",
    "storyline",
    "url",
    "screenshots.*",
    "game_modes.*",
    "themes.*",
    "player_perspectives.*",
    "expanded_games.id",
    "expanded_games.name",
    "expanded_games.slug",
    "category",
    "genres.*",
    "platforms.*",
    "dlcs.id",
    "dlcs.name",
    "dlcs.slug",
    "expansions.id",
    "expansions.name",
    "expansions.slug",
    "similar_games.id",
    "similar_games.name",
    "similar_games.slug",
    "involved_companies.*",
    "involved_companies.company.*",
    "involved_companies.company.logo.*",
    "game_engines.*",
    "game_engines.platforms.*",
    "game_engines.companies.*",
    "game_engines.companies.logo.*",
    "cover.*",
    "artworks.*",
    "collection.*",
    "alternative_names.*",
    "external_games.*",
    "franchises.*",
    "keywords.*",
    "game_localizations.*",
    "language_supports.*",
    "first_release_date",
];
