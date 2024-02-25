import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Game } from "./game.entity";
import { GameCompany } from "./game-company.entity";

@Entity()
export class GameInvolvedCompany {
    @PrimaryColumn({
        type: "bigint",
    })
    id: number;
    @Column({
        nullable: true,
    })
    checksum?: string;

    @ManyToOne(() => GameCompany)
    company: GameCompany;
    @Column({
        nullable: false,
    })
    companyId: number;

    @CreateDateColumn({ type: "datetime" })
    createdAt: Date;

    @Column({ type: "boolean" })
    developer: boolean;

    @Column({ type: "boolean" })
    porting: boolean;

    @Column({ type: "boolean" })
    publisher: boolean;

    @Column({ type: "boolean" })
    supporting: boolean;

    @UpdateDateColumn({ type: "datetime" })
    updatedAt: Date;

    @ManyToMany(() => Game, (game) => game.involvedCompanies)
    games: Game[];
}
