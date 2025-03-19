import { Global, Module } from "@nestjs/common";
import { UploadService } from "./upload.service";
import { ImageCompressorService } from "./image-compressor/image-compressor.service";

@Global()
@Module({
    providers: [UploadService, ImageCompressorService],
    exports: [UploadService],
})
export class UploadModule {}
