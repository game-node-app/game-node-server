export function getPreviousDate(minusDays: number) {
    const previousDate = new Date(); // today
    // If this is a negative number, months are automatically subtracted
    previousDate.setDate(previousDate.getDate() - minusDays);
    return previousDate;
}
