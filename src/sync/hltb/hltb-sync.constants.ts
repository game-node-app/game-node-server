import { RabbitMQQueueConfig } from "@golevelup/nestjs-rabbitmq";

export const HLTB_SYNC_RESPONSE_RMQ_QUEUE: RabbitMQQueueConfig = {
    name: "sync.hltb.update.response",
    routingKey: "sync.hltb.update.response",
    exchange: "sync-hltb",
    options: {
        durable: true,
    },
    createQueueIfNotExists: true,
};

export const HLTB_SYNC_REQUEST_RMQ_QUEUE: RabbitMQQueueConfig = {
    name: "sync.hltb.update.request",
    routingKey: "sync.hltb.update.request",
    exchange: "sync-hltb",
    options: {
        durable: true,
    },
    createQueueIfNotExists: true,
};
