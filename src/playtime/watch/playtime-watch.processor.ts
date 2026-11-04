import { GogSyncService } from "../../sync/gog/gog-sync.service";
import { generateChecksum } from "../../utils/checksum";
import {
    assertPlayerSyncActive,
    recordPlayerSyncStats,
} from "../../sync/player-sync-attempt";
import { OnWorkerEvent, Processor } from "@nestjs/bullmq";
import {
    PLAYTIME_WATCH_QUEUE_JOB_NAME,
    PLAYTIME_WATCH_QUEUE_NAME,
    PlaytimeWatchJob,
    PlaytimeWatchJobProgress,
} from "./playtime-watch.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job, UnrecoverableError } from "bullmq";
import { ConnectionProviderRegistry } from "../../connection/connection-provider.registry";
import { ConnectionsService } from "../../connection/connections.service";
import { EConnectionType } from "../../connection/connections.constants";
import {
    SteamSyncService,
    steamGameName,
} from "../../sync/steam/steam-sync.service";
import { PsnSyncService } from "../../sync/psn/psn-sync.service";
import { ExternalGameService } from "../../game/external-game/external-game.service";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import { PlaytimeService } from "../playtime.service";
import { UserPlaytimeSource } from "../playtime.constants";
import dayjs from "dayjs";
import { CreateUserPlaytimeDto } from "../dto/create-user-playtime.dto";
import { XboxSyncService } from "../../sync/xbox/xbox-sync.service";
import { EpicSyncService } from "../../sync/epic/epic-sync.service";
import { NintendoSyncService } from "../../sync/nintendo/nintendo-sync.service";
import { NINTENDO_PLATFORM_IDS } from "../../sync/nintendo/nintendo-sync.types";
import { registerUnmappedEpicNamespaces } from "../../sync/epic/register-unmapped-epic-namespaces";
import { ExternalGameMappingsService } from "../../game/external-game/external-game-mappings.service";
import * as process from "process";
import { seconds } from "@nestjs/throttler";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { match } from "ts-pattern";
import { getPreferredXboxPlatformAbbreviation } from "../../sync/xbox/util/get-preferred-xbox-platform-abbreviation";
import { GameAchievementSyncQueueService } from "../../game/game-achievement/sync/game-achievement-sync-queue.service";

@Processor(PLAYTIME_WATCH_QUEUE_NAME, {
    concurrency: 1,
    limiter:
        process.env.NODE_ENV === "development"
            ? {
                  max: 1,
                  duration: seconds(60),
              }
            : undefined,
})
export class PlaytimeWatchProcessor extends WorkerHostProcessor {
    logger = new Logger(PlaytimeWatchProcessor.name);

    constructor(
        private readonly playtimeService: PlaytimeService,
        private readonly connectionsService: ConnectionsService,
        private readonly externalGameService: ExternalGameService,
        private readonly externalGameMappingsService: ExternalGameMappingsService,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly gameAchievementSyncQueueService: GameAchievementSyncQueueService,
        private readonly registry: ConnectionProviderRegistry,
        private readonly epicSyncService: EpicSyncService,
        private readonly nintendoSyncService: NintendoSyncService,
        private readonly gogSyncService: GogSyncService,
    ) {
        super();
        registry.registerSyncHandlers(EConnectionType.STEAM, {
            fetchPlaytime: (job) => this.updateSteamPlaytimeInfo(job),
        });
        registry.registerSyncHandlers(EConnectionType.PSN, {
            fetchPlaytime: (job) => this.updatePsnPlaytimeInfo(job),
        });
        registry.registerSyncHandlers(EConnectionType.XBOX, {
            fetchPlaytime: (job) => this.updateXboxPlaytimeInfo(job),
        });
        registry.registerSyncHandlers(EConnectionType.EPIC_GAMES, {
            fetchPlaytime: (job) => this.updateEpicPlaytimeInfo(job),
        });
        registry.registerSyncHandlers(EConnectionType.GOG, {
            fetchPlaytime: (job) => this.updateGogPlaytimeInfo(job),
        });
        registry.registerSyncHandlers(EConnectionType.NINTENDO, {
            fetchPlaytime: (job) => this.updateNintendoPlaytimeInfo(job),
        });
    }

