import { digest } from "jsum";

export function generateChecksum(data: any) {
    return digest(data, "SHA256", "hex");
}
