import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

/**
 * Validation outcome for a lead row, per spec addendum §"Schema additions".
 *   eligible   — passed every gate check, dial-eligible after user confirms.
 *   quarantined — retained but never dialable (e.g. missing consent basis).
 *   blocked    — on a DNC / suppression list.
 *   invalid    — unparseable/invalid phone or other hard-reject.
 */
export const validationStatusEnum = pgEnum("validation_status", [
  "eligible",
  "quarantined",
  "blocked",
  "invalid",
  "duplicate",
]);

/** DNC scrub result cached per number. `unknown` when the stub hasn't decided. */
export const dncStatusEnum = pgEnum("dnc_status", [
  "clear",
  "listed",
  "unknown",
]);

export const consentStatusEnum = pgEnum("consent_status", [
  "has_basis",
  "missing",
]);

/**
 * Enumerated consent basis (Phase 2 ledger). Replaces trusting free text: a raw
 * consent string is classified into one of these, and only some are a lawful
 * basis to cold-call. `unrecognized` covers text we can't map (e.g. "purchased
 * list") — present but not a valid basis, so it quarantines.
 */
export const consentBasisTypeEnum = pgEnum("consent_basis_type", [
  "express_written",
  "express_oral",
  "existing_business_relationship",
  "inbound_inquiry",
  "unrecognized",
]);

/** Per-call state emitted by the classifier (Phase 3/4). */
export const callStateEnum = pgEnum("call_state", [
  "DIALING",
  "RINGING",
  "IVR_MENU",
  "ON_HOLD",
  "HUMAN",
  "VOICEMAIL",
  "DEAD",
  "BRIDGED",
  "ABANDONED",
]);

export const repPresenceEnum = pgEnum("rep_presence", ["available", "away"]);

/**
 * ingestion_batches — one row per upload. Holds the summary counts shown on the
 * pre-import report and the column mapping actually used for this batch.
 */
export const ingestionBatches = pgTable("ingestion_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  filename: text("filename").notNull(),
  uploadedBy: text("uploaded_by").notNull().default("dev"),
  rowCount: integer("row_count").notNull().default(0),
  eligibleCount: integer("eligible_count").notNull().default(0),
  quarantinedCount: integer("quarantined_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  invalidCount: integer("invalid_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  // "pending" until the user confirms the pre-import report, then "committed".
  status: text("status").notNull().default("pending"),
  columnMapping: jsonb("column_mapping").$type<ColumnMapping>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * leads — the canonical lead table. Rows land here at commit time with a
 * validation_status; only `eligible` rows are dial-eligible. Everything else is
 * retained with a rejection reason for the audit trail / fix-and-reupload flow.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: text("phone"), // E.164; null when unparseable (validation_status=invalid)
    name: text("name"),
    company: text("company"),
    timezone: text("timezone"), // IANA tz, derived from area code if absent
    source: text("source"),
    consentBasis: text("consent_basis"), // raw text as provided by the vendor
    // Consent ledger provenance (Phase 2): the classified basis type + where/when
    // it was obtained. consent_basis_type = 'unrecognized' is present-but-invalid.
    consentBasisType: consentBasisTypeEnum("consent_basis_type"),
    consentSource: text("consent_source"),
    consentObtainedAt: timestamp("consent_obtained_at", { withTimezone: true }),
    consentStatus: consentStatusEnum("consent_status")
      .notNull()
      .default("missing"),
    dncStatus: dncStatusEnum("dnc_status").notNull().default("unknown"),
    validationStatus: validationStatusEnum("validation_status").notNull(),
    validationReason: text("validation_reason"),
    campaignId: uuid("campaign_id"),
    lastContacted: timestamp("last_contacted", { withTimezone: true }),
    disposition: text("disposition"),
    ingestionBatchId: uuid("ingestion_batch_id").references(
      () => ingestionBatches.id,
    ),
    rawSourceRow: jsonb("raw_source_row").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A committed eligible number should be unique; dedupe against existing leads
    // is enforced in the service, this index guards it at the DB level too.
    uniqueIndex("leads_phone_eligible_uniq")
      .on(t.phone)
      .where(sql`validation_status = 'eligible'`),
    index("leads_batch_idx").on(t.ingestionBatchId),
    index("leads_validation_status_idx").on(t.validationStatus),
  ],
);

/**
 * column_mapping_templates — remembered per-vendor header→field mappings so
 * repeat uploads from the same source auto-map (spec addendum flow step 2).
 */