    async updatePlaytimeInfo(
        source: string | EConnectionType,
        job: Job<PlaytimeWatchJob>,
    ) {
        const provider = this.registry.get(source);
        const handler = provider.syncHandlers?.fetchPlaytime;
        if (!provider.isPlaytimeImportViable || !handler) {
            throw new UnrecoverableError("Unsupported player source");
        }
        return handler(job);
    }

    async process(_job: Job) {
        return { outcome: "legacy-skip" };
    }

    @OnWorkerEvent("progress")
    async onProgress(job: Job<PlaytimeWatchJob>) {
        if (!(job.name === PLAYTIME_WATCH_QUEUE_JOB_NAME)) {
            return;
        }
        const userId = job.data.userId;
        const source = job.data.source;
        const { error, totalUpdatedGames, gameName, platform } =
            job.progress as PlaytimeWatchJobProgress;

        if (error) {
            this.logger.error(
                `Playtime update failed for user ${userId} in ${source}: ${error}`,
            );
            return;
        }
        if (totalUpdatedGames != undefined) {
            this.logger.log(
                `Updated ${totalUpdatedGames} games for user ${userId} in ${source}.`,
            );
            return;
        }

        if (gameName != undefined) {
            this.logger.log(
                `Updated playtime for game ${gameName} in platform ${platform} for user ${userId} in ${source}.`,
            );
        }
    }

    @OnWorkerEvent("failed")
    async onFailed(job: Job<PlaytimeWatchJob>) {
        if (!(job.name === PLAYTIME_WATCH_QUEUE_JOB_NAME)) {
            return;
        }

        const { failedReason } = job;
        const userId = job.data.userId;
        const source = job.data.source;
        this.logger.error(
            `Playtime update failed for user ${userId} in ${source}: ${failedReason}`,
        );
    }

