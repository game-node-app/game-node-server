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
        const existingMapping = await this.psnExtraMappingsRepository.findOneBy(
            {
                externalGameId: mappings.externalGameId,
                npServiceName: mappings.npServiceName,
                npCommunicationId: mappings.npCommunicationId,
            },
        );

        if (!existingMapping) {
            await this.psnExtraMappingsRepository.insert(mappings);
        }
    }
}
