import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DataSource, EntityManager, Repository } from "typeorm";
import { AchievementStatus } from "../achievements/achievements.constants";
import { AchievementDefinition } from "../achievements/entities/achievement-definition.entity";
import {
    CreateGuildEventDto,
    CreateGuildRewardDto,
    GuildAdminEventResponseDto,
    GuildAdminRewardResponseDto,
    GuildEventTranslationDto,
    UpdateGuildEventDto,
    UpdateGuildRewardDto,
} from "./dto/guild-admin.dto";
import { GuildRewardDescriptorDto } from "./dto/guild-rewards.dto";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildEventTranslation } from "./entities/guild-event-translation.entity";
import { GuildEvent } from "./entities/guild-event.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import {
    GuildCriteria,
    GuildEventStatus,
    GuildObjectiveType,
    GuildRewardKind,
} from "./guild.constants";
import { validateGuildQuestRules } from "./guild-templates.constants";

/** A closed contract must keep the rules it was accepted under (spec: curated events). */
const RULES_LOCKED = {
    message: "This event's quest rules are locked by an accepted contract.",
    code: "guild_event_rules_locked",
};

function badRequest(message: string): never {
    throw new BadRequestException(message);
}

function trimRequired(value: string, field: string): string {
    const trimmed = value.trim();
    if (!trimmed) badRequest(`${field} must not be empty.`);
    return trimmed;
}

function toRewardDescriptor(reward: GuildReward): GuildRewardDescriptorDto {
    return {
        id: reward.id,
        key: reward.key,
        kind: reward.kind,
        achievementId: reward.achievementId,
        inChestPool: reward.inChestPool,
        chestBonusXp: reward.chestBonusXp,
    };
}

function toRewardDto(reward: GuildReward): GuildAdminRewardResponseDto {
    return {
        id: reward.id,
        key: reward.key,
        kind: reward.kind,
        achievementId: reward.achievementId,
        inChestPool: reward.inChestPool,
        chestBonusXp: reward.chestBonusXp,
        isActive: reward.isActive,
        createdAt: reward.createdAt,
        updatedAt: reward.updatedAt,
    };
}

/** Editorial Guild catalog: curated events and reward definitions (design 1). */
@Injectable()
export class GuildAdminService {
    constructor(
        @InjectRepository(GuildEvent)
        private readonly eventRepository: Repository<GuildEvent>,
        @InjectRepository(GuildReward)
        private readonly rewardRepository: Repository<GuildReward>,
        @InjectRepository(AchievementDefinition)
        private readonly achievementRepository: Repository<AchievementDefinition>,
        private readonly dataSource: DataSource,
    ) {}

    async listEvents(): Promise<GuildAdminEventResponseDto[]> {
        const events = await this.eventRepository.find({
            relations: { translations: true, reward: true },
            order: { createdAt: "DESC" },
        });
        return events.map((event) => this.toEventDto(event));
    }

    async getEvent(id: string): Promise<GuildAdminEventResponseDto> {
        return this.toEventDto(await this.findEventOrFail(id));
    }

    async createEvent(
        dto: CreateGuildEventDto,
    ): Promise<GuildAdminEventResponseDto> {
        await this.assertSlugAvailable(dto.slug);

        const title = trimRequired(dto.title, "title");
        const description = trimRequired(dto.description, "description");
        const targetCount = dto.targetCount ?? 1;
        const criteria = dto.criteria ?? {};

        this.assertWindow(dto.startsAt, dto.endsAt);
        this.assertQuestRules(dto.objectiveType, targetCount, criteria);
        if (dto.rewardId !== undefined) {
            await this.assertActiveReward(dto.rewardId);
        }
        const translations = dto.translations
            ? this.validateTranslations(dto.translations)
            : [];

        const id = randomUUID();
        await this.dataSource.transaction(async (manager) => {
            await manager.insert(GuildEvent, {
                id,
                slug: dto.slug,
                title,
                description,
                rank: dto.rank,
                xpReward: dto.xpReward,
                objectiveType: dto.objectiveType,
                targetCount,
                criteria,
                rewardId: dto.rewardId ?? null,
                startsAt: dto.startsAt,
                endsAt: dto.endsAt,
                status: GuildEventStatus.DRAFT,
            });
            await this.insertTranslations(manager, id, translations);
        });

        return this.getEvent(id);
    }

