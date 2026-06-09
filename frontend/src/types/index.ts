export interface Role {
  id: number;
  name: string;
}

export interface User {
  id: number;
  employeeId: string;
  name: string;
  email: string;
  role: string; // The backend returns the role name as a string
  divisionId: number | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ── Task status — exactly the 10 DB statuses (isOverdue is a separate boolean)
export type TaskStatus =
  | 'Unassigned'
  | 'Assigned'
  | 'In Progress'
  | 'In Review'
  | 'Follow-up Required'
  | 'Closed'
  | 'Rejected'
  | 'Terminated'
  | 'Inactive';

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox_group'
  | 'checkbox_single'
  | 'date'
  | 'file_upload'
  | 'rich_text';

export interface FormField {
  fieldId: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  helpText?: string;
  options?: string[];
  dataSource?: string;
}

export interface Template {
  id: number;
  templateId: string;
  title: string;
  description: string | null;
  status: 'Draft' | 'Published' | 'Archived';
  revision: number;
  revisedByUser?: { name: string } | null;
  revisedAt?: string | null;
  
  requiresApproval: boolean;
  allowsFindings: boolean;
  estimatedHours: number | null;
  isOneOff: boolean;
  type: string | null;
  
  divisionId: number;
  division?: { id: number; name: string } | null;
  ownerId: number;
  owner?: { id: number; name: string } | null;
  
