import BadWordsFilter from "bad-words";

const filter = new BadWordsFilter();

export const BAD_WORDS_TAG_NAME = "bad-word";

export function tagBadWords(content: string): string {
    const words = content.split(" ");
    const taggedWords = words.map((word) => {
        if (filter.isProfane(word)) {
            return `<${BAD_WORDS_TAG_NAME}>${word}</${BAD_WORDS_TAG_NAME}>`;
        }

        return word;
    });

    return taggedWords.join(" ");
}
