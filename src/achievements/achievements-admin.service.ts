import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AchievementDefinition } from "./entities/achievement-definition.entity";
import { AchievementEvent } from "./entities/achievement-event.entity";
import { AchievementTier } from "./entities/achievement-tier.entity";
import { AchievementStatus } from "./achievements.constants";
import {
    AchievementTierInputDto,
    CreateAchievementDefinitionDto,
    CreateAchievementEventDto,
    UpdateAchievementDefinitionDto,
    UpdateAchievementEventDto,
} from "./dto/achievement-admin.dto";
import {
    ACHIEVEMENT_METRICS,
    validateMetricCriteria,
} from "./metrics/achievement-metrics";
import { AchievementsQueueService } from "./achievements-queue/achievements-queue.service";
import { AchievementsProgressService } from "./achievements-progress.service";
import { publicImagesDir } from "../utils/constants";

function badRequest(message: string): never {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
}

/**
 * Editorial management (draft -> published -> archived) of achievement definitions and events.
 */
@Injectable()
export class AchievementsAdminService {
    constructor(
        @InjectRepository(AchievementDefinition)
        private readonly definitionRepository: Repository<AchievementDefinition>,
        @InjectRepository(AchievementEvent)
        private readonly eventRepository: Repository<AchievementEvent>,
        private readonly dataSource: DataSource,
        private readonly achievementsQueueService: AchievementsQueueService,
        private readonly achievementsProgressService: AchievementsProgressService,
    ) {}

    getMetrics() {
        return [...ACHIEVEMENT_METRICS.values()].map(
            ({ key, description, filters, supportsWindow }) => ({
                key,
                description,
                filters,
                supportsWindow,
            }),
        );
    }

    findDefinitions() {
        return this.definitionRepository.find({
            relations: { tiers: true },
            order: { createdAt: "DESC", tiers: { level: "ASC" } },
        });
    }

    async findDefinitionOrFail(id: string) {
        const definition = await this.definitionRepository.findOne({
            where: { id },
            relations: { tiers: true, event: true },
            order: { tiers: { level: "ASC" } },
        });
        if (!definition) {
            throw new HttpException(
                "Definition not found",
                HttpStatus.NOT_FOUND,
            );
        }
        return definition;
    }

