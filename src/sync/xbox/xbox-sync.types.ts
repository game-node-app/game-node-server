export interface XboxLiveAuthorization {
    userHash: string;
    XSTSToken: string;
}

export type ProfileResponse = {
    profileUsers: [
        {
            id: string;
            hostId: string;
            settings: Array<{
                id:
                    | "GameDisplayPicRaw"
                    | "Gamerscore"
                    | "Gamertag"
                    | "AccountTier"
                    | "XboxOneRep"
                    | "PreferredColor"
                    | "RealName"
                    | "Bio"
                    | "Location"
                    | "ModernGamertag"
                    | "ModernGamertagSuffix"
                    | "UniqueModernGamertag"
                    | "RealNameOverride"
                    | "TenureLevel"
                    | "Watermarks"
                    | "IsQuarantined"
                    | "DisplayedLinkedAccounts";
                value: string;
            }>;
            isSponsoredUser: false;
        },
    ];
};

export type XboxGameTitleDeviceType =
    | "Xbox360"
    | "XboxOne"
    | "XboxSeries"
    | "PC"
    | "Win32";

export interface XboxGameTitle {
    titleId: string;
    productId: string;
    productIds: string[];
    productIdsWithDeviceTypes: {
        productId: string;
        devices: XboxGameTitleDeviceType[];
    }[];
    pfn: string;
    bingId: string;
    windowsPhoneProductId: string | null;
    name: string;
    type: string;
    devices: XboxGameTitleDeviceType[];
    displayImage: string;
    mediaItemType: string;
    modernTitleId: string;
    isBundle: boolean;
    achievement: any | null;
    stats: any | null;
    gamePass: any | null;
    images: any | null;
    titleHistory: {
        lastTimePlayed: string;
        visible: boolean;
        canHide: boolean;
    };
    titleRecord: any | null;
    detail: any | null;
    friendsWhoPlayed: any | null;
    alternateTitleIds: any | null;
    contentBoards: any | null;
    xboxLiveTier: string;
}

export interface XboxMinutesPlayedStatsItem {
    groupproperties: Record<string, unknown>;
    // User's XUID
    xuid: string;
    scid: string;
    titleid: string;
    name: string;
    // Usually "Integer", doesn't mean the 'value' is defined.
    type: string;
    value?: string;
    properties: Record<string, unknown>;
}

export interface XboxBatchMinutesPlayedResponse {
    groups: unknown[];
    // If only MinutesPlayed are being requested, this is a single item list.
    statlistscollection: {
        arrangebyfield: string;
        arrangebyfieldid: string;
        stats: XboxMinutesPlayedStatsItem[];
    }[];
}

export interface XboxMSStoreCatalogResponse {
    Products: {
        ProductId: string;
        ProductKind: string;
        AverageRating: number;
        TotalRatingsCount: number;
        Properties: {
            PackageFamilyName: string;
            XPAEnabled: boolean;
            XboxLiveEnabled: boolean;
        };
        MarketProperties: {
            RelatedProducts: {
                RelatedProductId: string;
                RelationshipType: string;
            }[];
        }[];
        LocalizedProperties: {
            DeveloperName: string;
            PublisherName: string;
            PublisherAddress: string | null;
            PublisherWebsiteUri: string;
            SupportUri: string;
            SupportPhone: string | null;
            EligibilityProperties: {
                Remediations: any[];
                Affirmations: any[];
            };
            Images: {
                BackgroundColor: string;
                Caption: string;
                ForegroundColor: string;
                Height: number;
                ImagePurpose: string;
                Uri: string;
                Width: number;
            }[];
            Videos: any[];
            ProductDescription: string;
            ProductTitle: string;
            SearchTitles: {
                SearchTitleString: string;
                SearchTitleType: string;
            }[];
            Language: string;
            ShortDescription: string;
        }[];
        DisplaySkuAvailabilities: {
            Sku: {
                SkuId: string;
                RecurrencePolicy: any;
                LocalizedProperties: {
                    SkuDescription: string;
                    SkuTitle: string;
                    SkuButtonTitle: string;
                    SkuDisplayRank: any[];
                    LegalText: {
                        Copyright: string;
                        CopyrightUri: string;
                        PrivacyPolicy: string;
                        PrivacyPolicyUri: string;
                        Tou: string;
                        TouUri: string;
                    };
                    Language: string;
                }[];
                Properties: {
                    FulfillmentType: string;
                    BundledSkus: string[];
                    IsRepurchasable: boolean;
                    SkuDisplayRank: number;
                    IsTrial: boolean;
                };
                DisplayProperties: {
                    IsPreOrder: boolean;
                };
            };
            Availabilities: {
                Actions: string[];
                AvailabilityId: string;
                Conditions: {
                    EndDate: string;
                };
                OrderManagementData?: {
                    Price: {
                        CurrencyCode: string;
                        ListPrice: number;
                        MSRP: number;
                        StrikethroughPrice: string;
                        DisplayPrice: string;
                    };
                };
                DisplayRank: number;
                RemediationRequired: boolean;
            }[];
        }[];
    }[];
}

