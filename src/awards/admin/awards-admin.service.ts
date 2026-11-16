import { HttpException, Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { AwardsEvent } from "../entity/awards-event.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { CreateUpdateAwardsEventDto } from "../dto/create-update-awards-event.dto";
import { CreateUpdateAwardsCategoryDto } from "../dto/create-update-awards-category.dto";
import { Transactional } from "typeorm-transactional";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsService } from "../awards.service";
import { AddCategorySuggestionDto } from "../dto/add-category-suggestion.dto";
import { AwardsCategorySuggestion } from "../entity/awards-category-suggestion.entity";
import { AwardsCategoryTranslation } from "../entity/awards-category-translation.entity";
import { AwardsCategoryTranslationInputDto } from "../dto/awards-category-translation.dto";

@Injectable()
export class AwardsAdminService {
    constructor(
        @InjectRepository(AwardsEvent)
        private readonly awardsEventRepository: Repository<AwardsEvent>,
        @InjectRepository(AwardsCategory)
        private readonly awardsCategoryRepository: Repository<AwardsCategory>,
        @InjectRepository(AwardsCategorySuggestion)
        private readonly awardsCategorySuggestionRepository: Repository<AwardsCategorySuggestion>,
        private readonly awardsService: AwardsService,
        private readonly dataSource: DataSource,
    ) {}

    @Transactional()
    public async createAwardsEvent(dto: CreateUpdateAwardsEventDto) {
        const eventInYear = await this.awardsService.getEventByYear(dto.year);
        // An update may move the event to an unused year, so validate against the stored event.
        const existingEvent =
            dto.eventId == undefined
                ? eventInYear
                : await this.awardsService.getEventById(dto.eventId);
        this.assertValidEventDates(dto, existingEvent);
        if (dto.eventId == undefined && eventInYear != undefined) {
            throw new HttpException(
                `An event with id ${dto.eventId} already exists for year ${dto.year}.`,
                400,
            );
        }
        const event = await this.awardsEventRepository.save({
            id: dto.eventId,
            ...dto,
        });

        if (eventInYear == undefined) {
            await this.onAwardEventCreated(event);
        }
    }

    private assertValidEventDates(
        dto: CreateUpdateAwardsEventDto,
        existingEvent?: AwardsEvent | null,
    ) {
        if (dto.votingEndDate <= dto.votingStartDate) {
            throw new HttpException(
                "Voting end must be after voting start.",
                400,
            );
        }
        if (dto.resultsDate < dto.votingEndDate) {
            throw new HttpException(
                "Results must not precede voting end.",
                400,
            );
        }
        // Omitted fields keep their stored value, so an update is validated against the resulting calendar.
        const nominationStartDate =
            dto.nominationStartDate === undefined
                ? (existingEvent?.nominationStartDate ?? null)
                : dto.nominationStartDate;
        const nominationEndDate =
            dto.nominationEndDate === undefined
                ? (existingEvent?.nominationEndDate ?? null)
                : dto.nominationEndDate;
        if ((nominationStartDate == null) !== (nominationEndDate == null)) {
            throw new HttpException(
                "Nomination start and end dates must be informed together.",
                400,
            );
        }
        if (nominationStartDate == null || nominationEndDate == null) return;

        if (nominationEndDate <= nominationStartDate) {
            throw new HttpException(
                "Nomination start date must be before the nomination end date.",
                400,
            );
        }
        if (nominationEndDate > dto.votingStartDate) {
            throw new HttpException(
                "Nomination end date must not be after the voting start date.",
                400,
            );
        }
    }

    private async onAwardEventCreated(event: AwardsEvent) {
        await this.awardsCategoryRepository.save({
            eventId: event.id,
            name: "Your Game of the Year",
            description:
                "Your personal GOTY. Your most enjoyed or loved game this year.",
            isPersonalGOTY: true,
            order: 0,
        });
        await this.awardsCategoryRepository.save({
            eventId: event.id,
            name: "Game of the Year",
            description:
                "Game of the Year award. The game that pushed the industry forward the most this year.",
            isGOTY: true,
            order: 1,
        });
    }

    public async createOrUpdateAwardsCategory(
        dto: CreateUpdateAwardsCategoryDto,
    ) {
        this.assertUniqueTranslationLocales(dto.translations);

        const targetEvent = await this.awardsService.getEventByYear(dto.year);
        if (targetEvent == undefined) {
            throw new HttpException(
                `No registered event for year ${dto.year}. Please create one.`,
                400,
            );
        }

        await this.dataSource.transaction(async (manager) => {
            const category = await manager.save(AwardsCategory, {
                id: dto.categoryId,
                eventId: targetEvent.id,
                name: dto.name,
                description: dto.description,
                order: dto.order,
                nomineeCount: dto.nomineeCount,
            });
            // Null behaves like omitted: only an explicit array replaces the set.
            if (dto.translations == null) return;

            await manager.delete(AwardsCategoryTranslation, {
                categoryId: category.id,
            });
            if (dto.translations.length === 0) return;

            await manager.insert(
                AwardsCategoryTranslation,
                dto.translations.map(({ locale, name, description }) => ({
                    categoryId: category.id,
                    locale,
                    name,
                    description,
                })),
            );
        });
    }

    private assertUniqueTranslationLocales(
        translations?: AwardsCategoryTranslationInputDto[],
    ) {
        if (translations == null) return;
        const locales = new Set(translations.map(({ locale }) => locale));
        if (locales.size !== translations.length) {
            throw new HttpException(
                "Duplicate translation locales are not allowed.",
                400,
            );
        }
    }

    public async addCategorySuggestion({
        gameId,
        categoryId,
    }: AddCategorySuggestionDto) {
        const targetCategory = await this.awardsCategoryRepository.findOneBy({
            id: categoryId,
        });

        if (targetCategory == undefined) {
            throw new HttpException(
                `No registered category for id ${categoryId}.`,
                400,
            );
        }

        await this.awardsCategorySuggestionRepository.save({
            categoryId,
            gameId,
        });
    }

    public async removeCategorySuggestion({
        gameId,
        categoryId,
    }: AddCategorySuggestionDto) {
        const suggestion =
            await this.awardsCategorySuggestionRepository.findOneByOrFail({
                categoryId,
                gameId,
            });

        await this.awardsCategorySuggestionRepository.remove(suggestion);
    }
}
