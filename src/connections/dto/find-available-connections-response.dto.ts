import { EConnectionType } from "../connections.constants";

export class FindAvailableConnectionsResponseDto {
    name: string;
    type: EConnectionType;
    isImporterViable: boolean;
    iconName: string;
}
