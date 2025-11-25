import { Column, Entity, ManyToMany, ManyToOne } from "typeorm";
import { Game } from "./game.entity";
import { GameCompany } from "./game-company.entity";
import { GameResource } from "./base/game-resource.entity";

@Entity()
export class GameInvolvedCompany extends GameResource {
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
}
