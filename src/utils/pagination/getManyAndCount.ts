import { ObjectLiteral, SelectQueryBuilder } from "typeorm";

/**
 * An optimized version of Typeorm's {@link SelectQueryBuilder#getManyAndCount}, without the weird hack it does
 * for pagination.
 * This function exists because TypeORM's method generates SQL code like this:
 * SELECT DISTINCT ...
 * FROM (
 *   SELECT ...
 *   FROM your_main_query
 * ) AS distinctAlias
 * Because it tries to be smart about pagination when you have JOINs. This works most of the time but breaks
 * for any non-trivial query. It also adds a extra layer of SQL you are not expecting and have no control off, which may decrease performance.
 * This function manually executes a fetch many and a count, increasing the DB calls to 2, but with a far more stable
 * result.
 * @see https://github.com/typeorm/typeorm/issues/4998
 */
export async function getManyAndCount<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    countField: string = "id", // the main table's primary key column name
): Promise<[T[], number]> {
    const countQuery = qb.clone();

    countQuery
        .skip(undefined)
        .take(undefined)
        .limit(undefined)
        .offset(undefined)
        .orderBy()
        .select(`COUNT(DISTINCT ${qb.alias}.${countField})`, "cnt");

    const [data, countRaw] = await Promise.all([
        qb.getMany(),
        countQuery.getRawOne(),
    ]);

    const total = Number(countRaw.cnt ?? 0);

    return [data, total];
}
