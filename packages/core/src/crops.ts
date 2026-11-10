import cropData from "../../../data/crops.json";

export interface CropDefinition {
  id: string;
  name: string;
  apiId: string | null;
  unlockLevel: number;
  contestCrop: boolean;
}

export const ALL_CROPS: CropDefinition[] = (cropData as CropDefinition[]).map(
  (crop) => ({
    id: crop.id,
    name: crop.name,
    apiId: crop.apiId,
    unlockLevel: crop.unlockLevel,
    contestCrop: crop.contestCrop,
  }),
);

export function getCrop(id: string): CropDefinition | undefined {
  return ALL_CROPS.find((crop) => crop.id === id);
}
