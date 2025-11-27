import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity()
export class GameCollection{
    @PrimaryColumn("bigint")
    id: number;
    @Column()
    name: string;
    @Column()
    slug: string;
    @Column()
    createdAt: Date;
    @Column()
    updatedAt: Date;
    @Column()
    checksum: string;
    @Column()
    url: string;

    // @OneToMany(() => Game, (game) => game.collection, {
    //     cascade: false,
    // })
    // games: Game[];
}
