import { ObjectLiteral, Repository } from "typeorm";
import { IGDBPartialGame } from "../game-repository.types";
import { Game } from "../entities/game.entity";
import { Logger } from "@nestjs/common";

export interface ObjectWithChecksum extends ObjectLiteral {
    id: number;
    checksum?: string;
}

export function hasChecksumChanged(
    incoming: ObjectLiteral[],
    existing: ObjectLiteral[] | undefined,
): boolean {
    if (existing === undefined || existing.length !== incoming.length) {
        return true;
    }

    const incomingMap = new Map(
        incoming.map((item) => [item.id, item.checksum]),
    );
    const existingMap = new Map(
        existing.map((item) => [item.id, item.checksum]),
    );

    for (const [id, checksum] of incomingMap) {
        if (existingMap.get(id) !== checksum) {
            return true;
        }
    }

    return false;
}
