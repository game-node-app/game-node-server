import { ConfigurableModuleBuilder } from "@nestjs/common";
import { UploadModuleOptions } from "./upload.interface";

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<UploadModuleOptions>().setExtras({}).build();
