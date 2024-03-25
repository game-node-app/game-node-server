import { Injectable } from "@nestjs/common";
import UserAgent from "user-agents";
import axios from "axios";
import { HLTBResponseItem } from "./hltb.types";
import { SearchDto } from "./dto/search.dto";
@Injectable()
export class HltbSearchService {
    private readonly BASE_URL = "https://howlongtobeat.com";
    private readonly SEARCH_URL = `${this.BASE_URL}/api/search`;

    constructor() {}

    private getSearchPayload(
        query: string,
        offset: number = 0,
        limit: number = 20,
    ) {
        const offsetAsPage = offset > 0 ? Math.ceil(offset / limit) : 1;
        const searchQuery = query.split(" ");

        const defaultPayload = {
            searchType: "games",
            searchTerms: [],
            searchPage: 1,
            size: 20,
            searchOptions: {
                games: {
                    userId: 0,
                    platform: "",
                    sortCategory: "popular",
                    rangeCategory: "main",
                    rangeTime: {
                        min: 0,
                        max: 0,
                    },
                    gameplay: {
                        perspective: "",
                        flow: "",
                        genre: "",
                    },
                    modifier: "",
                },
                users: {
                    sortCategory: "postcount",
                },
                filter: "",
                sort: 0,
                randomizer: 0,
            },
        };
        return {
            ...defaultPayload,
            searchTerms: searchQuery,
            searchPage: offsetAsPage,
            size: limit,
        };
    }

    private getSearchHeaders() {
        return {
            "User-Agent": new UserAgent().toString(),
            "content-type": "application/json",
            origin: "https://howlongtobeat.com/",
            referer: "https://howlongtobeat.com/",
        };
    }

    public async search(dto: SearchDto) {
        const payload = this.getSearchPayload(dto.query, 0, dto.limit);
        const headers = this.getSearchHeaders();
        const req = await axios.post<{ data: HLTBResponseItem[] }>(
            this.SEARCH_URL,
            payload,
            {
                headers,
            },
        );
        const responseData = req.data;
        if (responseData.data.length === 0) {
            throw new Error("No results for query.");
        }
        return responseData.data;
    }

    public async getFirst(query: string) {
        const data = await this.search({
            query,
            limit: 1,
        });
        return data[0];
    }
}
