import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { GuildLocale } from "../guild.constants";
import { GuildCommunityBounty } from "./guild-community-bounty.entity";

/** One locale's title and description for a Community Bounty (design 1). */
@Entity()
@Unique("UQ_guild_bounty_translation_bounty_locale", ["bountyId", "locale"])
export class GuildCommunityBountyTranslation {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @ManyToOne(() => GuildCommunityBounty, (bounty) => bounty.translations, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn({
        name: "bountyId",
        foreignKeyConstraintName: "FK_guild_bounty_translation_bounty",
    })
    bounty: GuildCommunityBounty;

    @Column({ type: "varchar", length: 36 })
    bountyId: string;

    @Column({ type: "varchar", length: 10 })
    locale: GuildLocale;

    @Column({ type: "varchar", length: 120 })
    title: string;

    @Column({ type: "varchar", length: 500 })
    description: string;
}
