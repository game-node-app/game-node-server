import { publicImagesDir } from "./constants";

export function getPersistedImagePath(filename: string, extension: string) {
    return `${publicImagesDir}/uploads/${filename}.${extension}`;
}
