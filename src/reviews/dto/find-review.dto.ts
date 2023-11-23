import { BaseFindDto } from "../../utils/base-find.dto";
import { Review } from "../entities/review.entity";
import { OmitType } from "@nestjs/swagger";

export class FindReviewDto extends OmitType(BaseFindDto<Review>, ["search"]) {}
