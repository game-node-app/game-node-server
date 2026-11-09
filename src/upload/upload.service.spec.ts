import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageCompressorService } from "./image-compressor/image-compressor.service";
import { UploadService } from "./upload.service";

describe("UploadService", () => {
    const compressed = Buffer.from("compressed");
    const imageCompressor = {
        compress: jest.fn(async () => compressed),
    };
    const send = jest.fn(async (command: unknown) => command);
    let service: UploadService;
    let directory: string;

    beforeEach(async () => {
        jest.clearAllMocks();
        service = new UploadService(
            new ConfigService({
                S3_ENDPOINT: "http://localhost:9000",
                S3_ACCESS_KEY_ID: "key",
                S3_SECRET_ACCESS_KEY: "secret",
            }),
            imageCompressor as unknown as ImageCompressorService,
        );
        (service as unknown as { client: { send: typeof send } }).client = {
            send,
        };
        directory = await mkdtemp(join(tmpdir(), "upload-service-"));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it("keeps save behavior unchanged", async () => {
        const result = await service.save("user-1", {
            buffer: Buffer.from("original"),
            mimetype: "image/png",
        } as Express.Multer.File);

        expect(imageCompressor.compress).toHaveBeenCalledWith(
            Buffer.from("original"),
        );
        const command = send.mock.calls[0][0] as PutObjectCommand;
        expect(command).toBeInstanceOf(PutObjectCommand);
        expect(command.input).toEqual({
            Bucket: "gamenode-user-uploads",
            Body: compressed,
            Key: `${result.fileName}.png`,
            ContentType: "image/png",
            Metadata: { userId: "user-1" },
        });
        expect(command.input.CacheControl).toBeUndefined();
        expect(result).toEqual({
            fileName: expect.any(String),
            fileExt: "png",
            fileNameWithExtension: `${result.fileName}.png`,
        });
    });

    it("streams a stored file with immutable caching and the given content type", async () => {
        const path = join(directory, "poster");
        await writeFile(path, "jpeg-bytes");

        const result = await service.saveStoredFile(
            "user-1",
            path,
            "image/jpeg",
        );

        const command = send.mock.calls[0][0] as PutObjectCommand;
        expect(command).toBeInstanceOf(PutObjectCommand);
        expect(command.input).toMatchObject({
            Bucket: "gamenode-user-uploads",
            Key: `${result.fileName}.jpeg`,
            ContentType: "image/jpeg",
            CacheControl: "public, max-age=31536000, immutable",
            ContentLength: 10,
            Metadata: { userId: "user-1" },
        });
        expect(result).toEqual({
            fileName: expect.any(String),
            fileExt: "jpeg",
            fileNameWithExtension: `${result.fileName}.jpeg`,
        });

        const chunks: Buffer[] = [];
        for await (const chunk of command.input.Body as AsyncIterable<Buffer>) {
            chunks.push(chunk);
        }
        expect(Buffer.concat(chunks).toString()).toBe("jpeg-bytes");
    });

    it("deletes one stored object", async () => {
        await service.delete("ab12.mp4");

        const command = send.mock.calls[0][0] as DeleteObjectCommand;
        expect(command).toBeInstanceOf(DeleteObjectCommand);
        expect(command.input).toEqual({
            Bucket: "gamenode-user-uploads",
            Key: "ab12.mp4",
        });
    });
});
