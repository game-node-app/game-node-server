import { InjectQueue, Processor } from "@nestjs/bullmq";
import {
    RECAP_CREATE_JOB_NAME,
    RECAP_PROCESS_JOB_NAME,
    RECAP_QUEUE_NAME,
} from "../recap.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Job, Queue } from "bullmq";
import { Logger } from "@nestjs/common";
import { ProfileService } from "../../profile/profile.service";
import { getTargetRecapYear } from "../recap.utils";
import dayjs from "dayjs";
import { RecapService } from "../recap.service";
import { RecapCreateService } from "../recap-create.service";
import { RecapQueueProcessJobData } from "./recap-queue.types";

@Processor(RECAP_QUEUE_NAME, {
    concurrency: 1,
})
export class RecapQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(RecapQueueProcessor.name);
    constructor(
        private readonly profileService: ProfileService,
        private readonly recapService: RecapService,
        private readonly recapCreateService: RecapCreateService,
        @InjectQueue(RECAP_QUEUE_NAME) private readonly queue: Queue,
    ) {
        super();
    }

    async process(job: Job<RecapQueueProcessJobData | undefined>) {
        if (job.name === RECAP_CREATE_JOB_NAME) {
            await this.findRelevantProfiles();
            return;
        }
        if (job.name === RECAP_PROCESS_JOB_NAME) {
            await this.processRecapCreateJob(job.data!);
            return;
        }
    }

    private async findRelevantProfiles() {
        const targetYear = getTargetRecapYear();
        const profileItems = await this.profileService.findAll();

        const profiles = profileItems
            .filter((profile) => {
                const createdAt = dayjs(profile.profile.createdAt);

                return createdAt.year() <= targetYear;
            })
            .map((profile) => profile.profile);

        const userIds = profiles.map((p) => p.userId);

        const alreadyAvailableRecaps =
            await this.recapService.findAllByUserIds(userIds);
        const userIdsWithoutRecap = userIds.filter((userId) => {
            return !alreadyAvailableRecaps.find(
                (recap) => recap.profileUserId === userId,
            );
        });
        if (userIdsWithoutRecap.length === 0) {
            this.logger.log(
                "No applicable users without recap found. Skipping job.",
            );
            return;
        }

        const jobs = userIdsWithoutRecap.map((userId) => ({
            name: RECAP_CREATE_JOB_NAME,
            data: {
                userId,
            },
        }));

        await this.queue.addBulk(jobs);

        this.logger.log(
            `Registered recap job for ${userIdsWithoutRecap.length} users.`,
        );
    }

    async processRecapCreateJob(jobData: RecapQueueProcessJobData) {
        await this.recapCreateService.createRecap(jobData.userId);
    }
}
