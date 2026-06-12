import type { AuditLogPort } from '@botplatform/core';
import type { ModerationRuleRow } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { ModerationRepoPort } from './deps.js';

export interface UpsertRuleInput {
  /** When set, updates the existing rule; otherwise creates a new one. */
  id?: string;
  /** Internal guild uuid; omit for a global rule. */
  guildId?: string;
  /** e.g. 'forbidden_words', 'link_filter', 'spam_protection', 'raid_protection'. */
  ruleType: string;
  name: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface RuleService {
  listRules(): Promise<ModerationRuleRow[]>;
  upsertRule(input: UpsertRuleInput): Promise<ModerationRuleRow>;
  setRuleEnabled(id: string, enabled: boolean): Promise<void>;
}

export interface RuleServiceDeps {
  moderation: Pick<ModerationRepoPort, 'listRules' | 'upsertRule' | 'setRuleEnabled'>;
  logger: Logger;
  audit: AuditLogPort;
}

export function createRuleService(deps: RuleServiceDeps): RuleService {
  return {
    listRules() {
      return deps.moderation.listRules();
    },

    async upsertRule(input) {
      const rule = await deps.moderation.upsertRule(input);
      deps.logger.debug({ ruleId: rule.id, ruleType: rule.ruleType }, 'moderation rule upserted');
      // Rule `config` is excluded from audit metadata on purpose (keep entries small).
      await deps.audit.record({
        actorType: 'system',
        action: 'moderation.rule.updated',
        targetType: 'moderation_rule',
        targetId: rule.id,
        metadata: { ruleType: rule.ruleType, name: rule.name, enabled: rule.enabled },
      });
      return rule;
    },

    async setRuleEnabled(id, enabled) {
      await deps.moderation.setRuleEnabled(id, enabled);
      await deps.audit.record({
        actorType: 'system',
        action: 'moderation.rule.updated',
        targetType: 'moderation_rule',
        targetId: id,
        metadata: { enabled },
      });
    },
  };
}
