import dayjs from "dayjs";

export function getTargetRecapYear() {
    const now = dayjs();
    if (now.month() === 11) {
        return now.year();
    }

    return now.year() - 1;
}
