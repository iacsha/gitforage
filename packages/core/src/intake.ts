// Feedback intake: turn portal Keep/Skip issues into feedback.yml marks.
//
// Issues are written by anyone on GitHub, so this is the most exposed input gitforage
// has. Every rule here fails closed:
//
// - The title must be exactly `keep: owner/name` or `skip: owner/name`. Nothing else
//   in the issue (body, labels, comments) is read, and nothing from it is echoed back.
// - Bots are ignored. Visitors (anyone who is not an owner, member or collaborator of
//   the portal repo) can be turned off, must have an account at least N days old, and
//   can add at most N marks per run and per UTC day.
// - A visitor can only mark a repo the portal has listed (it is looked up in the
//   digests, so no API call is made on a stranger's behalf). Owners can mark any repo.
// - Topics and language come from the digest or the GitHub API, never from the issue.

import type { FeedbackConfig } from "./config.ts";
import type { Digest } from "./digest.ts";
import type { Mark, MarkFrom, MarkKind } from "./feedback.ts";
import { isSafeFullName, isSafeLogin, repoUrl } from "./sanitize.ts";
import { DAY_MS, isoDate } from "./types.ts";

export const FEEDBACK_TITLE_RE = /^(keep|skip): ([A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100})$/;
export const FEEDBACK_LABEL = "gitforage-feedback";
/** Most issues looked at in one run. */
export const MAX_INTAKE_ISSUES = 100;
/** Associations that count as the portal's owners. */
const OWNER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export interface IntakeIssue {
  number: number;
  title: string;
  login: string;
  user_type: string;
  association: string;
  /** The account's creation time, when the input carried it. */
  account_created_at: string | null;
  labels: string[];
}

/** Parse a title. Returns null unless it matches the strict form exactly (no trimming). */
export function parseFeedbackTitle(title: unknown): { mark: MarkKind; repo: string } | null {
  if (typeof title !== "string" || title.length > 150) return null;
  const m = FEEDBACK_TITLE_RE.exec(title);
  if (!m || !isSafeFullName(m[2])) return null;
  return { mark: m[1] as MarkKind, repo: m[2] };
}

/** Issues that look like they were meant as feedback, even if malformed. Others are left alone. */
export function looksLikeFeedback(i: IntakeIssue): boolean {
  return /^\s*(keep|skip)\s*:/i.test(i.title) || i.labels.includes(FEEDBACK_LABEL);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function toIssue(v: any): IntakeIssue | null {
  if (typeof v !== "object" || v === null) return null;
  if (v.pull_request) return null;
  if (v.state !== undefined && v.state !== "open") return null;
  const number = v.number;
  if (!Number.isInteger(number) || number < 1 || number > 1e9) return null;
  const created = str(v.user?.created_at, 40);
  return {
    number,
    title: str(v.title, 300),
    login: str(v.user?.login, 60),
    user_type: str(v.user?.type, 20),
    association: str(v.author_association, 40),
    account_created_at: created && Number.isFinite(Date.parse(created)) ? created : null,
    labels: Array.isArray(v.labels) ? v.labels.slice(0, 50).map((l: any) => str(typeof l === "string" ? l : l?.name, 60)) : [],
  };
}

/**
 * Issues from intake input: an `issues` webhook event ({ issue: {...} }), a list of
 * issues as the REST API returns them, or { issues: [...] }. Pull requests, closed
 * issues and malformed entries are skipped. Sorted by number, capped.
 */
export function issuesFrom(...inputs: unknown[]): IntakeIssue[] {
  const raw: unknown[] = [];
  for (const d of inputs) {
    if (Array.isArray(d)) raw.push(...d.slice(0, MAX_INTAKE_ISSUES));
    else if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      if (Array.isArray(o.issues)) raw.push(...o.issues.slice(0, MAX_INTAKE_ISSUES));
      else if (o.issue) raw.push(o.issue);
    }
  }
  const byNumber = new Map<number, IntakeIssue>();
  for (const r of raw) {
    const i = toIssue(r);
    if (i && !byNumber.has(i.number)) byNumber.set(i.number, i);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number).slice(0, MAX_INTAKE_ISSUES);
}

export interface RepoFacts { full_name: string; topics: string[]; language: string | null }

export interface IntakeOptions {
  feedback: FeedbackConfig;
  now: number;
  /** Marks already in feedback.yml (for the per-day limit and duplicates). */
  existing: Mark[];
  /** The portal's digests: visitors may only mark repos listed here. */
  digests: Digest[];
  /** Look up when a GitHub account was created (ISO time), or null if unknown. */
  accountCreatedAt: (login: string) => Promise<string | null>;
  /** Look up a repo for an owner mark of a repo the portal has not listed. */
  repoFacts: (fullName: string) => Promise<RepoFacts | null>;
}

