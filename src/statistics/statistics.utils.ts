import dayjs from "dayjs";

export function getPreviousDate(minusDays: number) {
    const now = dayjs();

    return now.subtract(minusDays, "d").toDate();
}
