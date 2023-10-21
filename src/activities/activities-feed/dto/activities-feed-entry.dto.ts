import { Activity } from "../../activities-repository/entities/activity.entity";
import { CollectionEntry } from "../../../collections/collections-entries/entities/collection-entry.entity";
import { Review } from "../../../reviews/entities/review.entity";
import { Profile } from "../../../profile/entities/profile.entity";

export class ActivitiesFeedEntryDto extends Activity {
    source: CollectionEntry | Review | Profile;
}
