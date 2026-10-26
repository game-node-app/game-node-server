export type StatisticsInstant = {
    date: Date;
    epochMicros: bigint;
    mysql: string;
    iso: string;
};

const microsPerMillisecond = 1_000n;
const microsPerSecond = 1_000_000n;
const microsPerHour = 3_600_000_000n;
const microsPerDay = 86_400_000_000n;

export function floorStatisticsMicros(value: bigint, unit: bigint): bigint {
    const remainder = value % unit;
    return remainder < 0n ? value - remainder - unit : value - remainder;
}

export function statisticsInstantAtMicros(epochMicros: bigint): StatisticsInstant {
    const milliseconds = floorStatisticsMicros(epochMicros, microsPerMillisecond) / microsPerMillisecond;
    const date = new Date(Number(milliseconds));
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999)
        throw new Error("Invalid UTC statistics instant");
    const utcSecond = date.toISOString().slice(0, 19);
    const fraction = (epochMicros - floorStatisticsMicros(epochMicros, microsPerSecond)).toString().padStart(6, "0");
    return {
        date,
        epochMicros,
        mysql: `${utcSecond.replace("T", " ")}.${fraction}`,
        iso: `${utcSecond}.${fraction}Z`,
    };
}

export function parseStatisticsInstant(value: string): StatisticsInstant {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw new Error("Invalid UTC statistics instant");
    const localSecond = new Date(`${match[1]}Z`);
    const wholeSecond = new Date(`${match[1]}${match[3]}`);
    if (
        !Number.isFinite(localSecond.getTime()) ||
        localSecond.toISOString().slice(0, 19) !== match[1] ||
        !Number.isFinite(wholeSecond.getTime())
    ) throw new Error("Invalid UTC statistics instant");
    const fraction = (match[2] ?? "").padEnd(6, "0");
    const epochMicros = BigInt(wholeSecond.getTime() / 1000) * 1_000_000n + BigInt(fraction);
    return statisticsInstantAtMicros(epochMicros);
}

export function statisticsInstantFromDate(value: Date): StatisticsInstant {
    return parseStatisticsInstant(value.toISOString());
}

export function parseMySqlStatisticsInstant(value: string | Date): StatisticsInstant {
    if (value instanceof Date) return statisticsInstantFromDate(value);
    return parseStatisticsInstant(`${value.replace(" ", "T")}Z`);
}

export const statisticsMicrosPerHour = microsPerHour;
export const statisticsMicrosPerDay = microsPerDay;
