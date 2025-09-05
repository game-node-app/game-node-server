import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { AwardsEvent } from "./entity/awards-event.entity";
import { MoreThanOrEqual, Repository } from "typeorm";
import dayjs from "dayjs";
import { AwardsCategory } from "./entity/awards-category.entity";
import { VotableAwardsCategoryDto } from "./dto/votable-awards-category.dto";

@Injectable()
export class AwardsService {
    constructor(
        @InjectRepository(AwardsEvent)
        private readonly awardsEventRepository: Repository<AwardsEvent>,
        @InjectRepository(AwardsCategory)
        private readonly awardsCategoryRepository: Repository<AwardsCategory>,
    ) {}

    public async getEvents() {
        return this.awardsEventRepository.find();
    }

    public async getRunningEvent() {
        return this.awardsEventRepository.findOneBy({
            year: dayjs().year(),
        });
    }

    public async getEventById(eventId: number) {
        return this.awardsEventRepository.findOneBy({
            id: eventId,
        });
    }

    public async getEventByIdOrFail(eventId: number) {
        return this.awardsEventRepository.findOneByOrFail({
            id: eventId,
        });
    }

    public async getEventByYear(year: number) {
        return this.awardsEventRepository.findOneBy({
            year,
        });
    }

    public async getEventByYearOrFail(year: number) {
        return this.awardsEventRepository.findOneByOrFail({
            year,
        });
    }

    public async getRunningVotableEvent() {
        return this.awardsEventRepository.findOneBy({
            year: dayjs().year(),
            votingStartDate: MoreThanOrEqual(dayjs().toDate()),
            votingEndDate: MoreThanOrEqual(dayjs().toDate()),
        });
    }

    public async getCategoriesByEventId(
        eventId: number,
    ): Promise<VotableAwardsCategoryDto[]> {
        const event = await this.getEventByIdOrFail(eventId);
        const categories = await this.awardsCategoryRepository.find({
            where: {
                eventId: eventId,
            },
            order: {
                order: "ASC",
            },
            relations: {
                suggestions: true,
            },
        });
        const now = dayjs();
        const isVotable =
            now.isAfter(event.votingStartDate, "second") &&
            now.isBefore(event.votingEndDate, "second");
        return categories.map((category): VotableAwardsCategoryDto => {
            return {
                ...category,
                isVotable,
                votingStartDate: event.votingStartDate,
                votingEndDate: event.votingEndDate,
            };
        });
    }
}
