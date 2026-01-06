import { Processor } from "@nestjs/bullmq";
import { RECAP_CREATE_JOB_NAME, RECAP_QUEUE_NAME } from "../recap.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { ProfileService } from "../../profile/profile.service";
import { getTargetRecapYear } from "../recap.utils";
import dayjs from "dayjs";
import { RecapService } from "../recap.service";
import { RecapCreateService } from "../recap-create.service";

@Processor(RECAP_QUEUE_NAME, {
    concurrency: 1,
})
export class RecapQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(RecapQueueProcessor.name);
    constructor(
        private readonly profileService: ProfileService,
        private readonly recapService: RecapService,
        private readonly recapCreateService: RecapCreateService,
    ) {
        super();
        this.processRecapCreateJob();
    }

    async process(job: Job<never>): Promise<any> {
        if (job.name === RECAP_CREATE_JOB_NAME) {
            await this.processRecapCreateJob();
        }
    }

    private async getRelevantProfiles() {
        const targetYear = getTargetRecapYear();
        const profiles = await this.profileService.findAll();

        return profiles
            .filter((profile) => {
                const createdAt = dayjs(profile.profile.createdAt);

                return createdAt.year() <= targetYear;
            })
            .map((profile) => profile.profile);
    }

    async processRecapCreateJob() {
        const profiles = await this.getRelevantProfiles();
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

        this.logger.log(`Generating recap for ${userIdsWithoutRecap.length}.`);

        for (const userId of userIdsWithoutRecap) {
            await this.recapCreateService.createRecap(userId);
        }
    }
}
