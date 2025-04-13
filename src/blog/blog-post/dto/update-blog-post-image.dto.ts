import { ApiProperty } from "@nestjs/swagger";

export class UpdateBlogPostImageDto {
    // For OpenAPI reference
    // Do not mention directly
    @ApiProperty({
        format: "binary",
    })
    image?: Blob;
}