    async updateEvent(
        id: string,
        dto: UpdateGuildEventDto,
    ): Promise<GuildAdminEventResponseDto> {
        const saved = await this.findEventOrFail(id);
        if (dto.slug !== undefined && dto.slug !== saved.slug) {
            await this.assertSlugAvailable(dto.slug);
        }
        await this.assertRulesUnlocked(id, saved, dto);

        const startsAt = dto.startsAt ?? saved.startsAt;
        const endsAt = dto.endsAt ?? saved.endsAt;
        const objectiveType = dto.objectiveType ?? saved.objectiveType;
        const targetCount = dto.targetCount ?? saved.targetCount;
        const criteria = dto.criteria ?? saved.criteria;

        this.assertWindow(startsAt, endsAt);
        this.assertQuestRules(objectiveType, targetCount, criteria);
        if (dto.rewardId !== undefined) {
            await this.assertActiveReward(dto.rewardId);
        }
        const translations =
            dto.translations === undefined
                ? undefined
                : this.validateTranslations(dto.translations);

        const changes: Partial<GuildEvent> = {};
        if (dto.title !== undefined) {
            changes.title = trimRequired(dto.title, "title");
        }
        if (dto.description !== undefined) {
            changes.description = trimRequired(dto.description, "description");
        }
        if (dto.slug !== undefined) changes.slug = dto.slug;
        if (dto.rank !== undefined) changes.rank = dto.rank;
        if (dto.xpReward !== undefined) changes.xpReward = dto.xpReward;
        if (dto.objectiveType !== undefined) {
            changes.objectiveType = dto.objectiveType;
        }
        if (dto.targetCount !== undefined) {
            changes.targetCount = dto.targetCount;
        }
        if (dto.criteria !== undefined) changes.criteria = dto.criteria;
        if (dto.rewardId !== undefined) changes.rewardId = dto.rewardId;
        if (dto.startsAt !== undefined) changes.startsAt = dto.startsAt;
        if (dto.endsAt !== undefined) changes.endsAt = dto.endsAt;

        await this.dataSource.transaction(async (manager) => {
            if (Object.keys(changes).length > 0) {
                await manager.update(GuildEvent, { id }, changes);
            }
            // Omitted preserves the stored set; an explicit array replaces it atomically.
            if (translations !== undefined) {
                await manager.delete(GuildEventTranslation, { eventId: id });
                await this.insertTranslations(manager, id, translations);
            }
        });

        return this.getEvent(id);
    }

    async publishEvent(
        id: string,
        now = new Date(),
    ): Promise<GuildAdminEventResponseDto> {
        const saved = await this.findEventOrFail(id);
        if (saved.status === GuildEventStatus.ARCHIVED) {
            throw new ConflictException("Archived events can't be published.");
        }
        if (saved.endsAt <= now) {
            badRequest("endsAt must be in the future to publish.");
        }
        if (saved.rewardId) {
            const reward = await this.rewardRepository.findOneBy({
                id: saved.rewardId,
            });
            if (reward?.kind === GuildRewardKind.BADGE) {
                await this.assertBadgeAchievementPublished(
                    reward.achievementId,
                );
            }
        }

        await this.eventRepository.update(
            { id },
            { status: GuildEventStatus.PUBLISHED, publishedAt: now },
        );
        return this.getEvent(id);
    }

    async archiveEvent(id: string): Promise<GuildAdminEventResponseDto> {
        // Only the event status changes, so contracts already accepted keep progressing.
        await this.findEventOrFail(id);
        await this.eventRepository.update(
            { id },
            { status: GuildEventStatus.ARCHIVED },
        );
        return this.getEvent(id);
    }

