// Task API contract literals live in the mirror constants file (kept in sync
// with the backend authority by a guard test). Re-export the types here so the
// many `from '../types'` importers keep working.
import type { TaskStatus, DeadlineDecision } from '../constants/taskStatus';
export type { TaskStatus, ReviewAction, DeadlineDecision } from '../constants/taskStatus';

export interface Role {
  id: number;
  name: string;
}

export interface UserPreferences {
  taskColumns?: string[];
  taskFilters?: Record<string, unknown>;
}

export interface User {
  id: number;
  employeeId: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string; // The backend returns the role name as a string
  divisionId: number | null;
  forcePasswordChange: boolean;
  preferences?: UserPreferences | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ─── Privilege Management (Phase 7) ───────────────────────────────────────────

export interface PrivilegeCatalogItem {
  key: string;
  group: string;
  label: string;
}

// Effective permission map for a single role (key → granted).
export type PrivilegeMap = Record<string, boolean>;

export interface RolePrivileges {
  roleName: string;
  permissions: PrivilegeMap;
}

export interface PrivilegeMatrix {
  catalog: PrivilegeCatalogItem[];
  roles: RolePrivileges[];
}

// ── Notification event configuration (Settings → Notifications) ──────────────
export interface NotificationEventCatalogItem {
  key: string;
  group: string;
  label: string;
  description: string;
  recipientsFromPrivileges: boolean;
}

export interface NotificationEventConfig {
  eventKey: string;
  enabled: boolean;
  ccManagers: boolean;
}

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
  | 'rich_text'
  | 'report_block';

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
  externalRef?: string | null;
  title: string;
  description: string | null;
  status: 'Draft' | 'Published' | 'Archived';
  revision: number;
  revisedByUser?: { name: string } | null;
  revisedAt?: string | null;
  
  requiresApproval: boolean;
  allowsFindings: boolean;
  estimatedHours: number | null;
  skillLevel: number;
  type: string | null;
  
  divisionId: number;
  division?: { id: number; name: string } | null;
  ownerId: number;
  owner?: { id: number; name: string } | null;
  
