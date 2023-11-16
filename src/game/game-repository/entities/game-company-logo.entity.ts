import { GameImage } from "./base/game-image.entity";
import { Entity, OneToMany } from "typeorm";
import { GameCompany } from "./game-company.entity";

@Entity()
export class GameCompanyLogo extends GameImage {
    @OneToMany(() => GameCompany, (company) => company.logo)
    company: GameCompany;
}
