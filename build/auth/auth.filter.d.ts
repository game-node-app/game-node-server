import { ExceptionFilter, ArgumentsHost } from "@nestjs/common";
import { ErrorRequestHandler } from "express";
export declare class SupertokensExceptionFilter implements ExceptionFilter {
    handler: ErrorRequestHandler;
    constructor();
    catch(exception: Error, host: ArgumentsHost): void;
}