export type Outcome =
  | { number: number; status: "accepted"; mark: Mark }
  | { number: number; status: "rejected"; reason: string };

export const REASONS = {
  title: "the title is not exactly `keep: owner/name` or `skip: owner/name`",
  user: "the issue's author could not be read",
  bot: "marks from bot accounts are not counted",
  visitors: "this portal only takes marks from its owners and collaborators",
  limit: (n: number) => `the limit of ${n} marks per person per day was reached`,
  ageUnknown: "the account's age could not be checked",
  young: (n: number) => `marks from accounts younger than ${n} days are not counted`,
  notListed: "that repo has not been listed on this portal",
  notFound: "that repo was not found on GitHub",
  duplicate: "you already marked that repo that way",
};

function digestFacts(digests: Digest[], fullName: string): RepoFacts | null {
  const k = fullName.toLowerCase();
  for (const d of digests) {
    for (const it of d.items) {
      if (it.full_name.toLowerCase() === k) return { full_name: it.full_name, topics: it.topics, language: it.language };
    }
  }
  return null;
}

/** Decide every issue. Accepted marks are returned for the caller to append. */
export async function intake(issues: IntakeIssue[], o: IntakeOptions): Promise<Outcome[]> {
  const today = isoDate(o.now);
  const out: Outcome[] = [];
  const all: Mark[] = [...o.existing];
  const reject = (number: number, reason: string) => out.push({ number, status: "rejected", reason });

  for (const i of issues.filter(looksLikeFeedback)) {
    const t = parseFeedbackTitle(i.title);
    if (!t) { reject(i.number, REASONS.title); continue; }
    if (!isSafeLogin(i.login)) { reject(i.number, REASONS.user); continue; }
    if (i.user_type === "Bot" || /\[bot\]$/i.test(i.login)) { reject(i.number, REASONS.bot); continue; }
    const from: MarkFrom = OWNER_ASSOCIATIONS.has(i.association) ? "owner" : "visitor";
    const login = i.login.toLowerCase();
    const mine = all.filter((m) => (m.by ?? "").toLowerCase() === login);

    if (from === "visitor") {
      if (!o.feedback.visitors) { reject(i.number, REASONS.visitors); continue; }
      if (mine.filter((m) => m.date === today).length >= o.feedback.max_per_user) {
        reject(i.number, REASONS.limit(o.feedback.max_per_user));
        continue;
      }
      if (o.feedback.min_account_age_days > 0) {
        const created = i.account_created_at ?? (await o.accountCreatedAt(i.login).catch(() => null));
        const at = created ? Date.parse(created) : NaN;
        if (!Number.isFinite(at)) { reject(i.number, REASONS.ageUnknown); continue; }
        if (o.now - at < o.feedback.min_account_age_days * DAY_MS) {
          reject(i.number, REASONS.young(o.feedback.min_account_age_days));
          continue;
        }
      }
    }

    let facts = digestFacts(o.digests, t.repo);
    if (!facts && from === "owner") {
      const f = await o.repoFacts(t.repo).catch(() => null);
      facts = f && isSafeFullName(f.full_name) && f.full_name.toLowerCase() === t.repo.toLowerCase() ? f : null;
      if (!facts) { reject(i.number, REASONS.notFound); continue; }
    }
    if (!facts) { reject(i.number, REASONS.notListed); continue; }

    const prev = mine.filter((m) => m.repo.toLowerCase() === facts!.full_name.toLowerCase()).at(-1);
    if (prev?.mark === t.mark) { reject(i.number, REASONS.duplicate); continue; }

    const mark: Mark = {
      repo: facts.full_name, mark: t.mark, date: today, topics: facts.topics.slice(0, 30), language: facts.language, from, by: i.login,
    };
    all.push(mark);
    out.push({ number: i.number, status: "accepted", mark });
  }
  return out;
}

/**
 * The comment posted on an issue. Built only from fixed text and validated names; the
 * issue's own title and body are never echoed.
 */
export function replyFor(o: Outcome): string {
  const close = "This issue closes automatically.";
  if (o.status === "accepted") {
    const url = repoUrl(o.mark.repo)!;
    const who = o.mark.from === "owner" ? "an owner mark" : "a visitor mark";
    return `Recorded **${o.mark.mark}** for [${o.mark.repo}](${url}) as ${who}. Thanks! It counts from the next run. ${close}\n`;
  }
  return `Not recorded: ${o.reason}. Feedback issues need the title \`keep: owner/name\` or \`skip: owner/name\` for a repo listed on this portal. ${close}\n`;
}
