import type { ModerationServiceDeps } from './deps.js';
import type { ModerationActionService } from './action-service.js';
import { createModerationActionService } from './action-service.js';
import type { PermissionService } from './permission-service.js';
import { createPermissionService } from './permission-service.js';
import type { RuleService } from './rule-service.js';
import { createRuleService } from './rule-service.js';
import type { WarningService } from './warning-service.js';
import { createWarningService } from './warning-service.js';

export interface ModerationServices {
  warnings: WarningService;
  actions: ModerationActionService;
  rules: RuleService;
  permissions: PermissionService;
}

export function createModerationServices(deps: ModerationServiceDeps): ModerationServices {
  return {
    warnings: createWarningService(deps),
    actions: createModerationActionService(deps),
    rules: createRuleService(deps),
    permissions: createPermissionService(deps),
  };
}
