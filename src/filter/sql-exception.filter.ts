import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpStatus,
    Logger,
} from "@nestjs/common";
import { Response } from "express";
import { TypeORMError } from "typeorm";

const ExceptionNameToHttpCode = {
    QueryFailedError: HttpStatus.BAD_REQUEST,
    UniqueConstraintViolationError: HttpStatus.CONFLICT,
    NotFoundError: HttpStatus.NOT_FOUND,
    ForbiddenError: HttpStatus.FORBIDDEN,
    BadRequestError: HttpStatus.BAD_REQUEST,
    EntityNotFound: HttpStatus.NOT_FOUND,
} as const

interface MySQLError extends Error {
    code: string;
    errno: number;
    sqlState: string;
    sqlMessage: string;
}

const isMySQLException = (err: Error): err is MySQLError => {
    return "sqlMessage" in err;
};

@Catch(TypeORMError)
export class SQLExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(SQLExceptionFilter.name);
    catch(exception: Error, host: ArgumentsHost) {
        this.logger.error(exception);
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        // ER_QUERY_TIMEOUT: the API's max_execution_time cut the query, so it's load, not the client.
        const status: HttpStatus =
            (exception as Partial<MySQLError>).errno === 3024
                ? HttpStatus.SERVICE_UNAVAILABLE
                : (ExceptionNameToHttpCode[exception.name as never] ??
                  HttpStatus.INTERNAL_SERVER_ERROR);

        response.status(status).json({
            statusCode: status,
            message: isMySQLException(exception)
                ? `${exception.sqlMessage} | ${exception.code}`
                : exception.message,
        });
    }
}
