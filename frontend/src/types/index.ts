export interface Role {
  id: number;
  name: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string; // The backend returns the role name as a string
  divisionId: number | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type FieldType = 'text' | 'number' | 'select' | 'checkbox' | 'textarea';
export type DataSource = 'custom' | 'departments' | 'divisions' | 'users' | 'aircrafts';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  dataSource?: DataSource;
  options?: string[];
}

export interface Template {
  id: number;
  title: string;
  description: string | null;
  status: 'Draft' | 'Published' | 'Archived';
  templateId: string;
  revision: number;
  revisedBy?: { name: string } | null;
  revisedAt?: string | null;
  requiresApproval: boolean;
  allowsFindings: boolean;
  formSchema: FormField[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
