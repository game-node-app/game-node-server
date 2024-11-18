import { RabbitMQQueueConfig } from "@golevelup/nestjs-rabbitmq";

export const IGDB_SYNC_RABBITMQ_QUEUE_CONFIG: RabbitMQQueueConfig = {
    name: "sync-igdb",
    routingKey: "sync-igdb",
    exchange: "sync",
    options: {
        durable: true,
    },
    createQueueIfNotExists: true,
};
