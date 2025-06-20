import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpStatus,
} from "@nestjs/common";
import { Response } from "express";
import { TypeORMError } from "typeorm";

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
    catch(exception: Error, host: ArgumentsHost) {
        console.error(exception);
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: isMySQLException(exception)
                ? `${exception.sqlMessage} | ${exception.code}`
                : exception.message,
        });
    }
}