  formSchema: FormField[];
  draftSchema?: any;
  revisionArchives?: any[];
  
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface DeadlineExtension {
  requestedBy: number;
  reason: string;
  requestedAt: string;
  decision?: 'approved' | 'denied';
  decidedAt?: string;
  newDeadline?: string;
}

export interface Task {
  id: number;
  taskId: string;
  title: string | null;
  templateId: number;
  status: TaskStatus;
  issuerId: number;
  assignedToUserId: number | null;
  wpId: number | null;
  deadline: string | null;
  deadlineExtensions: DeadlineExtension[] | null;
  inactivationLog: { reason: string; inactivatedBy: number; inactivatedAt: string } | null;
  rejectionReason: string | null;
  rating: number | null;
  estimatedHours: number | null;
  issuanceNote: string | null;
  responseActionType: ResponseActionType | null;
  requiresDirectorApproval: boolean;
  assignmentType: string;
  schemaSnapshot: FormField[];
  targetDivisionId: number | null;
  parentFindingId: number | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

// Enriched Task — returned by GET /api/tasks/:id and list endpoints
// Includes nested joined objects from taskInclude() + computed isOverdue
export interface TaskEnriched extends Task {
  isOverdue: boolean;
  template: { id: number; templateId: string; title: string; allowsFindings?: boolean } | null;
  issuer: { id: number; name: string } | null;
  assignedToUser: { id: number; name: string; role?: string } | null;
  targetDivision: { id: number; name: string; code: string } | null;
  wp: { id: number; wpId: string; name: string } | null;
  taskData?: { data: Record<string, unknown> } | null;
  timeBooking?: TimeBooking | null;
  parentFinding?: { id: number } | null;
}

export type WpStatus = 'Open' | 'In Progress' | 'Overdue' | 'Closed' | 'Inactive';

export interface WorkPackage {
  id: number;
  wpId: string;
  name: string;
  type: string;
  divisionId: number;
  timeframeFrom: string;
  timeframeTo: string;
  creatorId: number;
  checkTemplateId: number | null;
  status: WpStatus;
  inactivationLog: { reason: string; inactivatedBy: number; inactivatedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WpType {
  id: number;
  code: string;
  description: string | null;
}

// Enriched WP returned by GET /api/work-packages (list)
export interface WorkPackageEnriched extends WorkPackage {
  computedStatus: WpStatus;
  division: { id: number; name: string; code: string } | null;
  creator: { id: number; name: string } | null;
  assignments: { id: number; wpId: number; userId: number; user: { id: number; name: string } }[];
  _count: { tasks: number };
}

// WP task row returned by GET /api/work-packages/:id
export interface WpTaskRow {
  id: number;
  taskId: string;
  status: TaskStatus;
  assignedToUser: { id: number; name: string } | null;
  template: { title: string; templateId: string } | null;
  createdAt: string;
  completedAt: string | null;
  deadline: string | null;
}

// Enriched WP returned by GET /api/work-packages/:id (detail)
export interface WorkPackageDetail extends WorkPackage {
  computedStatus: WpStatus;
  division: { id: number; name: string; code: string } | null;
  creator: { id: number; name: string } | null;
  assignments: { id: number; wpId: number; userId: number; user: { id: number; name: string; email: string } }[];
  tasks: WpTaskRow[];
}

// Backed by the unified FeedPost model. The Task feed is scope 'TASK',
// scopeId = task.id. (Phase 2 introduces dedicated FeedPost types for the
// WP / Division / Org feeds; this alias keeps the existing Task feed wiring.)
export interface TaskActivity {
  id: number;
  scope: 'TASK' | 'WP' | 'DIVISION' | 'ORG';
  scopeId: number | null;
  authorId: number | null;
  type: 'SYSTEM_EVENT' | 'COMMENT';
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Enriched — server-side joined author name
export interface TaskActivityEnriched extends TaskActivity {
  author: { id: number; name: string | null } | null;
}

// ── Unified feed (Phase 2) — generic across all four scopes ──────────────────
export type FeedScope = 'TASK' | 'WP' | 'DIVISION' | 'ORG';
export type FeedPostType = 'COMMENT' | 'SYSTEM_EVENT' | 'ESCALATION_CARD' | 'INFO_CARD';

export interface FeedPost {
  id: number;
  scope: FeedScope;
  scopeId: number | null;
  authorId: number | null;
  type: FeedPostType;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  // Escalation linkage — populated from Phase 3 onward.
  sourcePostId?: number | null;
  sourceExcerpt?: string | null;
  sourceTaskId?: number | null;
  sourceWpId?: number | null;
  flagId?: number | null;
  taggedDivisionIds?: number[] | null;
}

export interface FeedPostEnriched extends FeedPost {
  author: { id: number; name: string | null } | null;
  // Live status of the linked EscalationFlag (cards only) — keeps the card badge
  // honest after the flag is actioned (Phase 4). Null for non-card posts.
  flagStatus?: EscalationFlagStatus | null;
  // Whether the requesting viewer may action this escalation card. Computed
  // server-side (canActionFlag) so the UI gate matches backend RBAC exactly,
  // including the Manager own-division rule the client can't resolve alone.
  canAction?: boolean;
}

// ── Escalation (Phase 3) ─────────────────────────────────────────────────────
// A flag may target a scope strictly above the comment's own (TASK is the floor).
export type EscalationTargetScope = 'WP' | 'DIVISION' | 'ORG';

// ── Escalation flag lifecycle (Phase 4) ──────────────────────────────────────
export type EscalationFlagStatus = 'PENDING' | 'ACTIONED' | 'DISMISSED';

export type EscalationAction =
  | 'ACKNOWLEDGE'
  | 'DISMISS'
  | 'RAISE_FINDING'
  | 'CREATE_TASK'
  | 'REASSIGN_TASK'
  | 'DISSEMINATE';

// Per-action payloads sent to POST /api/escalations/:id/action.
export interface CreateTaskActionPayload {
  templateId: number;
  targetDivisionId: number;
  wpId?: number | null;
  assignedToUserId?: number | null;
  deadline?: string | null;
  estimatedHours?: number | null;
}

export interface RaiseFindingActionPayload {
  eventType: string;
  departmentId: number;
  description: string;
  fieldId?: string | null;
  aircraftRegistration?: string | null;
  regulatoryReference?: string | null;
}

export interface ReassignTaskActionPayload {
  newAssigneeId: number;
  reason: string;
}

export interface DisseminateActionPayload {
  taggedDivisionIds?: number[];
}

export type EscalationActionPayload =
  | CreateTaskActionPayload
  | RaiseFindingActionPayload
  | ReassignTaskActionPayload
  | DisseminateActionPayload
  | Record<string, never>;

// One row of the viewer's escalation list (GET /api/escalations). Serves both the
// live action queue (PENDING) and the retained history (ACTIONED / DISMISSED).
export interface PendingEscalation {
  id: number;
  targetScope: EscalationTargetScope;
  status: EscalationFlagStatus;
  createdAt: string;
  sourcePostId: number;
  sourceExcerpt: string | null;
  sourceTaskId: number | null;
  sourceWpId: number | null;
  flaggedByUserId: number;
  flaggedBy: { id: number; name: string | null } | null;
  card: { scope: FeedScope; scopeId: number | null } | null;
  // Action result — null while PENDING; populated once actioned/dismissed.
  action?: EscalationAction | null;
  actionedAt?: string | null;
  reviewedBy?: { id: number; name: string | null } | null;
}

export interface TimeBookingEntry {
  userId: number;
  hoursLogged: number;
  notes: string;
}

export interface TimeBooking {
  id: number;
  taskId: number;
  assigneeEntry: TimeBookingEntry;
  collaborators: TimeBookingEntry[];
  totalHours: number;
  estimatedHours: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  entityType: string;
  entityId: string;
  uploadedById: number;
  createdAt: string;
}

export type FindingSeverity = 'Observation' | 'Level 1' | 'Level 2';
export type FindingStatus = 'Open' | 'In Progress' | 'Pending Verification' | 'Closed' | 'Dismissed';

export interface Finding {
  id: number;
  severity: FindingSeverity | null;
  category: string | null;
  description: string;
  status: FindingStatus;
  fieldId: string | null;
  dueDate: string | null;
  eventType: string;
  departmentId: number;
  aircraftRegistration: string | null;
  regulatoryReference: string | null;
  errorCode: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  recurrence: boolean | null;
  violatorIds: unknown | null;
  sourceTaskId: number | null;
  reportedByUserId: number;
  closedByUserId: number | null;
  targetDivisionId: number | null;
  ataChapterId: number | null;
  createdAt: string;
  closedAt: string | null;
  updatedAt: string;
}

// ─── Findings expansion: RCA / CAPA / Taxonomy / Traceability / Trend ─────────

export type RcaMethod = 'MEDA' | 'FIVE_WHYS' | 'OTHER';
export type RcaStatus = 'Draft' | 'Complete';
export type CapaType = 'CORRECTIVE' | 'PREVENTIVE';
export type CapaStatus = 'Open' | 'In Progress' | 'Completed' | 'Verified' | 'Waived';
export type CapaLinkRole = 'EXECUTION' | 'EFFECTIVENESS' | 'SUPPORTING';
export type FindingLinkType = 'DUPLICATE' | 'RELATED' | 'CAUSED_BY';
export type ResponseActionType = 'CAR' | 'NCR' | 'QN' | 'QR' | 'IR' | 'Dissemination';

export interface CapaWpRef { id: number; wpId: string; name: string; status: string; }

export interface CapaTaskLink {
  id: number;
  capaId: number;
  role: CapaLinkRole;
  taskId: number | null;
  task?: { id: number; taskId: string; title: string | null; status: TaskStatus; } | null;
  wpId: number | null;
  wp?: CapaWpRef | null;
}

export interface AtaChapter { id: number; code: string; title: string; isActive: boolean; }
export interface CauseCode { id: number; code: string; name: string; groupCode: string; groupName: string; isActive: boolean; }
export interface HazardTag { id: number; label: string; description: string | null; isActive: boolean; }

export interface RcaWhyStep { id: number; orderIndex: number; question: string; answer: string | null; }
export interface RcaContributingFactor { id: number; category: string; detail: string | null; isPrimary: boolean; }

export interface RcaInvestigation {
  id: number;
  method: RcaMethod;
  summary: string | null;
  status: RcaStatus;
  causeCodeId: number | null;
  causeCode?: CauseCode | null;
  conductedByUserId: number | null;
  conductedByUser?: { id: number; name: string } | null;
  whySteps: RcaWhyStep[];
  factors: RcaContributingFactor[];
}

export interface CapaTaskRef { id: number; taskId: string; status: TaskStatus; }

export interface CapaAction {
  id: number;
  findingId: number;
  type: CapaType;
  description: string;
  ownerUserId: number | null;
  ownerUser?: { id: number; name: string } | null;
  deadline: string | null;
  status: CapaStatus;
  linkedItems: CapaTaskLink[];
  verifiedByUserId: number | null;
  verifiedByUser?: { id: number; name: string } | null;
  verifiedAt: string | null;
  waivedReason: string | null;
}

export interface TrendInfo {
  isRecurring: boolean;
  matchCount: number;
  threshold: number;
  windowDays: number;
  signatureStrength: 'strong' | 'partial' | 'none';
  signature: { departmentId: number | null; ataChapterId: number | null; causeCodeId: number | null; hazardTagIds: number[] };
}

export interface FindingHazardTagRef { id: number; hazardTagId: number; hazardTag: HazardTag; }

export interface LinkedFindingRef { id: number; description: string; status: FindingStatus; severity: FindingSeverity | null; eventType: string; }

export interface FindingLinkRecord {
  id: number;
  linkType: FindingLinkType;
  note: string | null;
  relatedFinding?: LinkedFindingRef;
  fromFinding?: LinkedFindingRef;
  createdByUser?: { id: number; name: string };
}

export interface ResolvedDepartment { id: number; name: string; }

export interface FindingResponseAction {
  id: number;
  findingId: number;
  type: ResponseActionType;
  taskId: number | null;
  task: { id: number; taskId: string; status: TaskStatus } | null;
  targetDepartmentIds: number[];
  targetDepartments: ResolvedDepartment[];
  procedureRef: string | null;
  note: string | null;
  createdByUserId: number;
  createdByUser: { id: number; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

// Shared nested shapes returned by the findings API
export interface FindingSourceTask {
  id: number;
  taskId: string;
  title: string | null;
  status: TaskStatus;
}

export interface FindingFollowUpTask {
  id: number;
  taskId: string;
  title: string | null;
  status: TaskStatus;
  assignedToUserId: number | null;
  assignedToUser: { id: number; name: string } | null;
  responseActionType: ResponseActionType | null;
  requiresDirectorApproval: boolean;
}

export interface FindingUserRef {
  id: number;
  name: string;
  role?: { name: string } | null;
}

// GET /api/findings — one row
export interface FindingListItem extends Finding {
  dueDateBreached: boolean;
  sourceTask: FindingSourceTask | null;
  reportedByUser: { id: number; name: string } | null;
  targetDivision: { id: number; name: string; code: string } | null;
  department: { id: number; name: string } | null;
}

export interface FindingsListResponse {
  findings: FindingListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// GET /api/findings/:id — full detail
export interface FindingDetail extends Finding {
  dueDateBreached: boolean;
  sourceTask: FindingSourceTask | null;
  followUpTasks: FindingFollowUpTask[];
  reportedByUser: FindingUserRef | null;
  closedByUser: FindingUserRef | null;
  targetDivision: { id: number; name: string; code: string } | null;
  department: { id: number; name: string } | null;
  // Expansion pack
  ataChapter: AtaChapter | null;
  hazardTags: FindingHazardTagRef[];
  rca: RcaInvestigation | null;
  capaActions: CapaAction[];
  linksFrom: FindingLinkRecord[];
  linksTo: FindingLinkRecord[];
  responseActions: FindingResponseAction[];
  trend: TrendInfo;
}

export interface TimeEntryCollaborator {
  userId: number;
  hoursLogged: number;
  notes: string;
}

export interface TimeEntry {
  id: number;
  taskId: number;
  loggedByUserId: number;
  loggedBy?: { id: number; name: string } | null;
  sessionHours: number;
  sessionNotes: string;
  collaboratorEntries: TimeEntryCollaborator[];
  overBudgetReason: string | null;
  overBudgetNote: string | null;
  loggedAt: string;
}

export interface TimeEntrySummary {
  assigneeEntry: TimeBookingEntry;
  collaborators: TimeBookingEntry[];
  entryCount: number;
  runningTotal: number;
}
