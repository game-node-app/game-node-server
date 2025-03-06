export class UploadPostImageRequestDto {
    file: Blob;
}

export class UploadPostImageResponseDto {
    /**
     * Persisted filename with extension
     */
    filename: string;
    /**
     * The persisted {@link PostImage} id
     */
    id: number;
}
