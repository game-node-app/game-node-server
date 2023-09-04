import { Activity } from "../../entities/activity.entity";
import { CollectionEntry } from "../../../collections/entities/collectionEntry.entity";
import { Review } from "../../../reviews/entities/review.entity";
import { Profile } from "../../../profile/entities/profile.entity";

export class ActivitiesFeedEntryDto extends Activity {
    source: CollectionEntry | Review | Profile;
}
