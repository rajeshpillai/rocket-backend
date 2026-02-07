export interface AppInfo {
  name: string;
  display_name: string;
  db_name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAppRequest {
  name: string;
  display_name: string;
}
