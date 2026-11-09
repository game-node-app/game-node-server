import "reflect-metadata";
import {
    EntitySchema,
    EntitySchemaColumnOptions,
    EntitySchemaRelationOptions,
    getMetadataArgsStorage,
} from "typeorm";
import { Game } from "../../../src/game/game-repository/entities/game.entity";
import { GameCompany } from "../../../src/game/game-repository/entities/game-company.entity";
import { GameCompanyLogo } from "../../../src/game/game-repository/entities/game-company-logo.entity";
import { GameEngineLogo } from "../../../src/game/game-repository/entities/game-engine-logo.entity";
import { GamePropertyPathToEntityMap } from "../../../src/game/game-repository/create/game-repository-create.constants";
import { StatisticsTarget } from "../../../src/statistics/entity/statistics-target.entity";
import { MetricTotal } from "../../../src/statistics/entity/metric-total.entity";
import { GameCoverOption } from "../../../src/game/game-cover/entities/game-cover-option.entity";
import { UserGameCover } from "../../../src/game/game-cover/entities/user-game-cover.entity";
import { Profile } from "../../../src/profile/entities/profile.entity";

type EntityConstructor = new (...args: any[]) => any;

/** Production columns/relations, excluding unrelated inverse links into users,
 * collections and platform integrations. Same class targets and SQL operations. */
export function importEntities(): EntitySchema[] {
    const targets = new Set<EntityConstructor>([
        Game,
        StatisticsTarget,
        MetricTotal,
        GameCompany,
        GameCompanyLogo,
        GameEngineLogo,
        GameCoverOption,
        UserGameCover,
        Profile,
        ...(Object.values(GamePropertyPathToEntityMap) as EntityConstructor[]),
    ]);
    const storage = getMetadataArgsStorage();
    return [...targets].map((target) => {
        const ancestors: EntityConstructor[] = [];
        for (
            let current: any = target;
            current && current !== Function.prototype;
            current = Object.getPrototypeOf(current)
        )
            ancestors.push(current);
        const columns: Record<string, EntitySchemaColumnOptions> = {};
        for (const column of storage.columns.filter((item) =>
            ancestors.includes(item.target as EntityConstructor),
        )) {
            const generation = storage.generations.find(
                (item) =>
                    item.target === column.target &&
                    item.propertyName === column.propertyName,
            );
            columns[column.propertyName] = {
                ...column.options,
                type:
                    column.options.type ??
                    Reflect.getMetadata(
                        "design:type",
                        (column.target as EntityConstructor).prototype,
                        column.propertyName,
                    ),
                createDate: column.mode === "createDate",
                updateDate: column.mode === "updateDate",
                ...(generation ? { generated: generation.strategy } : {}),
            } as EntitySchemaColumnOptions;
        }
        const relations: Record<string, EntitySchemaRelationOptions> = {};
        for (const relation of storage.relations.filter((item) =>
            ancestors.includes(item.target as EntityConstructor),
        )) {
            const referenced =
                typeof relation.type === "function"
                    ? (relation.type as () => EntityConstructor)()
                    : null;
            if (!referenced || !targets.has(referenced)) continue;
            const joinColumn = storage.joinColumns.find(
                (item) =>
                    item.target === relation.target &&
                    item.propertyName === relation.propertyName,
            );
            const joinTable = storage.joinTables.find(
                (item) =>
                    item.target === relation.target &&
                    item.propertyName === relation.propertyName,
            );
            relations[relation.propertyName] = {
                ...relation.options,
                type: relation.relationType,
                target: () => referenced,
                inverseSide:
                    typeof relation.inverseSideProperty === "function"
                        ? relation.inverseSideProperty(
                              new Proxy(
                                  {},
                                  { get: (_object, key) => String(key) },
                              ),
                          )
                        : relation.inverseSideProperty,
                ...(joinColumn
                    ? {
                          joinColumn: {
                              name: joinColumn.name,
                              referencedColumnName:
                                  joinColumn.referencedColumnName,
                          },
                      }
                    : {}),
                ...(joinTable ? { joinTable: true } : {}),
            };
        }
        const columnUnique = new Set(
            storage.columns
                .filter(
                    (item) =>
                        ancestors.includes(item.target as EntityConstructor) &&
                        item.options.unique,
                )
                .map((item) => item.propertyName),
        );
        const uniques = storage.uniques
            .filter((item) =>
                ancestors.includes(item.target as EntityConstructor),
            )
            .flatMap((item) =>
                Array.isArray(item.columns)
                    ? [{ name: item.name, columns: item.columns }]
                    : [],
            )
            // Column-level `unique: true` is already part of the column options.
            .filter(
                (item) =>
                    !(
                        item.columns.length === 1 &&
                        columnUnique.has(item.columns[0])
                    ),
            );
        return new EntitySchema({
            name: target.name,
            target: target as any,
            columns,
            relations,
            uniques,
        });
    });
}