  formSchema: FormField[];
  draftSchema?: any;
  hasPendingChanges?: boolean;
  revisionArchives?: any[];
  
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface DeadlineExtension {
  requestedBy: number;
  reason: string;
  requestedAt: string;
  decision?: DeadlineDecision;
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
  skillLevel: number;
  issuanceNote: string | null;
  responseActionType: ResponseActionType | null;
  requiresDirectorApproval: boolean;
  requiresApproval: boolean;
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
export type DeadlineStatus = 'Due Soon' | 'Due Today' | 'Overdue' | null;

export interface TaskEnriched extends Task {
  isOverdue: boolean;
  deadlineStatus: DeadlineStatus;
  // Server-computed (per requesting user): reviewer rights on this task. The
  // backend is the authority (privilege-aware); the client must not recompute it.
  isReviewer: boolean;
  lastActivityAt?: string;
  recentActivities?: { content: string; createdAt: string; author: { id: number; name: string | null } | null }[];
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
  autoGenerate: boolean;
  autoGenMode: 'SINGLE_SHOT' | 'REPEAT' | null;
  autoGenInterval: number | null;
  autoGenTemplateId: number | null;
  autoGenSetId: number | null;
  autoGenInlineSet: unknown | null;
  autoGenFiredAt: string | null;
  acRegistration: string | null;
  customer: string | null;
  authority: string | null;
  targetDepartmentId: number | null;
  status: WpStatus;
  inactivationLog: { reason: string; inactivatedBy: number; inactivatedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WpType {
  id: number;
  code: string;
  description: string | null;
  isActive?: boolean;
}

// ── Template Sets (P5) — ordered, reusable lists of templates for SINGLE_SHOT autogen ──
export interface TemplateSetItem {
  id: number;
  setId: number;
  templateId: number;
  orderIndex: number;
  deadlineOffsetDays: number | null;
  estimatedHours: number | null;
  skillLevel: number | null;
  requiresApproval: boolean | null;
  defaultNote: string | null;
  template?: { id: number; templateId: string; title: string; status: string };
}

export interface TemplateSet {
  id: number;
  name: string;
  description: string | null;
  divisionId: number;
  ownerId: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  division?: { id: number; name: string; code: string } | null;
  owner?: { id: number; name: string } | null;
  items?: TemplateSetItem[];
  _count?: { items: number };
}

// ── WP Blueprints (P6) — reusable WP templates with a manual launch ──
export interface WpBlueprint {
  id: number;
  name: string;
  description: string | null;
  type: string;
  divisionId: number;
  defaultDuration: number;
  defaultAutoGenerate: boolean;
  defaultAutoGenMode: 'SINGLE_SHOT' | 'REPEAT' | null;
  defaultAutoGenInterval: number | null;
  defaultAutoGenTemplateId: number | null;
  defaultAutoGenSetId: number | null;
  recurrenceType: 'CALENDAR' | 'LAST_DONE' | null;
  recurrenceInterval: number | null;
  recurrenceStartDate: string | null;
  nextRunAt: string | null;
  acRegistration: string | null;
  customer: string | null;
  authority: string | null;
  targetDepartmentId: number | null;
  ownerId: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  division?: { id: number; name: string; code: string } | null;
  owner?: { id: number; name: string } | null;
  defaultAutoGenTemplate?: { id: number; templateId: string; title: string } | null;
  defaultAutoGenSet?: { id: number; name: string } | null;
  _count?: { instances: number };
}

export interface EventType {
  id: number;
  code: string;
  description: string | null;
  isActive: boolean;
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
  autoGenResult?: {
    fired: boolean;
    spawned: number;
    spawnedTaskIds: number[];
    reason?: string;
    warnings?: string[];
  };
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

// A user surfaced by the @mention picker / resolved on a comment.
export interface MentionUser {
  id: number;
  name: string | null;
  employeeId?: string | null;
}

// A resolved inline #CODE reference in a comment (Phase E.2) → its detail route.
export interface EntityLink {
  type: 'TASK' | 'WP' | 'FINDING';
  id: number;
}
// Map of #CODE (without the '#') → link target, attached to enriched comments.
export type EntityLinkMap = Record<string, EntityLink>;

// Attachment metadata surfaced on a feed comment (Phase F). Bytes stream via
// /api/attachments/:id/download — never a public URL.
export interface FeedAttachment {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  caption: string | null;
}

// Enriched — server-side joined author name
export interface TaskActivityEnriched extends TaskActivity {
  author: { id: number; name: string | null } | null;
  hidden?: boolean; // soft-hidden (M4) — only ever present/true for Director/Admin reads
  pinned?: boolean; // always false for TASK feeds (not pinnable); kept for shape parity
  mentions?: MentionUser[]; // @mentioned users resolved to names (Phase E)
  entityLinks?: EntityLinkMap; // resolved #CODE references (Phase E.2)
  attachments?: FeedAttachment[]; // files attached to this comment (Phase F)
}

// ── Unified feed (Phase 2) — generic across all four scopes ──────────────────
export type FeedScope = 'TASK' | 'WP' | 'DIVISION' | 'ORG' | 'FINDING';
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
  // Moderation flags (Phase D). `hidden` is only ever true on Director/Admin reads
  // (others never receive hidden posts); `pinned` marks a pinned comment.
  hidden?: boolean;
  pinned?: boolean;
  // @mentioned users resolved to names (Phase E).
  mentions?: MentionUser[];
  // Resolved #CODE references (Phase E.2).
  entityLinks?: EntityLinkMap;
  // Files attached to this comment (Phase F).
  attachments?: FeedAttachment[];
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
  aircraftRegistrationCode?: string | null;
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

export type AttachmentEntityType = 'TASK' | 'FINDING' | 'TEMPLATE' | 'WP' | 'FEED_POST';

// Public attachment metadata as returned by the API. The internal storageKey /
// bucket are never exposed — downloads go through the backend stream endpoint.
export interface Attachment {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  entityType: AttachmentEntityType | string;
  entityId: string;
  fieldId: string | null;
  uploadedById: number;
  caption?: string | null;
  createdAt: string;
}

export interface FileCategoryRule {
  label: string;
  mimeTypes: string[];
  maxSizeBytes: number;
}

export interface FileUploadConfig {
  categories: FileCategoryRule[];
  totalPerEntityBytes: number;
}

export type FindingSeverity = 'Observation' | 'Level 1' | 'Level 2';
export type FindingStatus = 'Open' | 'In Progress' | 'Pending Verification' | 'Closed' | 'Dismissed';

export interface Finding {
  id: number;
  findingId: string | null; // Human-readable business code, e.g. FND-000001 (null for legacy rows not yet backfilled).
  severity: FindingSeverity | null;
  description: string;
  status: FindingStatus;
  fieldId: string | null;
  dueDate: string | null;
  eventType: string;
  departmentId: number;
  aircraftRegistrationCode: string | null;
  // Populated relation (present on list/detail reads). Null when no aircraft set.
  aircraftRegistration: { registration: string; description: string | null; operatorCode: string | null } | null;
  regulatoryReference: string | null;
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
export type FindingLinkType = 'DUPLICATE' | 'RELATED' | 'CAUSED_BY';
export type ResponseActionType = 'CAR' | 'NCR' | 'QN' | 'QR' | 'IR' | 'Dissemination';

export interface CapaWpRef { id: number; wpId: string; name: string; status: string; }

export interface CapaTaskLink {
  id: number;
  capaId: number;
  mandatory: boolean;
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

// ─── Notification Center ──────────────────────────────────────────────────────

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_REVIEWED'
  | 'TASK_SUBMITTED'
  | 'ESCALATION_QUEUED'
  | 'FINDING_CREATED'
  | 'FINDING_OVERDUE'
  | 'FEED_ACTIVITY'
  | 'BLUEPRINT_LAUNCHED'
  | 'TASKS_GENERATED';

export type NotificationLinkScope = 'TASK' | 'WP' | 'FINDING' | 'ESCALATION';

export interface AppNotification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  body: string | null;
  linkScope: NotificationLinkScope | null;
  linkId: number | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

// ─── Reference Data (aviation) ────────────────────────────────────────────────

export interface Department {
  id: number;
  name: string;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Operator {
  iataCode: string;
  name: string;
}

export interface Authority {
  code: string;
  fullName: string;
}

export interface AircraftType {
  code: string;
  createdAt?: string;
}

export interface AircraftRegistration {
  registration: string;
  description: string | null;
  serialNumber: string | null;
  status: string;
  aircraftTypeCode: string | null;
  operatorCode: string | null;
  authorityCode: string | null;
  createdAt?: string;
}

export interface AuthorizationType {
  id: number;
  code: string;
  description: string | null;
  category: string | null;
}
