export interface Role {
  id: number;
  name: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  divisionId: number | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}
