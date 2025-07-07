import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpStatus,
    Logger,
} from "@nestjs/common";
import { AxiosError } from "axios";
import { Response } from "express";

@Catch(AxiosError)
export class AxiosExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(AxiosExceptionFilter.name);

    catch(exception: AxiosError, host: ArgumentsHost) {
        this.logger.error(exception);
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        const status =
            exception.response?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;

        response.status(status).json({
            statusCode: status,
            message: exception.message,
        });
    }
}
