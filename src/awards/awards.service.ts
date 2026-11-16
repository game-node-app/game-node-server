import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { AwardsEvent } from "./entity/awards-event.entity";
import { LessThanOrEqual, MoreThanOrEqual, Repository } from "typeorm";
import dayjs from "dayjs";
import { AwardsCategory } from "./entity/awards-category.entity";
import { VotableAwardsCategoryDto } from "./dto/votable-awards-category.dto";
import { AwardsEventDto, CurrentAwardsEventDto } from "./dto/awards-event.dto";
import { getAwardsPhase } from "./awards.utils";

@Injectable()
export class AwardsService {
    constructor(
        @InjectRepository(AwardsEvent)
        private readonly awardsEventRepository: Repository<AwardsEvent>,
        @InjectRepository(AwardsCategory)
        private readonly awardsCategoryRepository: Repository<AwardsCategory>,
    ) {}

    public getEventQueryBuilder() {
        return this.awardsEventRepository.createQueryBuilder("e");
    }

    public getCategoryQueryBuilder() {
        return this.awardsCategoryRepository.createQueryBuilder("c");
    }

    public async getEvents(): Promise<AwardsEventDto[]> {
        const events = await this.awardsEventRepository.find();
        return events.map((event) => this.toEventDto(event));
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

    public async getEventByIdOrFail(eventId: number): Promise<AwardsEventDto> {
        const event = await this.awardsEventRepository.findOneByOrFail({
            id: eventId,
        });
        return this.toEventDto(event);
    }

    public async getEventByYear(year: number) {
        return this.awardsEventRepository.findOneBy({
            year,
        });
    }

    public async getEventByYearOrFail(year: number): Promise<AwardsEventDto> {
        const event = await this.awardsEventRepository.findOneByOrFail({
            year,
        });
        return this.toEventDto(event);
    }

    /**
     * Latest event by year whose first phase (nominations when set, voting otherwise) has started.
     */
    public async getCurrentEvent(
        now: Date = new Date(),
    ): Promise<CurrentAwardsEventDto | null> {
        const event = await this.awardsEventRepository
            .createQueryBuilder("e")
            .where(
                "COALESCE(e.nominationStartDate, e.votingStartDate) <= :now",
                { now },
            )
            .orderBy("e.year", "DESC")
            .getOne();
        if (event == null) return null;

        return {
            ...this.toEventDto(event, now),
            categoriesCount: await this.awardsCategoryRepository.countBy({
                eventId: event.id,
            }),
        };
    }

    /**
     * Events the hourly lifecycle tick must look at: started, and no more than
     * 40 days past their results date (design 4).
     */
    public async getEventsInLifecycleWindow(
        now: Date = new Date(),
    ): Promise<AwardsEvent[]> {
        return this.awardsEventRepository
            .createQueryBuilder("e")
            .where(
                "COALESCE(e.nominationStartDate, e.votingStartDate) <= :now",
                { now },
            )
            .andWhere("e.resultsDate + INTERVAL 40 DAY >= :now", { now })
            .orderBy("e.year", "ASC")
            .getMany();
    }

    private toEventDto(
        event: AwardsEvent,
        now: Date = new Date(),
    ): AwardsEventDto {
        return { ...event, phase: getAwardsPhase(event, now) };
    }

    public async getEventByCategoryId(categoryId: number) {
        return this.awardsEventRepository.findOneByOrFail({
            categories: {
                id: categoryId,
            },
        });
    }

    public async getCategoryByIdOrFail(categoryId: number) {
        return this.awardsCategoryRepository.findOneByOrFail({
            id: categoryId,
        });
    }

    public async getRunningVotableEvent() {
        return this.awardsEventRepository.findOneBy({
            year: dayjs().year(),
            votingStartDate: LessThanOrEqual(new Date()),
            votingEndDate: MoreThanOrEqual(new Date()),
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
