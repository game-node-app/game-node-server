import { CreateStatisticDto } from './dto/create-statistic.dto';
import { UpdateStatisticDto } from './dto/update-statistic.dto';
export declare class StatisticsService {
    create(createStatisticDto: CreateStatisticDto): string;
    findAll(): string;
    findOne(id: number): string;
    update(id: number, updateStatisticDto: UpdateStatisticDto): string;
    remove(id: number): string;
}
