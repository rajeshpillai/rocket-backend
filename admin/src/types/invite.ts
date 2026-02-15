export interface InviteRow {
  id: string;
  email: string;
  roles: string[];
  token: string;
  expires_at: string;
  accepted_at: string | null;
  invited_by: string | null;
  created_at: string;
}

export interface InvitePayload {
  email: string;
  roles: string[];
}

export interface BulkInvitePayload {
  emails: string[];
  roles: string[];
}

export interface BulkInviteCreated {
  id: string;
  email: string;
  token: string;
  expires_at: string;
}

export interface BulkInviteSkipped {
  email: string;
  reason: string;
}

export interface BulkInviteResult {
  created: BulkInviteCreated[];
  skipped: BulkInviteSkipped[];
  summary: { total: number; created: number; skipped: number };
}
