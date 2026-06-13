/**
 * Pure auto-moderation rule matching. No I/O, no Discord — given a message
 * and a rule, decide whether the message violates it. Fully unit-testable.
 */

export type AutomodRuleType =
  | 'banned_words'
  | 'spam'
  | 'repeated_messages'
  | 'mention_spam'
  | 'caps'
  | 'invite_links'
  | 'suspicious_links'
  | 'attachments'
  | 'new_account'
  | 'raid';

export interface RuleConfig {
  words?: string[];
  mentionThreshold?: number;
  /** Minimum length before the caps ratio is checked. */
  capsMinLength?: number;
  /** 0..1 uppercase ratio that triggers the rule. */
  capsRatio?: number;
  /** Domains allowed for suspicious_links (others trigger). */
  allowedDomains?: string[];
  /** new_account: minimum account age in days. */
  minAccountAgeDays?: number;
}

export interface MessageInfo {
  content: string;
  mentionCount: number;
  hasAttachments: boolean;
  /** Account age in days, when the adapter exposes it. */
  accountAgeDays?: number | undefined;
}

export interface MatchResult {
  violated: boolean;
  reason?: string;
}

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite|discord\.gg)\/\S+/i;
const URL_RE = /\bhttps?:\/\/([^\s/]+)/gi;

const NO_MATCH: MatchResult = { violated: false };

/** Evaluate a single rule against a message. */
export function matchesRule(ruleType: AutomodRuleType, config: RuleConfig, message: MessageInfo): MatchResult {
  switch (ruleType) {
    case 'banned_words': {
      const words = (config.words ?? []).map((w) => w.toLowerCase()).filter(Boolean);
      const text = message.content.toLowerCase();
      const hit = words.find((w) => text.includes(w));
      return hit ? { violated: true, reason: 'banned word' } : NO_MATCH;
    }
    case 'mention_spam': {
      const threshold = config.mentionThreshold ?? 5;
      return message.mentionCount > threshold
        ? { violated: true, reason: `too many mentions (${message.mentionCount})` }
        : NO_MATCH;
    }
    case 'caps': {
      const minLength = config.capsMinLength ?? 10;
      const ratio = config.capsRatio ?? 0.7;
      const letters = message.content.replace(/[^a-zA-Z]/g, '');
      if (letters.length < minLength) return NO_MATCH;
      const upper = letters.replace(/[^A-Z]/g, '').length;
      return upper / letters.length >= ratio ? { violated: true, reason: 'excessive caps' } : NO_MATCH;
    }
    case 'invite_links':
      return INVITE_RE.test(message.content) ? { violated: true, reason: 'invite link' } : NO_MATCH;
    case 'suspicious_links': {
      const allowed = (config.allowedDomains ?? []).map((d) => d.toLowerCase());
      const hosts = [...message.content.matchAll(URL_RE)].map((m) => m[1]!.toLowerCase());
      const bad = hosts.find((host) => !allowed.some((d) => host === d || host.endsWith(`.${d}`)));
      return bad ? { violated: true, reason: `link to ${bad}` } : NO_MATCH;
    }
    case 'attachments':
      return message.hasAttachments ? { violated: true, reason: 'attachment not allowed' } : NO_MATCH;
    case 'new_account': {
      const minDays = config.minAccountAgeDays ?? 7;
      if (message.accountAgeDays === undefined) return NO_MATCH;
      return message.accountAgeDays < minDays
        ? { violated: true, reason: `account younger than ${minDays} days` }
        : NO_MATCH;
    }
    case 'spam':
    case 'repeated_messages':
    case 'raid':
      // Stateful rules are evaluated by the service (needs message history).
      return NO_MATCH;
    default:
      return NO_MATCH;
  }
}

/**
 * Stateful spam check: how many messages a user sent in the timeframe.
 * The service maintains the counts; this just compares to the threshold.
 */
export function isSpam(messageCountInWindow: number, threshold: number): boolean {
  return messageCountInWindow > threshold;
}
