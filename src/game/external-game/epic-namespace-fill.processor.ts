import { Processor } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import axios from "axios";
import { Job } from "bullmq";
import { IsNull, MoreThan, Not, Repository } from "typeorm";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { ExternalGameService } from "./external-game.service";
import {
    EGameCategory,
    EGameExternalGameCategory,
} from "../game-repository/game-repository.constants";
import {
    EPIC_NAMESPACE_FILL_JOB,
    EpicNamespaceFillJobData,
    EpicNamespaceFillSummary,
    EXTERNAL_GAME_MAPPING_QUEUE,
} from "./external-game-mapping.constants";

const PAGE_SIZE = 500;
const REQUEST_PAUSE_MS = 200;
const REQUEST_TIMEOUT_MS = 15_000;
const CONTENT_API =
    "https://store-content-ipv4.ak.epicgames.com/api/en-US/content/products";
const SLUG_PATTERN = /\/p\/([^/?#]+)/;
// Add-ons and editions never own a namespace's mapping when a main game shares it.
const NON_MAIN_CATEGORIES: number[] = [
    EGameCategory.DlcAddon,
    EGameCategory.Expansion,
    EGameCategory.Bundle,
    EGameCategory.Pack,
    EGameCategory.Update,
];

@Processor(EXTERNAL_GAME_MAPPING_QUEUE, { concurrency: 1 })
export class EpicNamespaceFillProcessor extends WorkerHostProcessor {
    logger = new Logger(EpicNamespaceFillProcessor.name);

    constructor(
        @InjectRepository(GameExternalGame)
        private readonly gameExternalGameRepository: Repository<GameExternalGame>,
        private readonly externalGameService: ExternalGameService,
    ) {
        super();
    }

    protected sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** Returns the Epic namespace of a store page slug, or undefined if Epic has none or fails. */
    private async fetchNamespace(slug: string) {
        try {
            const { data } = await axios.get(
                `${CONTENT_API}/${encodeURIComponent(slug)}`,
                { timeout: REQUEST_TIMEOUT_MS },
            );
            return typeof data?.namespace === "string" && data.namespace
                ? (data.namespace as string)
                : undefined;
        } catch (error) {
            this.logger.warn(
                `Epic content lookup failed for slug ${slug}: ${(error as Error).message}`,
            );
            return undefined;
        }
    }

    async process(
        job: Job<EpicNamespaceFillJobData>,
    ): Promise<EpicNamespaceFillSummary> {
        if (job.name !== EPIC_NAMESPACE_FILL_JOB)
            throw new Error(`Unsupported job ${job.name}`);

        let lastId = job.data.lastId ?? 0;
        const groups = job.data.groups ?? {};
        let slugs = job.data.slugs ?? 0;
        let resolved = job.data.resolved ?? 0;
        let failed = 0;

        for (;;) {
            const rows = await this.gameExternalGameRepository.find({
                where: {
                    category: EGameExternalGameCategory.EpicGamesStore,
                    url: Not(IsNull()),
                    id: MoreThan(lastId),
                },
                relations: { game: true },
                select: {
                    id: true,
                    url: true,
                    gameId: true,
                    game: { id: true, category: true },
                },
                order: { id: "ASC" },
                take: PAGE_SIZE,
            });
            if (rows.length === 0) break;

            const rowsBySlug = Map.groupBy(
                rows.filter((row) => SLUG_PATTERN.test(row.url!)),
                (row) => row.url!.match(SLUG_PATTERN)![1],
            );
            for (const [slug, slugRows] of rowsBySlug) {
                slugs++;
                await this.sleep(REQUEST_PAUSE_MS);
                const namespace = await this.fetchNamespace(slug);
                if (!namespace) {
                    failed++;
                    continue;
                }
                resolved++;
                groups[namespace] ??= {};
                for (const row of slugRows)
                    groups[namespace][row.gameId] ??= {
                        category: row.game.category,
                        slug,
                    };
            }

            lastId = Number(rows.at(-1)!.id);
            await job.updateData({ lastId, groups, slugs, resolved });
        }

        return this.writeMappings(groups, { slugs, resolved, failed });
    }

    private async writeMappings(
        groups: NonNullable<EpicNamespaceFillJobData["groups"]>,
        counts: Pick<EpicNamespaceFillSummary, "slugs" | "resolved" | "failed">,
    ): Promise<EpicNamespaceFillSummary> {
        const summary = { ...counts, mapped: 0, ambiguous: 0 };
        const namespaces = Object.keys(groups);

        // Any existing mapping (igdb, bulk or curated) for a namespace is left as it is.
        const existing = new Set<string>();
        for (let offset = 0; offset < namespaces.length; offset += PAGE_SIZE) {
            const found =
                await this.externalGameService.getExternalGamesForSourceIds(
                    namespaces.slice(offset, offset + PAGE_SIZE),
                    EGameExternalGameCategory.EpicGamesNamespace,
                );
            for (const game of found) existing.add(game.uid);
        }

        for (const namespace of namespaces) {
            if (existing.has(namespace)) continue;
            const candidates = Object.entries(groups[namespace]);
            const mains = candidates.filter(
                ([, candidate]) =>
                    !NON_MAIN_CATEGORIES.includes(candidate.category),
            );
            const chosen =
                mains.length === 1
                    ? mains[0]
                    : candidates.length === 1
                      ? candidates[0]
                      : undefined;

            if (!chosen) {
                await this.externalGameService.registerUnmappedGames(
                    EGameExternalGameCategory.EpicGamesNamespace,
                    [{ sourceUid: namespace }],
                );
                summary.ambiguous++;
                continue;
            }
            await this.externalGameService.insertReserved({
                uid: namespace,
                category: EGameExternalGameCategory.EpicGamesNamespace,
                gameId: Number(chosen[0]),
                url: `https://store.epicgames.com/en-US/p/${chosen[1].slug}`,
                origin: "bulk",
            });
            summary.mapped++;
        }
        this.logger.log(
            `Epic namespace fill finished: ${JSON.stringify(summary)}`,
        );
        return summary;
    }
}
