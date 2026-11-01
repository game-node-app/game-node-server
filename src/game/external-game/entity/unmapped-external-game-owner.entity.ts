import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { UnmappedExternalGame } from "./unmapped-external-game.entity";
import { Profile } from "../../../profile/entities/profile.entity";

/** A user whose sync or import saw an unmapped external game. */
@Entity()
export class UnmappedExternalGameOwner {
    @PrimaryColumn("int")
    unmappedExternalGameId: number;
    @PrimaryColumn({ type: "varchar", length: 36 })
    @Index()
    userId: string;

    @ManyToOne(() => UnmappedExternalGame, { onDelete: "CASCADE" })
    @JoinColumn({ name: "unmappedExternalGameId" })
    unmappedExternalGame: UnmappedExternalGame;
    @ManyToOne(() => Profile, { onDelete: "CASCADE" })
    @JoinColumn({ name: "userId" })
    profile: Profile;
}
