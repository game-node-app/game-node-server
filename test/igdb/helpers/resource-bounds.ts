export class ResourceBounds {
    livePages = 0;
    activeGames = 0;
    activeRelations = 0;
    maxPages = 0;
    maxGames = 0;
    maxRelations = 0;
    pageOpened() {
        this.maxPages = Math.max(this.maxPages, ++this.livePages);
        if (this.livePages > 1)
            throw new Error("More than one live catalog page");
    }
    pageCommitted() {
        if (this.livePages !== 1)
            throw new Error("Invalid live-page accounting");
        this.livePages--;
    }
    gameStarted(maximum: number) {
        this.maxGames = Math.max(this.maxGames, ++this.activeGames);
        if (this.activeGames > maximum)
            throw new Error("Game admission bound exceeded");
    }
    relationStarted(maximum: number) {
        this.maxRelations = Math.max(this.maxRelations, ++this.activeRelations);
        if (this.activeRelations > maximum)
            throw new Error("Relationship admission bound exceeded");
    }
}
