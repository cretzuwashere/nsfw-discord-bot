import type { AuditEntry } from '@botplatform/core';
import type { ModerationRuleRow } from '@botplatform/database';
import { createSilentLogger } from '@botplatform/logger';
import { describe, expect, it, vi } from 'vitest';
import { createRuleService } from './rule-service.js';

const now = new Date();

const ruleRow: ModerationRuleRow = {
  id: 'rule-uuid',
  guildId: null,
  ruleType: 'forbidden_words',
  name: 'Forbidden words',
  config: { words: ['spam'] },
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

function makeDeps() {
  const auditEntries: AuditEntry[] = [];
  return {
    moderation: {
      listRules: vi.fn(async () => [ruleRow]),
      upsertRule: vi.fn(async () => ruleRow),
      setRuleEnabled: vi.fn(async () => {}),
    },
    logger: createSilentLogger(),
    audit: {
      record: vi.fn(async (entry: AuditEntry) => {
        auditEntries.push(entry);
      }),
    },
    auditEntries,
  };
}

describe('RuleService', () => {
  it('lists rules through the repo', async () => {
    const deps = makeDeps();
    const service = createRuleService(deps);

    await expect(service.listRules()).resolves.toEqual([ruleRow]);
    expect(deps.moderation.listRules).toHaveBeenCalledOnce();
  });

  it('upserts a rule and audits the change', async () => {
    const deps = makeDeps();
    const service = createRuleService(deps);

    const result = await service.upsertRule({
      ruleType: 'forbidden_words',
      name: 'Forbidden words',
      config: { words: ['spam'] },
      enabled: true,
    });

    expect(result).toBe(ruleRow);
    expect(deps.moderation.upsertRule).toHaveBeenCalledWith({
      ruleType: 'forbidden_words',
      name: 'Forbidden words',
      config: { words: ['spam'] },
      enabled: true,
    });
    expect(deps.auditEntries[0]?.action).toBe('moderation.rule.updated');
    expect(deps.auditEntries[0]?.targetId).toBe('rule-uuid');
    expect(deps.auditEntries[0]?.metadata).toMatchObject({
      ruleType: 'forbidden_words',
      enabled: true,
    });
  });

  it('audits rule enable/disable toggles', async () => {
    const deps = makeDeps();
    const service = createRuleService(deps);

    await service.setRuleEnabled('rule-uuid', false);

    expect(deps.moderation.setRuleEnabled).toHaveBeenCalledWith('rule-uuid', false);
    expect(deps.auditEntries).toHaveLength(1);
    expect(deps.auditEntries[0]?.action).toBe('moderation.rule.updated');
    expect(deps.auditEntries[0]?.metadata).toEqual({ enabled: false });
  });
});
