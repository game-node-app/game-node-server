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
