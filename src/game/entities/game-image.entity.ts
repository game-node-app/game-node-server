import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";

/**
 * Base entity for all game images (e.g. artworks, screenshots, covers).
 */
@Entity()
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
