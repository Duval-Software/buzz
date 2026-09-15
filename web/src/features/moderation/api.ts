import { managedRequest } from "@/features/identity/managed-accounts";
import { publishCommunityCommand } from "@/features/community/community-access";

export type StaffRole = "owner" | "admin" | "moderator";
export type Section =
  | "reports"
  | "members"
  | "channels"
  | "appeals"
  | "history";
export type StaffItem = {
  id?: string;
  pubkey?: string;
  role?: string;
  username?: string;
  display_name?: string;
  report_event_id?: string;
  target_event_id?: string;
  target_pubkey?: string;
  report_type?: string;
  status?: string;
  note?: string;
  evidence?: string;
  removed?: boolean;
  banned?: boolean;
  muted_until?: string;
  rename_required?: boolean;
  action?: string;
  reason?: string;
  actor?: string;
  detail?: string;
  created_at?: string;
  explanation?: string;
  decision?: string;
  original_actor?: string;
  exception?: string;
  appeal_status?: string;
};
export type StaffData = {
  role: StaffRole;
  self: string;
  items: StaffItem[];
  more: boolean;
  policy: { revision: string | null; count: number };
};
export type OwnModeration = {
  items: StaffItem[];
  banned: boolean;
  rename_required: boolean;
  muted_until?: string;
};
export function readStaff(
  section: string,
  status = "",
  search = "",
  page = 0,
): Promise<StaffData> {
  return managedRequest("moderation/read", { section, status, search, page });
}
export function readOwnModeration(): Promise<OwnModeration> {
  return managedRequest("moderation/read", { section: "own" });
}
export function appealAction(action_id: string, explanation: string) {
  return managedRequest("moderation/appeal", { action_id, explanation });
}
export function staffCommand(
  kind: 9032 | 9040 | 9041 | 9042 | 9043 | 9044 | 9045 | 9046,
  args: Record<string, string>,
) {
  return publishCommunityCommand(kind, Object.entries(args));
}
