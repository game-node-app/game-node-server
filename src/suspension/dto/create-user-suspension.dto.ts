export class CreateUserSuspensionDto {
    issuerUserId: string;
    targetUserId: string;
    type: "suspension" | "ban";
}
