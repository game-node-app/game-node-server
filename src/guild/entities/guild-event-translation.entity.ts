import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { GuildLocale } from "../guild.constants";
import { GuildEvent } from "./guild-event.entity";

/** One locale's title and description for a curated Guild event (design 1). */
@Entity()
@Unique("UQ_guild_event_translation_event_locale", ["eventId", "locale"])
export class GuildEventTranslation {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @ManyToOne(() => GuildEvent, (event) => event.translations, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn({
        name: "eventId",
        foreignKeyConstraintName: "FK_guild_event_translation_event",
    })
    event: GuildEvent;

    @Column({ type: "varchar", length: 36 })
    eventId: string;

    @Column({ type: "varchar", length: 10 })
    locale: GuildLocale;

    @Column({ type: "varchar", length: 120 })
    title: string;

    @Column({ type: "varchar", length: 500 })
    description: string;
}
