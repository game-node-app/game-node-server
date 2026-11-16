import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { YearRecapEdition } from "./entity/year-recap-edition.entity";
import {
    RecapCurrentDto,
    RecapPhase,
    RecapWindowDto,
} from "./dto/recap-window.dto";

const CACHE_MILLISECONDS = 60_000;

const cacheId = (year: number) => `recap_edition_${year}`;

const defaultOpening = (year: number) => new Date(Date.UTC(year, 10, 15));

const closeOfYear = (year: number) =>
    new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

/**
 * Recap opening windows per year. Without a stored row, a year opens on 15 November.
 */
@Injectable()
export class RecapWindowService {
    constructor(
        @InjectRepository(YearRecapEdition)
        private readonly editionRepository: Repository<YearRecapEdition>,
        private readonly dataSource: DataSource,
    ) {}

    public async getRecapWindow(year: number): Promise<RecapWindowDto> {
        const edition = await this.editionRepository.findOne({
            where: { year },
            cache: {
                id: cacheId(year),
                milliseconds: CACHE_MILLISECONDS,
            },
        });

        return {
            year,
            opensAt: edition?.opensAt ?? defaultOpening(year),
            closesAt: closeOfYear(year),
        };
    }

    public async getRecapPhase(
        year: number,
        now = new Date(),
    ): Promise<RecapPhase> {
        const { opensAt, closesAt } = await this.getRecapWindow(year);

        if (now < opensAt) return "upcoming";
        if (now <= closesAt) return "live";
        return "closed";
    }

    public async getCurrentRecap(now = new Date()): Promise<RecapCurrentDto> {
        const currentYear = now.getUTCFullYear();
        const liveWindow = await this.getRecapWindow(currentYear);

        if (now >= liveWindow.opensAt) {
            return { ...liveWindow, phase: "live" };
        }

        return {
            ...(await this.getRecapWindow(currentYear - 1)),
            phase: "closed",
        };
    }

    public async setRecapEdition(
        year: number,
        opensAt: Date,
    ): Promise<RecapWindowDto> {
        if (opensAt.getUTCFullYear() !== year) {
            throw new BadRequestException("opensAt must fall within the year");
        }

        await this.editionRepository.upsert({ year, opensAt }, ["year"]);
        await this.dataSource.queryResultCache?.remove([cacheId(year)]);

        return { year, opensAt, closesAt: closeOfYear(year) };
    }
}
