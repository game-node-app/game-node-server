import { StatisticsService } from './statistics.service';
import { CreateStatisticDto } from './dto/create-statistic.dto';
import { UpdateStatisticDto } from './dto/update-statistic.dto';
export declare class StatisticsController {
    private readonly statisticsService;
    constructor(statisticsService: StatisticsService);
    create(createStatisticDto: CreateStatisticDto): string;
    findAll(): string;
    findOne(id: string): string;
    update(id: string, updateStatisticDto: UpdateStatisticDto): string;
    remove(id: string): string;
}