    async listRewards(): Promise<GuildAdminRewardResponseDto[]> {
        const rewards = await this.rewardRepository.find({
            order: { createdAt: "DESC" },
        });
        return rewards.map((reward) => toRewardDto(reward));
    }

    async createReward(
        dto: CreateGuildRewardDto,
    ): Promise<GuildAdminRewardResponseDto> {
        await this.assertKeyAvailable(dto.key);
        const achievementId = dto.achievementId ?? null;
        const inChestPool = dto.inChestPool ?? false;
        await this.assertRewardCatalogRules(
            dto.kind,
            achievementId,
            inChestPool,
        );

        const reward = this.rewardRepository.create({
            id: randomUUID(),
            key: dto.key,
            kind: dto.kind,
            achievementId,
            inChestPool,
            chestBonusXp: dto.chestBonusXp ?? 0,
            isActive: dto.isActive ?? true,
        });
        return toRewardDto(await this.rewardRepository.save(reward));
    }

    async updateReward(
        id: string,
        dto: UpdateGuildRewardDto,
    ): Promise<GuildAdminRewardResponseDto> {
        const saved = await this.findRewardOrFail(id);
        if (dto.key !== undefined && dto.key !== saved.key) {
            await this.assertKeyAvailable(dto.key);
        }

        const kind = dto.kind ?? saved.kind;
        const achievementId =
            dto.achievementId !== undefined
                ? dto.achievementId
                : saved.achievementId;
        const inChestPool = dto.inChestPool ?? saved.inChestPool;
        await this.assertRewardCatalogRules(kind, achievementId, inChestPool);

        if (dto.key !== undefined) saved.key = dto.key;
        if (dto.kind !== undefined) saved.kind = dto.kind;
        if (dto.achievementId !== undefined) {
            saved.achievementId = dto.achievementId;
        }
        if (dto.inChestPool !== undefined) saved.inChestPool = dto.inChestPool;
        if (dto.chestBonusXp !== undefined) {
            saved.chestBonusXp = dto.chestBonusXp;
        }
        if (dto.isActive !== undefined) saved.isActive = dto.isActive;
        return toRewardDto(await this.rewardRepository.save(saved));
    }

    private async findEventOrFail(id: string): Promise<GuildEvent> {
        const event = await this.eventRepository.findOne({
            where: { id },
            relations: { translations: true, reward: true },
        });
        if (!event) throw new NotFoundException("Guild event not found.");
        return event;
    }

    private async findRewardOrFail(id: string): Promise<GuildReward> {
        const reward = await this.rewardRepository.findOneBy({ id });
        if (!reward) throw new NotFoundException("Guild reward not found.");
        return reward;
    }

    private toEventDto(event: GuildEvent): GuildAdminEventResponseDto {
        return {
            id: event.id,
            slug: event.slug,
            title: event.title,
            description: event.description,
            rank: event.rank,
            xpReward: event.xpReward,
            objectiveType: event.objectiveType,
            targetCount: event.targetCount,
            criteria: event.criteria,
            reward: event.reward ? toRewardDescriptor(event.reward) : null,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            status: event.status,
            publishedAt: event.publishedAt,
            translations: [...(event.translations ?? [])]
                .sort((a, b) => a.locale.localeCompare(b.locale))
                .map(({ locale, title, description }) => ({
                    locale,
                    title,
                    description,
                })),
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
        };
    }

    private async assertSlugAvailable(slug: string) {
        if (await this.eventRepository.existsBy({ slug })) {
            throw new ConflictException(
                "An event with this slug already exists.",
            );
        }
    }

    private async assertKeyAvailable(key: string) {
        if (await this.rewardRepository.existsBy({ key })) {
            throw new ConflictException(
                "A reward with this key already exists.",
            );
        }
    }

