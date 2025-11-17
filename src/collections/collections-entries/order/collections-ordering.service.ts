import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CollectionEntryToCollection } from "../entities/collection-entry-to-collection.entity";
import { In, Repository } from "typeorm";
import { CollectionEntryUpdateOrderingDto } from "../dto/collection-entry-update-ordering.dto";
import {
    DEFAULT_ORDERING_GAP,
    DEFAULT_ORDERING_NORMALIZATION_THRESHOLD,
} from "../../../utils/ordering";

/**
 * Service responsible for handling collection to collection entry ordering.
 */
@Injectable()
export class CollectionsOrderingService {
    constructor(
        @InjectRepository(CollectionEntryToCollection)
        private readonly collectionEntryToCollectionRepository: Repository<CollectionEntryToCollection>,
    ) {}

    public async reOrderEntryInCollection(
        userId: string,
        dto: CollectionEntryUpdateOrderingDto,
    ) {
        const { collectionId, entryId, previousEntryId, nextEntryId } = dto;
        if (previousEntryId == undefined && nextEntryId == undefined) {
            throw new HttpException(
                "At least one of previousEntryId or nextEntryId must be defined.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const affectedEntries =
            await this.collectionEntryToCollectionRepository.find({
                where: {
                    collectionEntryId: In(
                        [entryId, previousEntryId, nextEntryId].filter(Boolean),
                    ),
                    collection: {
                        id: collectionId,
                        libraryUserId: userId,
                    },
                },
                relations: {
                    collection: true,
                },
            });

        const current = affectedEntries.find(
            (e) => e.collectionEntryId === entryId,
        );

        const before = affectedEntries.find(
            (e) => e.collectionEntryId === previousEntryId,
        );

        const after = affectedEntries.find(
            (e) => e.collectionEntryId === nextEntryId,
        );

        let newOrder: number = current!.order;
        if (before && after) {
            // Place between the two
            newOrder = (before.order + after.order) / 2;
        } else if (before) {
            // Move to the *end* (after "before")
            newOrder = before.order + DEFAULT_ORDERING_GAP;
        } else if (after) {
            // Move to the *beginning* (before "after")
            newOrder = after.order - DEFAULT_ORDERING_GAP;
        }

        await this.collectionEntryToCollectionRepository.update(
            {
                collectionId: collectionId,
                collectionEntryId: entryId,
            },
            {
                order: newOrder,
            },
        );

        if (
            Math.abs(newOrder) < DEFAULT_ORDERING_NORMALIZATION_THRESHOLD ||
            !Number.isFinite(newOrder)
        ) {
            await this.normalizeCollectionOrdering(collectionId);
        }
    }

    /**
     * Normalizes the ordering of the entries in a collection.
     * Avoids issue where values are considered equal in DB float rounding (very, very rare, <99.99%).
     * @param collectionId
     * @private
     */
    private async normalizeCollectionOrdering(collectionId: string) {
        const entries = await this.collectionEntryToCollectionRepository.find({
            where: {
                collectionId: collectionId,
            },
            order: {
                order: "ASC",
            },
        });

        for (let i = 0; i < entries.length; i++) {
            entries[i].order = (i + 1) * DEFAULT_ORDERING_GAP;
        }

        await this.collectionEntryToCollectionRepository.save(entries);
    }
}
