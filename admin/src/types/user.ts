export interface UserRow {
  id: string;
  email: string;
  roles: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPayload {
  email: string;
  password?: string;
  roles: string[];
  active: boolean;
}

export function emptyUser(): UserPayload {
  return {
    email: "",
    password: "",
    roles: [],
    active: true,
  };
}
