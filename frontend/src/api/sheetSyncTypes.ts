// Client-side mirrors of the backend sheet-sync types. Dates are strings here
// because the preview is serialized as JSON over the wire (Date → ISO string),
// then echoed back to /execute verbatim.

export type CollisionDecision = 'skip' | 'create-new';

export interface PreviewItem {
  wpNo: string;
  description: string;
  station: string;
  tatDays: number;
  acRegistration: string;
  customer: string;
  timeframeFrom: string;
  timeframeTo: string;
  currentTimeframeFrom?: string;
  currentTimeframeTo?: string;
  currentAcRegistration?: string;
  currentCustomer?: string;
  currentStation?: string;
  warning?: string;
  existingWpId?: number;
}

export interface PreviewData {
  toCreate: PreviewItem[];
  toUpdate: PreviewItem[];
  collisions: PreviewItem[];
  noChange: PreviewItem[];
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { wpNo: string; reason: string }[];
}
