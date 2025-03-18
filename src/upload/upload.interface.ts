export interface UploadModuleOptions {
    storage: "s3" | "filesystem";
}

export interface UploadService {
    /**
     * Persists a file and returns the key/filename to be used to retrieve it.
     */
    save(userId: string, file: Express.Multer.File): Promise<string>;
}
