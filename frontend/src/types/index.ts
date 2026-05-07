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
