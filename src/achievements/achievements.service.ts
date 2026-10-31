import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { FindOptionsOrder, In, Not, Repository } from "typeorm";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { AchievementDefinition } from "./entities/achievement-definition.entity";
import { AchievementEvent } from "./entities/achievement-event.entity";
import { AchievementProgress } from "./entities/achievement-progress.entity";
import { Profile } from "../profile/entities/profile.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { listToPaginationData } from "../utils/pagination/listToPaginationData";
import {
    GetAchievementsRequestDto,
    GetAchievementsV2RequestDto,
} from "./dto/get-achievements-request.dto";
import {
    UpdateFeaturedObtainedAchievementDto,
    UpdateFeaturedObtainedAchievementV2Dto,
} from "./dto/update-featured-obtained-achievement.dto";
import {
    GetObtainedAchievementRequestDto,
    ObtainedAchievementDto,
} from "./dto/obtained-achivement-request.dto";
import { AchievementDto } from "./dto/achievement.dto";
import {
    AchievementEventsResponseDto,
    AchievementProgressDto,
    AchievementV2Dto,
} from "./dto/achievement-v2.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { AchievementStatus } from "./achievements.constants";
import {
    AchievementsProgressService,
    effectiveWindow,
} from "./achievements-progress.service";

const TOTAL_PROFILES_CACHE_KEY = "achievements:total-profiles";
const TOTAL_PROFILES_CACHE_TTL_MS = 60 * 60 * 1000;

function toAchievementDto(definition: AchievementDefinition): AchievementDto {
    return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        expGainAmount:
            definition.tiers.find((tier) => tier.level === 1)?.expReward ?? 0,
        category: definition.category,
    };
}

/**
 * Public reads of platform achievements (v1 keeps the legacy shape) and manual grants.
 */
@Injectable()
export class AchievementsService {
    constructor(
        @InjectRepository(ObtainedAchievement)
        private obtainedAchievementsRepository: Repository<ObtainedAchievement>,
        @InjectRepository(AchievementEvent)
        private eventRepository: Repository<AchievementEvent>,
        @InjectRepository(AchievementProgress)
        private progressRepository: Repository<AchievementProgress>,
        private achievementsProgressService: AchievementsProgressService,
        @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
    ) {}

    /**
     * shortcut: catalogs are paginated in memory, upgrade to SQL pagination if definitions reach the thousands
     */
    public async getAchievements(
        dto: GetAchievementsRequestDto,
    ): Promise<TPaginationData<AchievementDto>> {
        const definitions =
            await this.achievementsProgressService.findEvaluable();
        return listToPaginationData(
            definitions
                .filter((definition) => !definition.isHidden)
                .map(toAchievementDto),
            dto?.offset,
            dto?.limit,
        );
    }

    /**
     * Published definition that can be granted, or null.
     */
    public async findGrantableDefinition(achievementId: string) {
        const [definition] =
            await this.achievementsProgressService.findEvaluable({
                id: achievementId,
            });
        return definition ?? null;
    }

    /**
     * One item per definition, at the highest obtained tier and featured if any of its tiers is.
     */
    private async findObtained(
        userId: string,
        achievementId?: string,
        order?: FindOptionsOrder<ObtainedAchievement>,
    ): Promise<ObtainedAchievementDto[]> {
        const rows = await this.obtainedAchievementsRepository.find({
            where: { profileUserId: userId, achievementId },
            relations: { definition: { tiers: true } },
            order,
        });
        const grouped = new Map<string, ObtainedAchievement>();
        for (const row of rows) {
            const current = grouped.get(row.achievementId);
            const isFeatured = row.isFeatured || !!current?.isFeatured;
            if (!current || row.tier > current.tier) {
                grouped.set(row.achievementId, { ...row, isFeatured });
            } else {
                current.isFeatured = isFeatured;
            }
        }
        // tier and definition are left out to keep the v1 response shape
        return [...grouped.values()].map(
            ({ definition, tier: _tier, ...row }) => ({
                ...row,
                achievement: toAchievementDto(definition!),
            }),
        ) as ObtainedAchievementDto[];
    }

    async getObtainedAchievementByAchievementId(
        targetUserId: string,
        achievementId: string,
    ) {
        const [achievement] = await this.findObtained(
            targetUserId,
            achievementId,
        );

        if (achievement) return achievement;

        throw new HttpException("User has not obtained this achievement.", 404);
    }

    async getObtainedAchievementsByUserId(
        dto: GetObtainedAchievementRequestDto,
    ) {
        const obtained = await this.findObtained(
            dto.targetUserId,
            undefined,
            buildBaseFindOptions(dto).order,
        );
        return dto.isFeatured == undefined
            ? obtained
            : obtained.filter(
                  (achievement) => achievement.isFeatured === dto.isFeatured,
              );
    }

    /**
     * @deprecated - old API when only one featured achievement was possible
     * @param userId
     * @param achievementId
     * @param dto
     */
    async updateFeaturedObtainedAchievement(
        userId: string,
        achievementId: string,
        dto: UpdateFeaturedObtainedAchievementDto,
    ) {
        await this.getObtainedAchievementByAchievementId(userId, achievementId);
        await this.obtainedAchievementsRepository.update(
            {
                achievementId,
                profileUserId: userId,
            },
            {
                isFeatured: dto.isFeatured,
            },
        );

        /**
         * Disables isFeatured flag of any other obtained achievement
         */
        if (dto.isFeatured) {
            await this.obtainedAchievementsRepository.update(
                {
                    achievementId: Not(achievementId),
                    profileUserId: userId,
                    isFeatured: true,
                },
                {
                    isFeatured: false,
                },
            );
        }
    }

