import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { Library } from "../../../libraries/entities/library.entity";
import { CollectionEntry } from "./collection-entry.entity";
import {
    CollectionEntryStatus,
    CollectionEntryStatusHistorySource,
} from "../collections-entries.constants";

/**
 * One status transition of a collection entry, dated by the server clock (design 11).
 * Append-only: application code never updates or deletes rows and no endpoint exposes them.
 * `collectionEntryId` becomes null when the entry is deleted, so the history survives it.
 */
@Entity()
@Index("IDX_ce_status_history_user_game", [
    "libraryUserId",
    "gameId",
    "toStatus",
    "occurredAt",
])
@Index("IDX_ce_status_history_user_status", [
    "libraryUserId",
    "toStatus",
    "occurredAt",
])
export class CollectionEntryStatusHistory {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @ManyToOne(() => Library, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "libraryUserId",
        foreignKeyConstraintName: "FK_ce_status_history_library",
    })
    library: Library;

    @Column({ type: "varchar", length: 36 })
    libraryUserId: string;

    /** Same type as `collection_entry.gameId`; no FK so catalog cleanup keeps the history. */
    @Column({ type: "bigint" })
    gameId: number;

    @ManyToOne(() => CollectionEntry, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "collectionEntryId",
        foreignKeyConstraintName: "FK_ce_status_history_entry",
    })
    collectionEntry: CollectionEntry | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    collectionEntryId: string | null;

    @Column({ type: "varchar", length: 32, nullable: true, default: null })
    fromStatus: CollectionEntryStatus | null;

    @Column({ type: "varchar", length: 32 })
    toStatus: CollectionEntryStatus;

    @Column({ type: "varchar", length: 16 })
    source: CollectionEntryStatusHistorySource;

    @Column({ type: "datetime", precision: 6 })
    occurredAt: Date;
}
