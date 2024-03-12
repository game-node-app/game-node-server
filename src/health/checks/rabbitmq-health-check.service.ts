import { Injectable } from "@nestjs/common";
import { AmqpConnection } from "@golevelup/nestjs-rabbitmq";
import {
    HealthCheckError,
    HealthIndicator,
    HealthIndicatorResult,
} from "@nestjs/terminus";

@Injectable()
export class RabbitMQHealthCheckService extends HealthIndicator {
    constructor(private readonly amqpConnection: AmqpConnection) {
        super();
    }

    async check(): Promise<HealthIndicatorResult> {
        const isConnected = this.amqpConnection.managedConnection.isConnected();
        const status = this.getStatus("rabbitmq", isConnected);
        if (isConnected) {
            return status;
        }

        throw new HealthCheckError("RabbitMQ is not reachable", status);
    }
}
