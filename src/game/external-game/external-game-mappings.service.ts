import { Injectable } from "@nestjs/common";
import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { PsnExtraMappings } from "./entity/psn-extra-mappings.entity";

@Injectable()
export class ExternalGameMappingsService {
    constructor(
        @InjectRepository(PsnExtraMappings)
        private readonly psnExtraMappingsRepository: Repository<PsnExtraMappings>,
    ) {}

    public async upsertPsnMappings(
        mappings: Omit<
            PsnExtraMappings,
            "id" | "createdAt" | "deletedAt" | "updatedAt" | "externalGame"
        >,
    ) {
        await this.psnExtraMappingsRepository.upsert(
            {
                ...mappings,
                id: null as never,
            },
            ["externalGameId", "npServiceName", "npCommunicationId"],
        );
    }
}
