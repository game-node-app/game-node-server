import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import crypto from "crypto";
import mimetype from "mime-types";
import { ImageCompressorService } from "./image-compressor/image-compressor.service";

@Injectable()
export class UploadService {
    private logger = new Logger(UploadService.name);
    private client: S3Client;
    private readonly BUCKET_NAME = "gamenode-user-uploads";

    constructor(
        configService: ConfigService,
        private readonly imageCompressorService: ImageCompressorService,
    ) {
        this.client = new S3Client({
            region: "auto",
            endpoint: configService.getOrThrow<string>("S3_ENDPOINT"),
            credentials: {
                accessKeyId:
                    configService.getOrThrow<string>("S3_ACCESS_KEY_ID"),
                secretAccessKey: configService.getOrThrow<string>(
                    "S3_SECRET_ACCESS_KEY",
                ),
            },
            requestChecksumCalculation: "WHEN_REQUIRED",
            responseChecksumValidation: "WHEN_REQUIRED",
            forcePathStyle: true,
        });
    }

    async save(userId: string, file: Express.Multer.File) {
        const fileName = crypto.randomBytes(16).toString("hex");
        const fileExt = mimetype.extension(file.mimetype) || "jpeg";
        const fileNameWithExtension = `${fileName}.${fileExt}`;

        const compressedBuffer = await this.imageCompressorService.compress(
            file.buffer,
        );

        const command = new PutObjectCommand({
            Bucket: this.BUCKET_NAME,
            Body: compressedBuffer,
            Key: fileNameWithExtension,
            ContentType: file.mimetype,
            Metadata: {
                userId: userId,
            },
        });

        await this.client.send(command);

        return {
            fileNameWithExtension: fileNameWithExtension,
            fileName,
            fileExt,
        } as const;
    }
}
