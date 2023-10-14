import {
    Column,
    CreateDateColumn,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";

/**
 * Base entity for a lot of game resources (e.g. franchises, modes, etc).
 * PS: Do not use @Entity() here, as this should not have its own table.
 */
export class GameResource {
    @PrimaryColumn("bigint")
    id: number;
    @Column({ nullable: true })
    checksum: string;
    @Column({
        nullable: true,
    })
    name?: string;
    @Column({ nullable: true })
    slug?: string;
    @Column({ nullable: true })
    url?: string;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