    /**
     * Marks provided achievements ids as featured for a user,
     * and automatically disables the isFeatured flag from everything else.
     * @param userId
     * @param dto
     */
    async updateFeaturedObtainedAchievements(
        userId: string,
        dto: UpdateFeaturedObtainedAchievementV2Dto,
    ) {
        await this.obtainedAchievementsRepository.update(
            {
                achievementId: In(dto.featuredAchievementIds),
                profileUserId: userId,
            },
            {
                isFeatured: true,
            },
        );

        await this.obtainedAchievementsRepository.update(
            {
                achievementId: Not(In(dto.featuredAchievementIds)),
                profileUserId: userId,
            },
            {
                isFeatured: false,
            },
        );
    }

    /**
     * Manually grants the first tier of a published definition.
     */
    async grantAchievement(targetUserId: string, achievementId: string) {
        const definition = await this.findGrantableDefinition(achievementId);
        if (!definition) {
            throw new HttpException(
                "achievementId doesn't exist. Please check request parameters.",
                HttpStatus.BAD_REQUEST,
            );
        }
        await this.achievementsProgressService.grantTiers(
            targetUserId,
            definition,
            [1],
            "manual",
        );
    }

    async grantAchievements(
        targetUserIds: Array<string>,
        achievementId: string,
    ) {
        for (const targetUserId of targetUserIds) {
            await this.grantAchievement(targetUserId, achievementId);
        }
    }

    private async getTotalProfiles(): Promise<number> {
        const cached = await this.cache
            ?.get<number>(TOTAL_PROFILES_CACHE_KEY)
            .catch(() => undefined);
        if (cached != undefined) return cached;
        const total =
            await this.obtainedAchievementsRepository.manager.count(Profile);
        await this.cache
            ?.set(TOTAL_PROFILES_CACHE_KEY, total, TOTAL_PROFILES_CACHE_TTL_MS)
            .catch(() => undefined);
        return total;
    }

    private async findObtainedIds(userId: string | undefined) {
        if (!userId) return new Set<string>();
        const rows = await this.obtainedAchievementsRepository.find({
            select: { achievementId: true },
            where: { profileUserId: userId },
        });
        return new Set(rows.map((row) => row.achievementId));
    }

    async getAchievementsV2(
        dto: GetAchievementsV2RequestDto,
    ): Promise<TPaginationData<AchievementV2Dto>> {
        const [definitions, obtainedIds, totalProfiles] = await Promise.all([
            this.achievementsProgressService.findEvaluable(),
            this.findObtainedIds(dto.targetUserId),
            this.getTotalProfiles(),
        ]);
        const items = definitions.map((definition): AchievementV2Dto => {
            const isMasked =
                definition.isHidden && !obtainedIds.has(definition.id);
            const window = effectiveWindow(definition);
            const event = definition.event;
            return {
                id: definition.id,
                isHidden: definition.isHidden,
                name: isMasked ? null : definition.name,
                description: isMasked ? null : definition.description,
                category: definition.category,
                metric: isMasked ? null : definition.metric,
                criteria: isMasked ? null : definition.criteria,
                icon: isMasked ? null : definition.icon,
                event: event && {
                    id: event.id,
                    slug: event.slug,
                    name: event.name,
                    description: event.description,
                    startsAt: event.startsAt,
                    endsAt: event.endsAt,
                },
                startsAt: window?.startsAt ?? null,
                endsAt: window?.endsAt ?? null,
                tiers: definition.tiers.map((tier) => ({
                    level: tier.level,
                    threshold: tier.threshold,
                    expReward: tier.expReward,
                    obtainedCount: tier.obtainedCount,
                    rarity:
                        totalProfiles > 0
                            ? Math.min(tier.obtainedCount / totalProfiles, 1)
                            : 0,
                })),
            };
        });
        return listToPaginationData(items, dto?.offset, dto?.limit);
    }

    /**
     * Progress of every visible definition for the user, in one request.
     */
    async getProgress(userId: string): Promise<AchievementProgressDto[]> {
        const [definitions, progress, obtained] = await Promise.all([
            this.achievementsProgressService.findEvaluable(),
            this.progressRepository.find({ where: { profileUserId: userId } }),
            this.obtainedAchievementsRepository.find({
                select: { achievementId: true, tier: true },
                where: { profileUserId: userId },
            }),
        ]);
        return definitions
            .filter(
                (definition) =>
                    !definition.isHidden ||
                    obtained.some((row) => row.achievementId === definition.id),
            )
            .map((definition) => {
                const tier = Math.max(
                    0,
                    ...obtained
                        .filter((row) => row.achievementId === definition.id)
                        .map((row) => row.tier),
                );
                return {
                    achievementId: definition.id,
                    value:
                        progress.find(
                            (row) => row.definitionId === definition.id,
                        )?.value ?? 0,
                    tier,
                    nextThreshold:
                        definition.tiers.find((next) => next.level > tier)
                            ?.threshold ?? null,
                };
            });
    }

    async getEvents(): Promise<AchievementEventsResponseDto> {
        const events = await this.eventRepository.find({
            where: { status: AchievementStatus.PUBLISHED },
            order: { startsAt: "ASC" },
        });
        const now = new Date();
        return {
            active: events.filter(
                (event) => event.startsAt <= now && event.endsAt > now,
            ),
            upcoming: events.filter((event) => event.startsAt > now),
            past: events.filter((event) => event.endsAt <= now),
        };
    }
}
