import { digest } from "jsum";

export function generateChecksum(data: unknown) {
    return digest(data, "SHA256", "hex");
}
