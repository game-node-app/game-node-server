import { Injectable } from "@nestjs/common";
import sharp from "sharp";

@Injectable()
export class ImageCompressorService {
    async compress(buffer: Buffer): Promise<Buffer> {
        const image = sharp(buffer);
        const metadata = await image.metadata();

        switch (metadata.format) {
            case "jpeg":
                return await image
                    .jpeg({
                        mozjpeg: true,
                        quality: 80,
                    })
                    .toBuffer();
            case "png":
                return await image
                    .png({
                        compressionLevel: 5,
                    })
                    .toBuffer();

            default:
                return buffer;
        }
    }
}
