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
  | 'file_upload';

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
export type FindingStatus = 'Open' | 'In Progress' | 'Pending Verification' | 'Closed';

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
  createdAt: string;
  closedAt: string | null;
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
}
