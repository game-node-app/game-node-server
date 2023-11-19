import { Statistics } from "./entity/statistics.entity";
import { StatisticsSourceType } from "./statistics.constants";

export function resolveSourceIdsTypes(statistics: Statistics[]) {
    return statistics.map((statistics) => {
        if (statistics.sourceType === StatisticsSourceType.GAME) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            statistics.sourceId = Number.parseInt(statistics.sourceId, 10);
        }
        return statistics;
    });
}
