import { IsIn, IsOptional, IsString } from "class-validator";

export class CheckoutRequestDto {
    @IsIn(["monthly", "yearly"])
    interval: "monthly" | "yearly";

    @IsOptional()
    @IsString()
    locale?: string;
}

export class PortalRequestDto {
    @IsOptional()
    @IsString()
    locale?: string;
}