    private assertWindow(startsAt: Date, endsAt: Date) {
        if (endsAt <= startsAt) badRequest("endsAt must be after startsAt.");
    }

    private assertQuestRules(
        objectiveType: GuildObjectiveType,
        targetCount: number,
        criteria: GuildCriteria,
    ) {
        const errors = validateGuildQuestRules(
            objectiveType,
            targetCount,
            criteria,
        );
        if (errors.length > 0) {
            throw new BadRequestException({
                message: "Invalid quest rules.",
                errors,
            });
        }
    }

    private async assertActiveReward(rewardId: string) {
        const reward = await this.rewardRepository.findOneBy({ id: rewardId });
        if (!reward || !reward.isActive) {
            badRequest("rewardId must reference an active Guild reward.");
        }
        return reward;
    }

    private async assertBadgeAchievementPublished(
        achievementId: string | null,
    ) {
        const definition = achievementId
            ? await this.achievementRepository.findOneBy({ id: achievementId })
            : null;
        if (definition?.status !== AchievementStatus.PUBLISHED) {
            badRequest(
                "A badge event requires a published achievement definition.",
            );
        }
    }

    private async assertRewardCatalogRules(
        kind: GuildRewardKind,
        achievementId: string | null,
        inChestPool: boolean,
    ) {
        if (kind === GuildRewardKind.BADGE) {
            if (!achievementId) {
                badRequest("Badge rewards require an achievementId.");
            }
            if (
                !(await this.achievementRepository.existsBy({
                    id: achievementId,
                }))
            ) {
                badRequest(
                    `Achievement definition ${achievementId} not found.`,
                );
            }
        }
        if (
            inChestPool &&
            kind !== GuildRewardKind.TITLE &&
            kind !== GuildRewardKind.AVATAR_FRAME
        ) {
            badRequest(
                "inChestPool is only supported for title and avatar_frame rewards.",
            );
        }
    }

    private async assertRulesUnlocked(
        id: string,
        saved: GuildEvent,
        dto: UpdateGuildEventDto,
    ) {
        const hasContracts = await this.dataSource
            .getRepository(GuildContract)
            .existsBy({ eventId: id });
        if (!hasContracts) return;

        const changed: Array<keyof UpdateGuildEventDto> = [];
        if (
            dto.objectiveType !== undefined &&
            dto.objectiveType !== saved.objectiveType
        ) {
            changed.push("objectiveType");
        }
        if (
            dto.targetCount !== undefined &&
            dto.targetCount !== saved.targetCount
        ) {
            changed.push("targetCount");
        }
        if (dto.xpReward !== undefined && dto.xpReward !== saved.xpReward) {
            changed.push("xpReward");
        }
        if (dto.rewardId !== undefined && dto.rewardId !== saved.rewardId) {
            changed.push("rewardId");
        }
        if (
            dto.criteria !== undefined &&
            !isDeepStrictEqual(dto.criteria, saved.criteria)
        ) {
            changed.push("criteria");
        }
        if (changed.length > 0) throw new ConflictException(RULES_LOCKED);
    }

    private validateTranslations(
        translations: GuildEventTranslationDto[],
    ): GuildEventTranslationDto[] {
        const locales = new Set<string>();
        return translations.map(({ locale, title, description }) => {
            if (locales.has(locale)) {
                badRequest("Duplicate translation locales are not allowed.");
            }
            locales.add(locale);
            return {
                locale,
                title: trimRequired(title, `translations.${locale}.title`),
                description: trimRequired(
                    description,
                    `translations.${locale}.description`,
                ),
            };
        });
    }

    private async insertTranslations(
        manager: EntityManager,
        eventId: string,
        translations: GuildEventTranslationDto[],
    ) {
        if (translations.length === 0) return;
        await manager.insert(
            GuildEventTranslation,
            translations.map(({ locale, title, description }) => ({
                eventId,
                locale,
                title,
                description,
            })),
        );
    }
}