    private async validateDefinition(
        definition: Pick<
            AchievementDefinition,
            "metric" | "criteria" | "startsAt" | "endsAt" | "eventId" | "icon"
        >,
        tiers: AchievementTierInputDto[],
    ) {
        const metric = ACHIEVEMENT_METRICS.get(definition.metric);
        if (!metric) badRequest(`Unknown metric: ${definition.metric}`);
        const criteriaErrors = validateMetricCriteria(
            metric,
            definition.criteria,
        );
        if (criteriaErrors.length > 0) badRequest(criteriaErrors.join("; "));

        if (tiers.length < 1 || tiers.length > 10) {
            badRequest("A definition must have from 1 to 10 tiers");
        }
        tiers.forEach((tier, index) => {
            if (index > 0 && tier.threshold <= tiers[index - 1].threshold) {
                badRequest("Tier thresholds must be strictly increasing");
            }
        });

        const hasWindow =
            definition.startsAt != null || definition.endsAt != null;
        if (hasWindow) {
            if (definition.startsAt == null || definition.endsAt == null) {
                badRequest("startsAt and endsAt must be set together");
            }
            if (definition.endsAt <= definition.startsAt) {
                badRequest("endsAt must be after startsAt");
            }
        }
        if (hasWindow && definition.eventId) {
            badRequest(
                "A definition can't have both its own window and an event",
            );
        }
        if ((hasWindow || definition.eventId) && !metric.supportsWindow) {
            badRequest(`Metric ${metric.key} does not support time windows`);
        }
        if (
            definition.eventId &&
            !(await this.eventRepository.existsBy({ id: definition.eventId }))
        ) {
            badRequest("Event not found");
        }

        const icon = definition.icon;
        if (
            icon.kind === "glyph" &&
            !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon.name)
        ) {
            badRequest("Glyph names must be kebab-case");
        }
        if (
            icon.kind === "image" &&
            !existsSync(join(publicImagesDir, "icons", `${icon.name}.png`))
        ) {
            badRequest(`Icon ${icon.name} does not exist`);
        }
        if (icon.kind === "game_cover") {
            const games = await this.dataSource.query(
                "SELECT id FROM game WHERE id = ?",
                [icon.gameId],
            );
            if (games.length === 0) badRequest("Icon game not found");
        }
    }

    private toTiers(definitionId: string, tiers: AchievementTierInputDto[]) {
        return tiers.map((tier, index) =>
            Object.assign(new AchievementTier(), {
                definitionId,
                level: index + 1,
                threshold: tier.threshold,
                expReward: tier.expReward,
            }),
        );
    }

    async createDefinition(dto: CreateAchievementDefinitionDto) {
        if (await this.definitionRepository.existsBy({ id: dto.id })) {
            throw new HttpException(
                "A definition with this id already exists",
                HttpStatus.CONFLICT,
            );
        }
        const definition = this.definitionRepository.create({
            id: dto.id,
            name: dto.name,
            description: dto.description,
            category: dto.category,
            metric: dto.metric,
            criteria: dto.criteria,
            startsAt: dto.startsAt ?? null,
            endsAt: dto.endsAt ?? null,
            eventId: dto.eventId ?? null,
            icon: dto.icon as AchievementDefinition["icon"],
            isHidden: dto.isHidden ?? false,
            status: AchievementStatus.DRAFT,
        });
        await this.validateDefinition(definition, dto.tiers);
        definition.tiers = this.toTiers(dto.id, dto.tiers);
        await this.definitionRepository.save(definition);
        return this.findDefinitionOrFail(dto.id);
    }

    async updateDefinition(id: string, dto: UpdateAchievementDefinitionDto) {
        const saved = await this.findDefinitionOrFail(id);
        if (saved.status === AchievementStatus.ARCHIVED) {
            badRequest("Archived definitions can't be edited");
        }
        const isPublished = saved.status === AchievementStatus.PUBLISHED;
        const changes = Object.fromEntries(
            (
                [
                    "name",
                    "description",
                    "category",
                    "metric",
                    "criteria",
                    "startsAt",
                    "endsAt",
                    "eventId",
                    "icon",
                    "isHidden",
                ] as const
            )
                .filter((key) => dto[key] !== undefined)
                .map((key) => [key, dto[key]]),
        ) as Partial<AchievementDefinition>;
        const merged = { ...saved, ...changes };
        const tiers = dto.tiers ?? saved.tiers;

        if (isPublished) {
            for (const key of [
                "metric",
                "criteria",
                "startsAt",
                "endsAt",
                "eventId",
            ] as const) {
                if (!isDeepStrictEqual(merged[key], saved[key])) {
                    badRequest(`${key} can't change after publishing`);
                }
            }
            const changesExistingTier = saved.tiers.some(
                (tier, index) =>
                    tiers[index]?.threshold !== tier.threshold ||
                    tiers[index]?.expReward !== tier.expReward,
            );
            if (changesExistingTier) {
                badRequest(
                    "Published tiers can't change, only new tiers can be appended",
                );
            }
        }
        await this.validateDefinition(merged, tiers);

        await this.dataSource.transaction(async (manager) => {
            if (Object.keys(changes).length > 0) {
                await manager.update(AchievementDefinition, { id }, changes);
            }
            if (dto.tiers) {
                // Drafts replace their tiers; published definitions only append
                if (!isPublished) {
                    await manager.delete(AchievementTier, { definitionId: id });
                }
                await manager.insert(
                    AchievementTier,
                    this.toTiers(id, dto.tiers).slice(
                        isPublished ? saved.tiers.length : 0,
                    ),
                );
            }
        });

        if (isPublished && tiers.length > saved.tiers.length) {
            await this.achievementsQueueService.addBackfillJob({
                definitionId: id,
                afterUserId: null,
                generation: tiers.length,
            });
        }
        return this.findDefinitionOrFail(id);
    }

    async deleteDefinition(id: string) {
        const saved = await this.findDefinitionOrFail(id);
        if (saved.status !== AchievementStatus.DRAFT) {
            badRequest("Only drafts can be deleted");
        }
        await this.definitionRepository.delete({ id });
    }

    async publishDefinition(id: string) {
        const saved = await this.findDefinitionOrFail(id);
        if (saved.status !== AchievementStatus.DRAFT) {
            badRequest("Only drafts can be published");
        }
        await this.validateDefinition(saved, saved.tiers);
        await this.definitionRepository.update(
            { id },
            { status: AchievementStatus.PUBLISHED, publishedAt: new Date() },
        );
        await this.achievementsQueueService.addBackfillJob({
            definitionId: id,
            afterUserId: null,
            generation: saved.tiers.length,
        });
        return this.findDefinitionOrFail(id);
    }

    async archiveDefinition(id: string) {
        const saved = await this.findDefinitionOrFail(id);
        if (saved.status !== AchievementStatus.PUBLISHED) {
            badRequest("Only published definitions can be archived");
        }
        await this.definitionRepository.update(
            { id },
            { status: AchievementStatus.ARCHIVED },
        );
        return this.findDefinitionOrFail(id);
    }

    /**
     * Dry-run: computes the metric without persisting progress, tiers, exp or notifications.
     */
    async simulateDefinition(id: string, userId: string) {
        const definition = await this.findDefinitionOrFail(id);
        const value = await this.achievementsProgressService.computeValue(
            this.dataSource.manager,
            userId,
            definition,
        );
        return {
            value,
            levels: definition.tiers
                .filter((tier) => tier.threshold <= value)
                .map((tier) => tier.level),
        };
    }

    findEvents() {
        return this.eventRepository.find({ order: { startsAt: "DESC" } });
    }

    async findEventOrFail(id: string) {
        const event = await this.eventRepository.findOneBy({ id });
        if (!event) {
            throw new HttpException("Event not found", HttpStatus.NOT_FOUND);
        }
        return event;
    }

    private async validateEvent(event: AchievementEvent) {
        if (event.endsAt <= event.startsAt) {
            badRequest("endsAt must be after startsAt");
        }
        const sameSlug = await this.eventRepository.findOneBy({
            slug: event.slug,
        });
        if (sameSlug && sameSlug.id !== event.id) {
            throw new HttpException(
                "An event with this slug already exists",
                HttpStatus.CONFLICT,
            );
        }
    }

    async createEvent(dto: CreateAchievementEventDto) {
        const event = this.eventRepository.create({
            slug: dto.slug,
            name: dto.name,
            description: dto.description,
            startsAt: dto.startsAt,
            endsAt: dto.endsAt,
            status: AchievementStatus.DRAFT,
        });
        await this.validateEvent(event);
        return this.eventRepository.save(event);
    }

    async updateEvent(id: string, dto: UpdateAchievementEventDto) {
        const saved = await this.findEventOrFail(id);
        if (saved.status === AchievementStatus.ARCHIVED) {
            badRequest("Archived events can't be edited");
        }
        const merged = Object.assign(new AchievementEvent(), saved, {
            slug: dto.slug ?? saved.slug,
            name: dto.name ?? saved.name,
            description: dto.description ?? saved.description,
            startsAt: dto.startsAt ?? saved.startsAt,
            endsAt: dto.endsAt ?? saved.endsAt,
        });
        if (saved.status === AchievementStatus.PUBLISHED) {
            if (merged.startsAt.getTime() !== saved.startsAt.getTime()) {
                badRequest("startsAt can't change after publishing");
            }
            if (merged.endsAt < saved.endsAt) {
                badRequest("endsAt can only be extended after publishing");
            }
        }
        await this.validateEvent(merged);
        return this.eventRepository.save(merged);
    }

    async deleteEvent(id: string) {
        const saved = await this.findEventOrFail(id);
        if (saved.status !== AchievementStatus.DRAFT) {
            badRequest("Only drafts can be deleted");
        }
        if (await this.definitionRepository.existsBy({ eventId: id })) {
            badRequest("Remove the event's definitions first");
        }
        await this.eventRepository.delete({ id });
    }

    async publishEvent(id: string) {
        const saved = await this.findEventOrFail(id);
        if (saved.status !== AchievementStatus.DRAFT) {
            badRequest("Only drafts can be published");
        }
        await this.eventRepository.update(
            { id },
            { status: AchievementStatus.PUBLISHED },
        );
        // Definitions published while the event was a draft were never evaluated
        const definitions = await this.definitionRepository.find({
            where: { eventId: id, status: AchievementStatus.PUBLISHED },
            relations: { tiers: true },
        });
        for (const definition of definitions) {
            await this.achievementsQueueService.addBackfillJob({
                definitionId: definition.id,
                afterUserId: null,
                generation: definition.tiers.length,
            });
        }
        return this.findEventOrFail(id);
    }

    async archiveEvent(id: string) {
        const saved = await this.findEventOrFail(id);
        if (saved.status !== AchievementStatus.PUBLISHED) {
            badRequest("Only published events can be archived");
        }
        await this.eventRepository.update(
            { id },
            { status: AchievementStatus.ARCHIVED },
        );
        return this.findEventOrFail(id);
    }
}
