import { Processor } from "@nestjs/bullmq";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { Job, UnrecoverableError } from "bullmq";
import { NotificationsRelayService } from "./notifications-relay.service";
import {
    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
    NOTIFICATIONS_QUEUE_NAME,
    NOTIFICATIONS_RELAY_TICK_JOB_NAME,
} from "./notifications.constants";
import { WorkerHostProcessor } from "../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";

@Processor(NOTIFICATIONS_QUEUE_NAME)
export class NotificationsQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(NotificationsQueueProcessor.name);

    constructor(
        private readonly projectorService: NotificationsProjectorService,
        private readonly relayService: NotificationsRelayService,
    ) {
        super();
    }

    async process(job: Job<any>) {
        if (job.name === NOTIFICATIONS_RELAY_TICK_JOB_NAME) {
            await this.relayService.relayTick();
        } else if (job.name === NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME) {
            await this.projectorService.projectEvent(
                job.data.eventId,
                job.data.attemptToken,
            );
        } else
            throw new UnrecoverableError(
                "Unsupported notification job",
            );
    }
}
