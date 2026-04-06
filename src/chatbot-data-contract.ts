export const CHATBOT_CONTRACT_VERSION = '1.0.0';

export type ChatbotEntityType =
  | 'LocationSnapshot'
  | 'AccessActivity'
  | 'ApprovalRequest'
  | 'AdminUserProfile'
  | 'FeatureEvent';

export type VisibilityScope = 'admin_only' | 'anonymous_allowed';

export type FreshnessStatus = 'live' | 'stale' | 'offline';

export type AccessStatus = 'active' | 'recent' | 'offline';

export type FieldPolicy = 'public_to_chatbot' | 'restricted_to_chatbot' | 'never_expose';

export interface CanonicalEntityBase {
  entityType: ChatbotEntityType;
  entityId: string;
  sourceApi: string;
  updatedAt: string;
  capturedAt: string;
  freshnessSeconds: number;
  confidence: number;
  visibilityScope: VisibilityScope;
  version: string;
}

export interface LocationSnapshot extends CanonicalEntityBase {
  entityType: 'LocationSnapshot';
  personName: string;
  role: 'admin' | 'fieldman';
  latitude: number;
  longitude: number;
  address: string | null;
  freshnessStatus: FreshnessStatus;
  accessStatus: AccessStatus;
  source: string;
}

export interface AccessActivityRecord extends CanonicalEntityBase {
  entityType: 'AccessActivity';
  personName: string;
  role: 'admin' | 'fieldman' | 'unknown';
  status: AccessStatus;
  statusChangedAt: string | null;
  lastEventAt: string | null;
}

export interface ApprovalRequestRecord extends CanonicalEntityBase {
  entityType: 'ApprovalRequest';
  requestType: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedByName: string;
  reviewedByName: string | null;
}

export interface AdminUserProfileRecord extends CanonicalEntityBase {
  entityType: 'AdminUserProfile';
  personName: string;
  role: 'admin' | 'fieldman' | 'unknown';
  isActive: boolean;
}

export interface FeatureEventRecord extends CanonicalEntityBase {
  entityType: 'FeatureEvent';
  featureName: string;
  eventType: string;
  payloadSummary: string;
}

export type ChatbotCanonicalEntity =
  | LocationSnapshot
  | AccessActivityRecord
  | ApprovalRequestRecord
  | AdminUserProfileRecord
  | FeatureEventRecord;

export interface RequesterContext {
  isAnonymous: boolean;
}

// Step 1 policy: expose exact coordinates and real names, never expose Lark IDs.
export const LOCATION_SNAPSHOT_FIELD_POLICY: Record<string, FieldPolicy> = {
  entityType: 'public_to_chatbot',
  entityId: 'restricted_to_chatbot',
  sourceApi: 'restricted_to_chatbot',
  updatedAt: 'restricted_to_chatbot',
  capturedAt: 'public_to_chatbot',
  freshnessSeconds: 'restricted_to_chatbot',
  confidence: 'restricted_to_chatbot',
  visibilityScope: 'restricted_to_chatbot',
  version: 'restricted_to_chatbot',
  personName: 'public_to_chatbot',
  role: 'public_to_chatbot',
  latitude: 'public_to_chatbot',
  longitude: 'public_to_chatbot',
  address: 'public_to_chatbot',
  freshnessStatus: 'public_to_chatbot',
  accessStatus: 'public_to_chatbot',
  source: 'restricted_to_chatbot',
  larkId: 'never_expose',
  sessionId: 'never_expose',
  device: 'never_expose',
};

export function deriveVisibilityScopeByRole(role: string): VisibilityScope {
  const normalizedRole = String(role || '').toLowerCase();
  return normalizedRole === 'fieldman' ? 'anonymous_allowed' : 'admin_only';
}

export function canRequesterReadEntity(
  visibilityScope: VisibilityScope,
  requester: RequesterContext
): boolean {
  if (!requester.isAnonymous) {
    return true;
  }

  return visibilityScope === 'anonymous_allowed';
}

function isIsoDate(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function isValidCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function validateLocationSnapshot(item: LocationSnapshot): string[] {
  const errors: string[] = [];

  if (!item.entityId || typeof item.entityId !== 'string') {
    errors.push('entityId is required');
  }

  if (!item.personName || typeof item.personName !== 'string') {
    errors.push('personName is required');
  }

  if (item.role !== 'admin' && item.role !== 'fieldman') {
    errors.push('role must be admin or fieldman');
  }

  if (!isValidCoordinate(item.latitude, -90, 90)) {
    errors.push('latitude must be between -90 and 90');
  }

  if (!isValidCoordinate(item.longitude, -180, 180)) {
    errors.push('longitude must be between -180 and 180');
  }

  if (!isIsoDate(item.updatedAt)) {
    errors.push('updatedAt must be an ISO datetime');
  }

  if (!isIsoDate(item.capturedAt)) {
    errors.push('capturedAt must be an ISO datetime');
  }

  if (item.visibilityScope !== 'admin_only' && item.visibilityScope !== 'anonymous_allowed') {
    errors.push('visibilityScope must be admin_only or anonymous_allowed');
  }

  return errors;
}

export function toChatbotSafeLocationSnapshot(
  item: LocationSnapshot,
  requester: RequesterContext
): Omit<LocationSnapshot, 'entityId' | 'sourceApi' | 'updatedAt' | 'freshnessSeconds' | 'confidence' | 'visibilityScope' | 'version'> | null {
  if (!canRequesterReadEntity(item.visibilityScope, requester)) {
    return null;
  }

  return {
    entityType: 'LocationSnapshot',
    capturedAt: item.capturedAt,
    personName: item.personName,
    role: item.role,
    latitude: item.latitude,
    longitude: item.longitude,
    address: item.address,
    freshnessStatus: item.freshnessStatus,
    accessStatus: item.accessStatus,
    source: item.source,
  };
}
