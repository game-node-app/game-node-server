import { Inject, Injectable, Optional } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, FindOptionsWhere, In, Repository } from "typeorm";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { LibraryAccessService } from "../libraries/library-access.service";
import { LibraryVisibility } from "../libraries/library-visibility.constants";
import {
    JournalEntryStatusDto,
    JournalOverviewResponseDto,
} from "./dto/get-journal-overview.dto";
import { getAssociatedStatusDates } from "../collections/collections-entries/util/getAssociatedStatusDates";
import { resolveLibraryAudienceKey } from "../profile/profile-metrics/library-audience-key";

const OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const OVERVIEW_CACHE_PREFIX = "journal:overview:v1";
/** Widened SQL bounds keep every local-calendar date of the year before the exact in-memory filter. */
const YEAR_BOUND_MARGIN_MS = 2 * 24 * 60 * 60 * 1000;

@Injectable()
export class JournalService {
    constructor(
        @InjectRepository(CollectionEntry)
        private readonly collectionEntriesRepository: Repository<CollectionEntry>,
        private readonly libraryAccessService: LibraryAccessService,
        @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
    ) {}

    async getOverview(
        userId: string | undefined,
        targetUserId: string,
        year?: number,
    ): Promise<JournalOverviewResponseDto> {
        const access = await this.libraryAccessService.resolve(
            userId,
            targetUserId,
        );
        if (!access.canViewLibrary || access.visibleEntryLevels.length === 0) {
            return { years: [] };
        }

        const audienceKey = await resolveLibraryAudienceKey(
            this.libraryAccessService,
            targetUserId,
            access,
        );
        const cacheKey = [
            OVERVIEW_CACHE_PREFIX,
            targetUserId,
            audienceKey.audience,
            audienceKey.visibleEntryLevels.join(","),
            audienceKey.hiddenFingerprint,
            year ?? "all",
        ].join(":");

        const cached = await this.cache
            ?.get<JournalOverviewResponseDto>(cacheKey)
            .catch(() => undefined);
        if (cached != null) return cached;

        const collectionEntries = await this.collectionEntriesRepository.find({
            select: [
                "id",
                "gameId",
                "startedAt",
                "finishedAt",
                "droppedAt",
                "plannedAt",
            ],
            where: this.overviewWhere(
                targetUserId,
                access.visibleEntryLevels,
                year,
            ),
        });

        const overview = this.buildOverview(collectionEntries, year);

        await this.cache
            ?.set(cacheKey, overview, OVERVIEW_CACHE_TTL_MS)
            .catch(() => undefined);
        return overview;
    }

    private overviewWhere(
        targetUserId: string,
        visibleEntryLevels: LibraryVisibility[],
        year: number | undefined,
    ): FindOptionsWhere<CollectionEntry> | FindOptionsWhere<CollectionEntry>[] {
        const base = {
            libraryUserId: targetUserId,
            visibility: In(visibleEntryLevels),
        };
        if (year === undefined) return base;

        const lower = new Date(Date.UTC(year, 0, 1) - YEAR_BOUND_MARGIN_MS);
        const upper = new Date(Date.UTC(year + 1, 0, 1) + YEAR_BOUND_MARGIN_MS);
        return [
            { ...base, startedAt: Between(lower, upper) },
            { ...base, finishedAt: Between(lower, upper) },
            { ...base, droppedAt: Between(lower, upper) },
            { ...base, plannedAt: Between(lower, upper) },
        ];
    }

    private buildOverview(
        collectionEntries: CollectionEntry[],
        year: number | undefined,
    ): JournalOverviewResponseDto {
        const orderedCollectionEntries = collectionEntries.toSorted((a, b) => {
            const associatedDatesA = getAssociatedStatusDates(a).map(
                (x) => x.date,
            );
            const associatedDatesB = getAssociatedStatusDates(b).map(
                (x) => x.date,
            );

            const latestDateA = associatedDatesA.length
                ? Math.max(...associatedDatesA.map((date) => date.getTime()))
                : -Infinity;
            const latestDateB = associatedDatesB.length
                ? Math.max(...associatedDatesB.map((date) => date.getTime()))
                : -Infinity;

            return latestDateB - latestDateA;
        });

        /**
         * Year -> Month -> Day groups
         */
        const groups = new Map<
            number,
            Map<number, Map<number, JournalEntryStatusDto[]>>
        >();

        for (const collectionEntry of orderedCollectionEntries) {
            const associatedDates = getAssociatedStatusDates(collectionEntry);
            for (const { date, status } of associatedDates) {
                // The SQL bounds are widened for timezones, so the calendar year is checked here.
                if (year !== undefined && date.getFullYear() !== year) continue;

                const dateYear = date.getFullYear();
                const month = date.getMonth();
                const day = date.getDate();

                if (!groups.has(dateYear)) {
                    groups.set(dateYear, new Map());
                }

                if (!groups.get(dateYear)?.has(month)) {
                    groups.get(dateYear)?.set(month, new Map());
                }

                if (!groups.get(dateYear)?.get(month)?.has(day)) {
                    groups.get(dateYear)?.get(month)?.set(day, []);
                }

                groups.get(dateYear)?.get(month)?.get(day)?.push({
                    collectionEntryId: collectionEntry.id,
                    status: status,
                    gameId: collectionEntry.gameId,
                });
            }
        }

        return {
            years: Array.from(groups.entries()).map(([year, monthMaps]) => {
                const entriesInMonths = Array.from(monthMaps).map(
                    ([month, dayMaps]) => {
                        const entriesInDays = Array.from(dayMaps).map(
                            ([day, entries]) => {
                                return {
                                    day,
                                    entries,
                                };
                            },
                        );

                        return {
                            month,
                            days: entriesInDays,
                        };
                    },
                );

                return {
                    year,
                    months: entriesInMonths,
                };
            }),
        };
    }
}
