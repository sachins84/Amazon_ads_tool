import { amazonRequest } from "./client";

export interface AmazonProfile {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  accountInfo: {
    marketplaceStringId: string;
    id: string;
    type: string;
    name: string;
  };
}

export async function listProfiles(): Promise<AmazonProfile[]> {
  return amazonRequest<AmazonProfile[]>("/v2/profiles");
}