export interface XboxDisplayCatalogueLookupResponse {
    BigIds: string[];
    HasMorePages: boolean;
    TotalResultCount: number;
    Products: {
        ProductId: string;
        ProductType: string;
        ProductKind: string;
        ProductFamily: string;
        SchemaVersion: string;
        SandboxId: string;
        IsSandboxedProduct: boolean;
        IsMicrosoftProduct: boolean;
        LastModifiedDate: string;
        PreferredSkuId: string;
        IngestionSource: string;
        ProductASchema: string;
        ProductBSchema: string;
        DomainDataVersion: string | null;
        PartD: string;
        MerchandizingTags: any[];
        AlternateIds: {
            IdType: string;
            Value: string;
        }[];
        ValidationData: {
            PassedValidation: boolean;
            RevisionId: string;
            ValidationResultUri: string;
        };
        Properties: {
            Attributes: {
                Name: string;
                Minimum: number | null;
                Maximum: number | null;
                ApplicablePlatforms: string[] | null;
                Group: string | null;
            }[];
            CanInstallToSDCard: boolean;
            Category: string;
            Categories: string[];
            Subcategory: string | null;
            IsAccessible: boolean;
            IsDemo: boolean;
            IsLineOfBusinessApp: boolean;
            IsPublishedToLegacyWindowsPhoneStore: boolean;
            IsPublishedToLegacyWindowsStore: boolean;
            PackageFamilyName: string;
            PackageIdentityName: string;
            PublisherCertificateName: string;
            PublisherId: string;
            SkuDisplayGroups: {
                Id: string;
                Treatment: string;
            }[];
            XboxLiveTier: string;
            XboxXPA: string | null;
            XboxCrossGenSetId: string | null;
            XboxConsoleGenOptimized: string[];
            XboxConsoleGenCompatible: string[];
            XboxLiveGoldRequired: boolean;
            ExtendedMetadata: string;
            XBOX: {
                XboxProperties: string;
                SubmissionId: string;
                XboxGamingMetadata: string;
            };
            ExtendedClientMetadata: object;
            OwnershipType: string | null;
            PdpBackgroundColor: string;
            HasAddOns: boolean;
            RevisionId: string;
            ProductGroupId: string;
            ProductGroupName: string;
            IsPrivateBeforeDateHint: string;
        };
        LocalizedProperties: {
            DeveloperName: string;
            PublisherName: string;
            PublisherAddress: string | null;
            PublisherWebsiteUri: string;
            SupportUri: string;
            SupportPhone: string | null;
            ProductTitle: string;
            ProductDescription: string;
            ShortTitle: string;
            SortTitle: string;
            FriendlyTitle: string | null;
            ShortDescription: string;
            VoiceTitle: string;
            RenderGroupDetails: any;
            ProductDisplayRanks: any[];
            InteractiveModelConfig: any;
            Interactive3DEnabled: boolean;
            Language: string;
            Markets: string[];
            SearchTitles: {
                SearchTitleString: string;
                SearchTitleType: string;
            }[];
            Videos: any[];
            CMSVideos: {
                DASH: string;
                HLS: string;
                CMS: any;
                CC: any;
                VideoPurpose: string;
                Height: number;
                Width: number;
                AudioEncoding: string;
                VideoEncoding: string;
                VideoPositionInfo: string;
                Caption: string;
                FileSizeInBytes: number;
                TrailerId: string;
                SortOrder: number;
                PreviewImage: {
                    FileId: string;
                    EISListingIdentifier: string | null;
                    BackgroundColor: string | null;
                    Caption: string;
                    FileSizeInBytes: number;
                    ForegroundColor: string | null;
                    Height: number;
                    ImagePositionInfo: string | null;
                    ImagePurpose: string;
                    UnscaledImageSHA256Hash: string;
                    Uri: string;
                    Width: number;
                };
            }[];
            EligibilityProperties: {
                Remediations: any[];
                Affirmations: any[];
            };
            Franchises: any[];
            Images: {
                FileId: string;
                EISListingIdentifier: string | null;
                BackgroundColor: string;
                Caption: string;
                FileSizeInBytes: number;
                ForegroundColor: string;
                Height: number;
                ImagePositionInfo: string;
                ImagePurpose: string;
                UnscaledImageSHA256Hash: string;
                Uri: string;
                Width: number;
            }[];
        }[];
        MarketProperties: {
            OriginalReleaseDate: string;
            MinimumUserAge: number;
            ContentRatings: {
                RatingSystem: string;
                RatingId: string;
                RatingDescriptors: string[];
                RatingDisclaimers: string[];
                InteractiveElements: string[];
            }[];
            RelatedProducts: {
                RelatedProductId: string;
                RelationshipType: string;
            }[];
            UsageData: {
                AggregateTimeSpan: string;
                AverageRating: number;
                PlayCount: number;
                RatingCount: number;
                RentalCount: string;
                TrialCount: string;
                PurchaseCount: string;
            }[];
            BundleConfig: any;
            Markets: string[];
        }[];
        ProductPolicies: object;
    }[];
}

export interface XboxGameAchievementsResponse {
    achievements: {
        id: string;
        serviceConfigId: string;
        name: string;
        titleAssociations: {
            name: string;
            id: number;
        }[];
        progressState: string;
        progression: {
            requirements: {
                id: string;
                current: string;
                target: string;
                operationType: string;
                valueType: string;
                ruleParticipationType: string;
            }[];
            timeUnlocked: string;
        };
        mediaAssets: {
            name: string;
            type: string;
            url: string;
        }[];
        platforms: string[];
        isSecret: boolean;
        description: string;
        lockedDescription: string;
        productId: string;
        achievementType: string;
        participationType: string;
        timeWindow: string | null;
        rewards: {
            name: string | null;
            description: string | null;
            value: string;
            type: string;
            mediaAsset: any;
            valueType: string;
        }[];
        estimatedTime: string;
        deeplink: string;
        isRevoked: boolean;
    }[];
    pagingInfo: {
        continuationToken: string | null;
        totalRecords: number;
    };
}
