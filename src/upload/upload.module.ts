import { Global, Module, Provider } from "@nestjs/common";
import { S3UploadService } from "./impl/s3-upload/s3-upload.service";
import {
    ConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN,
} from "./upload.module-definition";
import { UploadModuleOptions } from "./upload.interface";
import { UPLOAD_SERVICE } from "./upload.constants";
import { ImageCompressorService } from "./image-compressor/image-compressor.service";
import { UploadController } from './upload.controller';

const UploadServiceProvider: Provider = {
    provide: UPLOAD_SERVICE,
    useFactory: (
        options: UploadModuleOptions,
        s3UploadService: S3UploadService,
    ) => {
        if (options.storage === "s3") {
            return s3UploadService;
        }
    },
    inject: [MODULE_OPTIONS_TOKEN, S3UploadService],
};

@Global()
@Module({
    providers: [UploadServiceProvider, S3UploadService, ImageCompressorService],
    exports: [UPLOAD_SERVICE],
    controllers: [UploadController],
})
export class UploadModule extends ConfigurableModuleClass {}