    async updateSteamPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.STEAM,
            );

        /**
         * We list entries from both the full library and recently played games
         * endpoints to mitigate potential issues with the library endpoint after a Steam API change in
         * mid 2024, which caused many users to have no playtime info or games listed at all.
         * The recently played games endpoint is not affected by this change, but only returns games played in the last two weeks,
         * so we use it as a fallback to at least get some playtime info for affected users.
         * The recently played games endpoint also include Family Sharing games, unlike the getAllGames endpoint.
         */
        const userGames = await this.steamSyncService.getLibraryGames(
            connection.sourceUserId,
        );

        recordPlayerSyncStats({ gamesSeen: userGames.length });
        if (userGames.length === 0) {
            job.updateProgress({
                totalUpdatedGames: 0,
            } satisfies PlaytimeWatchJobProgress);
            return {
                outcome: "empty" as const,
                externalGamesProcessed: [],
            };
        }

        const gamesUids = Array.from(
            new Set(userGames.map((item) => `${item.game.id}`)),
        );

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.Steam,
            );

        const mappedUids = new Set(externalGames.map((game) => game.uid));
        const steamNames = new Map(
            userGames.map((item) => [`${item.game.id}`, steamGameName(item)]),
        );
        assertPlayerSyncActive();
        await this.externalGameService.registerUnmappedGames(
            EGameExternalGameCategory.Steam,
            gamesUids
                .filter((uid) => !mappedUids.has(uid))
                .map((sourceUid) => ({
                    sourceUid,
                    name: steamNames.get(sourceUid),
                })),
            userId,
        );
        const userGamesByApp = Map.groupBy(userGames, (game) =>
            String(game.game.id),
        );

        const PC_PLATFORM_ID = 6;

        /**
         * In some cases, different game editions (with different app ids) point to the same gameId.
         * e.g.: Metro Exodus (AppID 412020) and Metro Exodus Enhanced Edition (AppID 1449560). <br >
         * We group so we may merge playtime for different versions.
         */
        const groupedByGameId = Map.groupBy(
            externalGames,
            (item) => item.gameId,
        );

        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.STEAM,
            [...groupedByGameId.keys()],
        );
        const playtimes: CreateUserPlaytimeDto[] = [];
        for (const [gameId, items] of groupedByGameId.entries()) {
            const relatedUserGames = items.flatMap(
                (item) => userGamesByApp.get(item.uid) ?? [],
            );

            const recentPlaytimeSeconds = relatedUserGames.reduce(
                (acc, item) => {
                    return acc + item.recentMinutes * 60;
                },
                0,
            );

            const totalPlaytimeSeconds = relatedUserGames.reduce(
                (acc, item) => {
                    return acc + item.minutes * 60;
                },
                0,
            );

            const existingPlaytimeInfo = existing.get(
                `${gameId}:${PC_PLATFORM_ID}`,
            );

            const hasChangedTotalPlaytime =
                existingPlaytimeInfo != undefined &&
                existingPlaytimeInfo.totalPlaytimeSeconds !==
                    totalPlaytimeSeconds;

            /**
             * After a recent Steam API change, most users won't have the 'lastPlayedTimestamp' defined.
             * This limits most features that rely on the 'lastPlayedDate' being present, like wrapped (recently played games).
             * We simply define the last played date as the week before last as a fallback if the user has recent playtime.
             * PS: Steam always considers the two last weeks for "recentMinutes".
             * PS2: This is also updated below if we detect the game has been played 'today'.
             */
            let lastPlayedDate: Date | undefined;
            if (recentPlaytimeSeconds) {
                const currentLastPlayedDate =
                    existingPlaytimeInfo?.lastPlayedDate
                        ? dayjs(existingPlaytimeInfo?.lastPlayedDate)
                        : null;

                const weekBeforeLast = dayjs().subtract(2, "weeks");

                // Only manually updates if the last persisted date is older than two weeks ago.
                if (
                    currentLastPlayedDate == null ||
                    weekBeforeLast.isAfter(currentLastPlayedDate)
                ) {
                    lastPlayedDate = weekBeforeLast.toDate();
                }
            }

            for (const externalGame of items) {
                assertPlayerSyncActive();
                await this.gameAchievementSyncQueueService.addUserSyncJob(
                    userId,
                    externalGame.id,
                    EConnectionType.STEAM,
                    generateChecksum(
                        (userGamesByApp.get(externalGame.uid) ?? []).map(
                            (game) => [
                                game.game.id,
                                game.minutes ?? 0,
                                game.recentMinutes ?? 0,
                            ],
                        ),
                    ),
                );
            }

            const playtime: CreateUserPlaytimeDto = {
                totalPlayCount: 0,
                ...existingPlaytimeInfo,
                gameId: gameId,
                profileUserId: userId,
                lastPlayedDate: lastPlayedDate,
                totalPlaytimeSeconds: totalPlaytimeSeconds,
                recentPlaytimeSeconds: recentPlaytimeSeconds,
                firstPlayedDate: undefined,
                source: UserPlaytimeSource.STEAM,
                platformId: PC_PLATFORM_ID,
            };

            // We infer the game was played 'today'.
            if (hasChangedTotalPlaytime) {
                playtime.lastPlayedDate = new Date();
            }

            job.updateProgress({
                gameName: items[0].name,
                platform: "PC",
                totalPlaytimeSeconds: totalPlaytimeSeconds,
            } satisfies PlaytimeWatchJobProgress);

            assertPlayerSyncActive();
            playtimes.push(playtime);
        }
        await this.playtimeService.saveImported(playtimes, existing);

        job.updateProgress({
            totalUpdatedGames: groupedByGameId.size,
        } satisfies PlaytimeWatchJobProgress);
    }

    async updatePsnPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.PSN,
            );

        const [userGames, userTrophyTitles] = await Promise.all([
            this.psnSyncService.getAllGames(connection.sourceUserId),
            this.psnSyncService.getUserTrophyTitles(connection.sourceUserId),
        ]);

        recordPlayerSyncStats({ gamesSeen: userGames.length });
        if (userGames.length === 0) {
            job.updateProgress({
                totalUpdatedGames: 0,
            });
            return { outcome: "empty" as const };
        }

        const gamesUids = [
            ...new Set(userGames.map((item) => `${item.concept.id}`)),
        ];

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                gamesUids,
                EGameExternalGameCategory.PlaystationStoreUs,
            );

        const mappedUids = new Set(externalGames.map((game) => game.uid));
        const psnNames = new Map(
            userGames.map((item) => [`${item.concept.id}`, item.name]),
        );
        assertPlayerSyncActive();
        await this.externalGameService
            .registerUnmappedGames(
                EGameExternalGameCategory.PlaystationStoreUs,
                gamesUids
                    .filter((uid) => !mappedUids.has(uid))
                    .map((sourceUid) => ({
                        sourceUid,
                        name: psnNames.get(sourceUid),
                    })),
                userId,
            )
            .catch((err) => this.logger.error(err));

        const groupedByConcept = Map.groupBy(userGames, (item) =>
            String(item.concept.id),
        );
        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );
        const externalByConcept = new Map(
            externalGames.map((game) => [game.uid, game]),
        );
        const trophyByIdentity = new Map(
            userTrophyTitles.map((title) => [
                `${title.npCommunicationId}:${title.npServiceName}`,
                title,
            ]),
        );
        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.PSN,
            externalGames.map((game) => game.gameId),
        );
        const playtimes: CreateUserPlaytimeDto[] = [];
        let unresolved = 0;
        for (const [conceptId, titles] of groupedByConcept) {
            const relatedExternalGame = externalByConcept.get(conceptId);
            if (!relatedExternalGame) continue;
            // shortcut: the SDK exposes no concept-to-trophy association, retain persisted mappings until a verified source is available.
            const mappings = relatedExternalGame.psnExtraMappings ?? [];
            if (!mappings.length) unresolved++;
            for (const mapping of mappings)
                await this.externalGameMappingsService.upsertPsnMappings({
                    externalGameId: relatedExternalGame.id,
                    npServiceName: mapping.npServiceName,
                    npCommunicationId: mapping.npCommunicationId,
                });
            if (mappings.length) {
                const progress = mappings
                    .map((mapping) => {
                        const identity = `${mapping.npCommunicationId}:${mapping.npServiceName}`;
                        const trophy = trophyByIdentity.get(identity);
                        return [
                            identity,
                            trophy?.trophySetVersion ?? null,
                            trophy?.lastUpdatedDateTime ?? null,
                            trophy?.progress ?? null,
                            trophy?.earnedTrophies ?? null,
                        ];
                    })
                    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
                await this.gameAchievementSyncQueueService.addUserSyncJob(
                    userId,
                    relatedExternalGame.id,
                    EConnectionType.PSN,
                    generateChecksum(progress),
                );
            }
            for (const title of titles) {
                const targetPlatform = match(title.category)
                    .with("ps5_native_game", () => platformsMap.get("PS5")!)
                    .with("ps4_game", () => platformsMap.get("PS4")!)
                    .with("pspc_game", () => platformsMap.get("PSP")!)
                    .otherwise(() => platformsMap.get("PS3")!);
                const existingPlaytimeInfo = existing.get(
                    `${relatedExternalGame.gameId}:${targetPlatform.id}`,
                );
                const playtime: CreateUserPlaytimeDto = {
                    ...existingPlaytimeInfo,
                    gameId: relatedExternalGame.gameId,
                    firstPlayedDate: new Date(title.firstPlayedDateTime),
                    lastPlayedDate: new Date(title.lastPlayedDateTime),
                    profileUserId: userId,
                    totalPlaytimeSeconds: dayjs
                        .duration(title.playDuration)
                        .asSeconds(),
                    recentPlaytimeSeconds: undefined,
                    totalPlayCount: title.playCount,
                    source: UserPlaytimeSource.PSN,
                    platformId: targetPlatform.id,
                };
                job.updateProgress({
                    gameName: relatedExternalGame.name,
                    platform: targetPlatform.abbreviation,
                    totalPlaytimeSeconds: playtime.totalPlaytimeSeconds,
                } satisfies PlaytimeWatchJobProgress);
                assertPlayerSyncActive();
                playtimes.push(playtime);
            }
        }

        await this.playtimeService.saveImported(playtimes, existing);
        if (unresolved)
            this.logger.log({
                event: "psn-unresolved-mapping",
                games: unresolved,
            });
        job.updateProgress({
            totalUpdatedGames: groupedByConcept.size,
        } satisfies PlaytimeWatchJobProgress);
    }

    async updateXboxPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.XBOX,
            );

        const allGames = await this.xboxSyncService.getAllGames(
            connection.sourceUserId,
        );

        recordPlayerSyncStats({ gamesSeen: allGames.length });
        if (allGames.length === 0) {
            job.updateProgress({
                totalUpdatedGames: 0,
            });
            return { outcome: "empty" as const };
        }

        const sourceUids = [...new Set(allGames.map((game) => game.productId))];

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                sourceUids,
                EGameExternalGameCategory.Microsoft,
            );

        const externalByProduct = new Map(
            externalGames.map((game) => [game.uid, game]),
        );
        const xboxNames = new Map(
            allGames.map((game) => [game.productId, game.name]),
        );
        assertPlayerSyncActive();
        await this.externalGameService.registerUnmappedGames(
            EGameExternalGameCategory.Microsoft,
            sourceUids
                .filter((uid) => !externalByProduct.has(uid))
                .map((sourceUid) => ({
                    sourceUid,
                    name: xboxNames.get(sourceUid),
                })),
            userId,
        );
        const relevantTitles = allGames.filter((game) =>
            externalByProduct.has(game.productId),
        );
        for (const game of relevantTitles) {
            await this.gameAchievementSyncQueueService.addUserSyncJob(
                userId,
                externalByProduct.get(game.productId)!.id,
                EConnectionType.XBOX,
                generateChecksum([
                    game.titleId,
                    game.achievement,
                    game.titleHistory?.lastTimePlayed ?? null,
                ]),
            );
        }
        const relevantTitleIds = relevantTitles.map((game) => game.titleId);

        // A small portion of the items may not have stats, and some will not have the 'value' defined anyway.
        const playtimeStats = await this.xboxSyncService.getBatchMinutesPlayed(
            connection.sourceUserId,
            relevantTitleIds,
        );

        const platformsMap =
            await this.gameRepositoryService.getGamePlatformsMap(
                "abbreviation",
            );

        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.XBOX,
            externalGames.map((game) => game.gameId),
        );
        // Missing MinutesPlayed must not prevent known recent increments from expiring.
        const playtimes: CreateUserPlaytimeDto[] = [...existing.values()].map(
            (playtime) => ({ ...playtime, recentPlaytimeSeconds: undefined }),
        );
        const gamesByTitle = new Map(
            [...Map.groupBy(allGames, (game) => game.titleId)].map(
                ([id, games]) => [id, games[0]],
            ),
        );
        for (const stats of playtimeStats) {
            if (stats.value == undefined) continue;

            const relevantGame = gamesByTitle.get(stats.titleid)!;
            const relevantExternalGame = externalByProduct.get(
                relevantGame.productId,
            )!;

            const deviceTitles = relevantGame.devices.flat(1);

            const preferredPlatformAbbreviation =
                getPreferredXboxPlatformAbbreviation(deviceTitles);
            const preferredPlatform = platformsMap.get(
                preferredPlatformAbbreviation,
            )!;

            const existingPlaytimeInfo = existing.get(
                `${relevantExternalGame.gameId}:${preferredPlatform.id}`,
            );

            const playtime: CreateUserPlaytimeDto = {
                ...existingPlaytimeInfo,
                gameId: relevantExternalGame.gameId,
                profileUserId: userId,
                lastPlayedDate: relevantGame.titleHistory?.lastTimePlayed
                    ? new Date(relevantGame.titleHistory?.lastTimePlayed)
                    : null,
                recentPlaytimeSeconds: undefined,
                totalPlaytimeSeconds: Number.parseInt(stats.value) * 60,
                totalPlayCount: existingPlaytimeInfo?.totalPlayCount ?? 0,
                firstPlayedDate: undefined,
                source: UserPlaytimeSource.XBOX,
                platformId: preferredPlatform.id,
            };

            assertPlayerSyncActive();
            playtimes.push(playtime);
        }
        await this.playtimeService.saveImported(playtimes, existing);
    }

    async updateEpicPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.EPIC_GAMES,
            );

        const [libraryItems, playtimeEntries] = await Promise.all([
            this.epicSyncService.getLibraryItems(connection.sourceUserId),
            this.epicSyncService.getPlaytime(connection.sourceUserId),
        ]);

        const namespaces = [
            ...new Set(libraryItems.map((item) => item.namespace)),
        ];
        recordPlayerSyncStats({ gamesSeen: namespaces.length });
        if (namespaces.length === 0) {
            job.updateProgress({ totalUpdatedGames: 0 });
            return { outcome: "empty" as const };
        }

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                namespaces,
                EGameExternalGameCategory.EpicGamesNamespace,
            );
        const gameIdByNamespace = new Map(
            externalGames.map((game) => [game.uid, game.gameId]),
        );
        assertPlayerSyncActive();
        await registerUnmappedEpicNamespaces(
            this.externalGameService,
            this.epicSyncService,
            userId,
            connection.sourceUserId,
            libraryItems,
            namespaces.filter((namespace) => !gameIdByNamespace.has(namespace)),
        );

        // Playtime is reported per app; apps and add-ons of one namespace belong to the same game.
        const namespaceByApp = new Map(
            libraryItems.map((item) => [item.appName, item.namespace]),
        );
        const secondsByGame = new Map<number, number>();
        for (const entry of playtimeEntries) {
            const namespace = namespaceByApp.get(entry.artifactId);
            const gameId =
                namespace == undefined
                    ? undefined
                    : gameIdByNamespace.get(namespace);
            if (gameId == undefined) continue;
            secondsByGame.set(
                gameId,
                (secondsByGame.get(gameId) ?? 0) + entry.totalTime,
            );
        }

        const PC_PLATFORM_ID = 6;
        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.EPICGAMES,
            [...secondsByGame.keys()],
        );
        const playtimes: CreateUserPlaytimeDto[] = [];
        for (const [gameId, totalPlaytimeSeconds] of secondsByGame) {
            const existingPlaytimeInfo = existing.get(
                `${gameId}:${PC_PLATFORM_ID}`,
            );
            const playtime: CreateUserPlaytimeDto = {
                totalPlayCount: 0,
                ...existingPlaytimeInfo,
                gameId,
                profileUserId: userId,
                lastPlayedDate: existingPlaytimeInfo?.lastPlayedDate,
                totalPlaytimeSeconds,
                recentPlaytimeSeconds: undefined,
                firstPlayedDate: undefined,
                source: UserPlaytimeSource.EPICGAMES,
                platformId: PC_PLATFORM_ID,
            };
            // shortcut: Epic exposes no last played date, so it is only accurate to the sync interval; replace it if Epic exposes per-session data.
            if (
                existingPlaytimeInfo &&
                totalPlaytimeSeconds > existingPlaytimeInfo.totalPlaytimeSeconds
            ) {
                playtime.lastPlayedDate = new Date();
            }
            assertPlayerSyncActive();
            playtimes.push(playtime);
        }
        await this.playtimeService.saveImported(playtimes, existing);

        job.updateProgress({
            totalUpdatedGames: secondsByGame.size,
        } satisfies PlaytimeWatchJobProgress);
    }

    async updateGogPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;
        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.GOG,
            );
        const ids = await this.gogSyncService.getLibraryItems(
            connection.sourceUserId,
        );
        recordPlayerSyncStats({ gamesSeen: ids.length });
        const games =
            await this.externalGameService.getExternalGamesForSourceIds(
                ids,
                EGameExternalGameCategory.Gog,
            );
        const mapped = new Set(games.map((game) => game.uid));
        await this.gogSyncService.registerUnmappedGames(
            this.externalGameService,
            userId,
            connection.sourceUserId,
            ids.filter((id) => !mapped.has(id)),
        );
        const seconds = new Map<string, number>();
        for (const id of mapped) {
            assertPlayerSyncActive();
            seconds.set(
                id,
                await this.gogSyncService.getPlaytime(
                    connection.sourceUserId,
                    id,
                ),
            );
        }
        const byGame = Map.groupBy(games, (game) => game.gameId);
        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.GOG,
            [...byGame.keys()],
        );
        const playtimes: CreateUserPlaytimeDto[] = [];
        for (const [gameId, mappings] of byGame) {
            const previous = existing.get(`${gameId}:6`);
            playtimes.push({
                totalPlayCount: 0,
                firstPlayedDate: undefined,
                lastPlayedDate: undefined,
                ...previous,
                profileUserId: userId,
                gameId,
                platformId: 6,
                source: UserPlaytimeSource.GOG,
                totalPlaytimeSeconds: [
                    ...new Set(mappings.map((game) => game.uid)),
                ].reduce((total, id) => total + seconds.get(id)!, 0),
                recentPlaytimeSeconds: undefined,
            });
        }
        assertPlayerSyncActive();
        await this.playtimeService.saveImported(playtimes, existing);
        for (const game of games) {
            assertPlayerSyncActive();
            await this.gameAchievementSyncQueueService.addUserSyncJob(
                userId,
                game.id,
                EConnectionType.GOG,
                generateChecksum([game.uid, seconds.get(game.uid)]),
            );
        }
        await job.updateProgress({
            totalUpdatedGames: byGame.size,
        } satisfies PlaytimeWatchJobProgress);
        return { outcome: ids.length ? "complete" : "empty" };
    }

    async updateNintendoPlaytimeInfo(job: Job<PlaytimeWatchJob>) {
        const userId = job.data.userId;

        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                EConnectionType.NINTENDO,
            );

        const entries = await this.nintendoSyncService.getPlayHistory(
            connection.sourceUserId,
        );
        const titleIds = [...new Set(entries.map((entry) => entry.titleId))];
        recordPlayerSyncStats({ gamesSeen: titleIds.length });
        if (titleIds.length === 0) {
            job.updateProgress({ totalUpdatedGames: 0 });
            return { outcome: "empty" as const };
        }

        const externalGames =
            await this.externalGameService.getExternalGamesForSourceIds(
                titleIds,
                EGameExternalGameCategory.NintendoTitleId,
            );
        const gameIdByTitle = new Map(
            externalGames.map((game) => [game.uid, game.gameId]),
        );
        assertPlayerSyncActive();
        const unmapped = titleIds.filter((id) => !gameIdByTitle.has(id));
        if (unmapped.length > 0) {
            await this.externalGameService.registerUnmappedGames(
                EGameExternalGameCategory.NintendoTitleId,
                unmapped.map((sourceUid) => ({
                    sourceUid,
                    name: entries.find(
                        (entry) =>
                            entry.titleId === sourceUid && entry.titleName,
                    )?.titleName,
                })),
                userId,
            );
        }

        // Entries of one game and platform (e.g. several titles mapped to one game) are combined.
        const combined = new Map<
            string,
            {
                gameId: number;
                platformId: number;
                seconds: number;
                firstPlayedDate?: Date;
                lastPlayedDate?: Date;
            }
        >();
        for (const entry of entries) {
            const gameId = gameIdByTitle.get(entry.titleId);
            if (gameId == undefined) continue;
            const platformId = NINTENDO_PLATFORM_IDS[entry.platform];
            const key = `${gameId}:${platformId}`;
            const item = combined.get(key) ?? {
                gameId,
                platformId,
                seconds: 0,
            };
            item.seconds += entry.minutes * 60;
            if (
                entry.firstPlayedAt &&
                (!item.firstPlayedDate ||
                    entry.firstPlayedAt < item.firstPlayedDate)
            )
                item.firstPlayedDate = entry.firstPlayedAt;
            if (
                entry.lastPlayedAt &&
                (!item.lastPlayedDate ||
                    entry.lastPlayedAt > item.lastPlayedDate)
            )
                item.lastPlayedDate = entry.lastPlayedAt;
            combined.set(key, item);
        }

        const existing = await this.playtimeService.findForImport(
            userId,
            UserPlaytimeSource.NSWITCH,
            [...new Set([...combined.values()].map((item) => item.gameId))],
        );
        const playtimes: CreateUserPlaytimeDto[] = [];
        for (const [key, item] of combined) {
            const existingPlaytimeInfo = existing.get(key);
            assertPlayerSyncActive();
            playtimes.push({
                totalPlayCount: 0,
                ...existingPlaytimeInfo,
                gameId: item.gameId,
                profileUserId: userId,
                firstPlayedDate: item.firstPlayedDate,
                lastPlayedDate: item.lastPlayedDate,
                totalPlaytimeSeconds: item.seconds,
                recentPlaytimeSeconds: undefined,
                source: UserPlaytimeSource.NSWITCH,
                platformId: item.platformId,
            });
        }
        await this.playtimeService.saveImported(playtimes, existing);

        job.updateProgress({
            totalUpdatedGames: combined.size,
        } satisfies PlaytimeWatchJobProgress);
    }
}
