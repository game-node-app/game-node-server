import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToMany,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Game } from "./game.entity";
import { GameCompany } from "./game-company.entity";
import { GameResource } from "./base/game-resource.entity";
import { PickType } from "@nestjs/swagger";

@Entity()
export class GameInvolvedCompany {
    @PrimaryColumn("bigint")
    id: number;
    @Column({ nullable: true })
    checksum?: string;

    @ManyToOne(() => GameCompany)
    company: GameCompany;
    @Column({
        nullable: false,
    })
    companyId: number;

    @Column({ type: "boolean" })
    developer: boolean;

    @Column({ type: "boolean" })
    porting: boolean;

    @Column({ type: "boolean" })
    publisher: boolean;

    @Column({ type: "boolean" })
    supporting: boolean;

    @ManyToMany(() => Game, (game) => game.involvedCompanies)
    games: Game[];

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
