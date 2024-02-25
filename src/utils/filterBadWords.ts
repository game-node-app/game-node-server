import BadWordsFilter from "bad-words";

const filter = new BadWordsFilter();

export function filterBadWords(content: string): string {
    return filter.clean(content);
}
