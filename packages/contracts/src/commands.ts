import type { DistrictId, RouteId, TeamId } from "./ids.js";
import type { Tick } from "./types.js";

export type CommandId = string;
export type IdempotencyKey = string;

export interface CommandEnvelope {
  commandId: CommandId;
  idempotencyKey: IdempotencyKey;
  commandName: CommandName;
  issuedTick: Tick;
  target: string;
  params: Record<string, unknown>;
  validation: CommandValidation;
  state: "accepted" | "rejected" | "pending";
  etaTick: Tick | null;
  result: CommandResult | null;
}

export interface CommandValidation {
  valid: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CommandResult {
  ok: boolean;
  detail: string;
}

export type CommandName =
  | "DISPATCH_TEAM"
  | "REROUTE_POWER"
  | "ACTIVATE_BACKUP_GENERATOR"
  | "CLOSE_ROUTE"
  | "REOPEN_ROUTE"
  | "REQUEST_VERIFICATION"
  /** District inspection without claim binding (engine verify task). */
  | "INSPECT_DISTRICT"
  | "ISSUE_PUBLIC_ADVISORY"
  | "PRIORITIZE_COMMUNICATION"
  | "CANCEL_ORDER";

export interface DispatchTeamParams {
  teamId: TeamId;
  target: DistrictId;
  task: string;
}

export interface ReroutePowerParams {
  from: DistrictId;
  to: DistrictId;
}

export interface ActivateBackupGeneratorParams {
  district: DistrictId;
}

export interface CloseRouteParams {
  route: RouteId;
}

export interface ReopenRouteParams {
  route: RouteId;
}

export interface RequestVerificationParams {
  target: DistrictId;
  teamId: TeamId;
}

export interface IssuePublicAdvisoryParams {
  district: DistrictId;
  text: string;
  severity: "info" | "warning" | "evacuation";
}

export interface PrioritizeCommunicationParams {
  district: DistrictId;
  ticks: number;
}

export interface CancelOrderParams {
  orderId: string;
  reason: string;
}

export type CommandParams =
  | DispatchTeamParams
  | ReroutePowerParams
  | ActivateBackupGeneratorParams
  | CloseRouteParams
  | ReopenRouteParams
  | RequestVerificationParams
  | IssuePublicAdvisoryParams
  | PrioritizeCommunicationParams
  | CancelOrderParams;
