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
  template: { id: number; templateId: string; title: string } | null;
  issuer: { id: number; name: string } | null;
  assignedToUser: { id: number; name: string; role?: string } | null;
  targetDivision: { id: number; name: string; code: string } | null;
  wp: { id: number; wpId: string; name: string } | null;
  taskData?: { data: Record<string, unknown> } | null;
}

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
  status: 'Open' | 'In Progress' | 'Overdue' | 'Closed' | 'Inactive';
  inactivationLog: any | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskActivity {
  id: number;
  taskId: number;
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

export interface TimeBooking {
  id: number;
  taskId: number;
  assigneeEntry: any;
  collaborators: any;
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

export interface Finding {
  id: number;
  severity: 'Observation' | 'Level 1' | 'Level 2' | null;
  category: string;
  description: string;
  status: 'Open' | 'In Progress' | 'Pending Verification' | 'Closed';
  fieldId: string | null;
  dueDate: string | null;
  eventType: string;
  aircraftRegistration: string | null;
  regulatoryReference: string | null;
  errorCode: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  recurrence: boolean | null;
  violatorIds: any | null;
  sourceTaskId: number | null;
  reportedByUserId: number;
  closedByUserId: number | null;
  targetDivisionId: number | null;
  createdAt: string;
  closedAt: string | null;
  updatedAt: string;
}
