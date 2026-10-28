import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from "typeorm";
import { Library } from "../../libraries/entities/library.entity";

@Entity("importer_batch_effect")
@Index("IDX_importer_batch_effect_due", ["nextAttemptAt", "createdAt"])
export class ImporterBatchEffect {
    @PrimaryColumn("uuid")
    id: string;

    @Column({ type: "varchar", length: 36 })
    libraryUserId: string;

    @ManyToOne(() => Library, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "libraryUserId" })
    library: Library;

    @Column("json")
    entryIds: string[];

    @Column("json")
    collectionIds: string[];

    @Column({ type: "int", default: 0 })
    attempts: number;

    @Column({
        type: "datetime",
        precision: 6,
        default: () => "CURRENT_TIMESTAMP(6)",
    })
    nextAttemptAt: Date;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;
}
