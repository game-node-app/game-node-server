import { Column, Entity, PrimaryColumn } from "typeorm";

/**
 * Base entity for all game images (e.g. artworks, screenshots, covers).
 * PS: Do not use @Entity() here, as this should not have its own table.
 */
export class GameImage {
    @PrimaryColumn({
        type: "bigint",
    })
    id: number;
    @Column("boolean", {
        nullable: true,
    })
    alphaChannel?: boolean;
    @Column("boolean", {
        nullable: true,
    })
    animated?: boolean;
    @Column("int", {
        nullable: true,
    })
    height?: number;
    @Column("text", {
        nullable: true,
    })
    imageId?: string;
    @Column("text", {
        nullable: true,
    })
    url?: string;
    @Column("int", {
        nullable: true,
    })
    width?: number;
    @Column("text", {
        nullable: true,
    })
    checksum?: string;
}