export const columnMappingTemplates = pgTable("column_mapping_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  vendor: text("vendor").notNull().unique(),
  mapping: jsonb("mapping").$type<ColumnMapping>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * suppression_list — internal DNC / opt-out list. Numbers here are hard-blocked.
 * The National + state DNC scrub is a stubbed external provider; this internal
 * list is real and used by both import-time scrub and (later) the pre-dial gate.
 */
export const suppressionList = pgTable(
  "suppression_list",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: text("phone").notNull().unique(), // E.164
    reason: text("reason").notNull().default("internal"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("suppression_phone_idx").on(t.phone)],
);

/**
 * audit_log — append-only record of every gate decision (spec §6 "All gate
 * decisions are logged immutably"). Never updated or deleted.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    event: text("event").notNull(), // e.g. "ingest.row.blocked"
    subjectPhone: text("subject_phone"),
    batchId: uuid("batch_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export type ColumnMapping = {
  // maps a lead-schema field to the source column header it was mapped from
  phone: string;
  name?: string;
  company?: string;
  timezone?: string;
  source?: string;
  consentBasis?: string;
  notes?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2+ : campaigns, reps, call attempts, IVR menu maps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * campaigns — a runnable unit: a lead list + rep pool + calling policy. The
 * config knobs from the spec live here so they're tunable per campaign.
 */
export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft | active | paused
  callingHoursStart: integer("calling_hours_start").notNull().default(8), // local hour
  callingHoursEnd: integer("calling_hours_end").notNull().default(21),
  overdialRatio: text("overdial_ratio").notNull().default("1.0"), // numeric-as-text
  perLeadDailyCap: integer("per_lead_daily_cap").notNull().default(3),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  maxHoldSeconds: integer("max_hold_seconds").notNull().default(480),
  repRingTimeoutSeconds: integer("rep_ring_timeout_seconds").notNull().default(15),
  maxIvrLevels: integer("max_ivr_levels").notNull().default(6),
  recordingPolicy: text("recording_policy").notNull().default("where_legal"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** reps — the people who get bridged to leads. presence feeds `freeReps`. */
export const reps = pgTable("reps", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(), // E.164 rep phone (or WebRTC identity)
  presence: repPresenceEnum("presence").notNull().default("away"),
  // true while bridged to a lead — a busy rep is not "free" even if available.
  onCall: boolean("on_call").notNull().default(false),
  campaignId: uuid("campaign_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * call_attempts — one row per outbound dial. Records the full state-machine
 * timeline and the outcome used for metrics + abandonment tracking.
 */
export const callAttempts = pgTable(
  "call_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable so the rep console can log a MANUAL call (no dialer lead/campaign).
    leadId: uuid("lead_id"),
    campaignId: uuid("campaign_id"),
    phone: text("phone").notNull(),
    finalState: callStateEnum("final_state"),
    reachedHuman: boolean("reached_human").notNull().default(false),
    bridged: boolean("bridged").notNull().default(false),
    abandoned: boolean("abandoned").notNull().default(false),
    repId: uuid("rep_id"),
    disposition: text("disposition"),
    timeToHumanMs: integer("time_to_human_ms"),
    holdMs: integer("hold_ms"),
    // full ordered [{state, at}] timeline for observability.
    timeline: jsonb("timeline").$type<{ state: string; at: string }[]>(),
    // Where the record originated: dialer hand-off vs. a manual console call.
    source: text("source").notNull().default("dialer"),
    // Rep-tracked conversation breakdown (ms per bucket: right/wrong/voicemail/
    // noanswer). The dialer's pre-bridge ring/wait/hold stays in holdMs/timeline.
    repBreakdown: jsonb("rep_breakdown").$type<Record<string, number>>(),
    repNote: text("rep_note"),
    syncedToSheet: boolean("synced_to_sheet").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("call_attempts_campaign_idx").on(t.campaignId),
    index("call_attempts_lead_idx").on(t.leadId),
    index("call_attempts_started_idx").on(t.startedAt),
  ],
);

/**
 * ivr_menu_maps — learned menu navigation per destination (Phase 7). Keyed by a
 * destination pattern + prompt fingerprint; tracks how often a digit reached a
 * human and how fast, so future calls reinforce the best choice.
 */
export const ivrMenuMaps = pgTable(
  "ivr_menu_maps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    destination: text("destination").notNull(), // e.g. area code or full number
    promptFingerprint: text("prompt_fingerprint").notNull(),
    digit: text("digit").notNull(),
    reachedHumanCount: integer("reached_human_count").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    totalTimeToHumanMs: integer("total_time_to_human_ms").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ivr_map_uniq").on(t.destination, t.promptFingerprint, t.digit),
  ],
);
