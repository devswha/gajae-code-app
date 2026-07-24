type GjcPresetRole = 'default' | 'planner' | 'executor' | 'architect' | 'critic';

export type GjcBuiltinModelProfile = {
  name: string;
  label: string;
  group: string;
  roles: Partial<Record<GjcPresetRole, string>>;
};

/**
 * GJC 0.11.8 built-in model profiles.
 *
 * The upstream runtime module currently imports Bun-only utilities, so the
 * Node sidecar cannot load it directly. This catalog is generated from the
 * exact @gajae-code/coding-agent dependency used by the app; `label` and
 * `group` are app-authored display strings the SDK does not carry.
 */
export const GJC_BUILTIN_MODEL_PROFILES: readonly GjcBuiltinModelProfile[] = [
  {
    "name": "codex-eco",
    "label": "Codex Eco",
    "group": "CODEX",
    "roles": {
      "default": "openai-codex/gpt-5.6-terra:low",
      "executor": "openai-codex/gpt-5.6-luna:low",
      "planner": "openai-codex/gpt-5.6-luna:high",
      "critic": "openai-codex/gpt-5.6-terra:xhigh",
      "architect": "openai-codex/gpt-5.6-terra:high"
    }
  },
  {
    "name": "codex-medium",
    "label": "Codex Medium",
    "group": "CODEX",
    "roles": {
      "default": "openai-codex/gpt-5.6-sol:low",
      "executor": "openai-codex/gpt-5.6-terra:low",
      "planner": "openai-codex/gpt-5.6-terra:high",
      "critic": "openai-codex/gpt-5.6-sol:xhigh",
      "architect": "openai-codex/gpt-5.6-sol:high"
    }
  },
  {
    "name": "codex-pro",
    "label": "Codex Pro",
    "group": "CODEX",
    "roles": {
      "default": "openai-codex/gpt-5.6-sol:medium",
      "executor": "openai-codex/gpt-5.6-terra:medium",
      "planner": "openai-codex/gpt-5.6-sol:high",
      "critic": "openai-codex/gpt-5.6-sol:max",
      "architect": "openai-codex/gpt-5.6-sol:xhigh"
    }
  },
  {
    "name": "opencodego",
    "label": "OpenCodeGo",
    "group": "OPENCODEGO",
    "roles": {
      "default": "opencode-go/kimi-k2.6",
      "executor": "opencode-go/deepseek-v4-flash",
      "planner": "opencode-go/qwen3.7-max",
      "critic": "opencode-go/mimo-v2.5-pro",
      "architect": "opencode-go/deepseek-v4-pro"
    }
  },
  {
    "name": "claude-opus",
    "label": "Claude Opus",
    "group": "CLAUDE",
    "roles": {
      "default": "anthropic/claude-opus-4-8:xhigh",
      "executor": "anthropic/claude-sonnet-5",
      "planner": "anthropic/claude-opus-4-8:low",
      "critic": "anthropic/claude-opus-4-8:high",
      "architect": "anthropic/claude-opus-4-8:xhigh"
    }
  },
  {
    "name": "claude-fable",
    "label": "Claude Fable",
    "group": "CLAUDE",
    "roles": {
      "default": "anthropic/claude-fable-5:xhigh",
      "executor": "anthropic/claude-sonnet-5",
      "planner": "anthropic/claude-fable-5:low",
      "critic": "anthropic/claude-fable-5:high",
      "architect": "anthropic/claude-fable-5:xhigh"
    }
  },
  {
    "name": "glm-eco",
    "label": "GLM Eco",
    "group": "GLM",
    "roles": {
      "default": "zai/glm-5.2:low",
      "executor": "zai/glm-5.2:minimal",
      "planner": "zai/glm-5.2:low",
      "critic": "zai/glm-5.2:medium",
      "architect": "zai/glm-5.2:high"
    }
  },
  {
    "name": "glm-medium",
    "label": "GLM Medium",
    "group": "GLM",
    "roles": {
      "default": "zai/glm-5.2:medium",
      "executor": "zai/glm-5.2:low",
      "planner": "zai/glm-5.2:medium",
      "critic": "zai/glm-5.2:high",
      "architect": "zai/glm-5.2:xhigh"
    }
  },
  {
    "name": "glm-pro",
    "label": "GLM Pro",
    "group": "GLM",
    "roles": {
      "default": "zai/glm-5.2:xhigh",
      "executor": "zai/glm-5.2:medium",
      "planner": "zai/glm-5.2:high",
      "critic": "zai/glm-5.2:xhigh",
      "architect": "zai/glm-5.2:xhigh"
    }
  },
  {
    "name": "kimi-coding-plan-eco",
    "label": "Kimi Coding Plan Eco",
    "group": "KIMI CODING PLAN",
    "roles": {
      "default": "kimi-code/k3:low",
      "executor": "kimi-code/k3:low",
      "planner": "kimi-code/k3:low",
      "critic": "kimi-code/k3:high",
      "architect": "kimi-code/k3:high"
    }
  },
  {
    "name": "kimi-coding-plan-medium",
    "label": "Kimi Coding Plan Medium",
    "group": "KIMI CODING PLAN",
    "roles": {
      "default": "kimi-code/k3:high",
      "executor": "kimi-code/k3:low",
      "planner": "kimi-code/k3:high",
      "critic": "kimi-code/k3:high",
      "architect": "kimi-code/k3:max"
    }
  },
  {
    "name": "kimi-coding-plan-pro",
    "label": "Kimi Coding Plan Pro",
    "group": "KIMI CODING PLAN",
    "roles": {
      "default": "kimi-code/k3:max",
      "executor": "kimi-code/k3:high",
      "planner": "kimi-code/k3:high",
      "critic": "kimi-code/k3:max",
      "architect": "kimi-code/k3:max"
    }
  },
  {
    "name": "mimo-eco",
    "label": "Mimo Eco",
    "group": "MIMO",
    "roles": {
      "default": "xiaomi/mimo-v2.5-pro:low",
      "executor": "xiaomi/mimo-v2.5-pro:minimal",
      "planner": "xiaomi/mimo-v2.5-pro:low",
      "critic": "xiaomi/mimo-v2.5-pro:medium",
      "architect": "xiaomi/mimo-v2.5-pro:high"
    }
  },
  {
    "name": "mimo-medium",
    "label": "Mimo Medium",
    "group": "MIMO",
    "roles": {
      "default": "xiaomi/mimo-v2.5-pro:medium",
      "executor": "xiaomi/mimo-v2.5-pro:low",
      "planner": "xiaomi/mimo-v2.5-pro:medium",
      "critic": "xiaomi/mimo-v2.5-pro:high",
      "architect": "xiaomi/mimo-v2.5-pro:xhigh"
    }
  },
  {
    "name": "mimo-pro",
    "label": "Mimo Pro",
    "group": "MIMO",
    "roles": {
      "default": "xiaomi/mimo-v2.5-pro:xhigh",
      "executor": "xiaomi/mimo-v2.5-pro:medium",
      "planner": "xiaomi/mimo-v2.5-pro:high",
      "critic": "xiaomi/mimo-v2.5-pro:xhigh",
      "architect": "xiaomi/mimo-v2.5-pro:xhigh"
    }
  },
  {
    "name": "grok-eco",
    "label": "Grok Eco",
    "group": "GROK",
    "roles": {
      "default": "xai/grok-4.3:low",
      "executor": "xai/grok-4.3:minimal",
      "planner": "xai/grok-4.3:low",
      "critic": "xai/grok-4.3:medium",
      "architect": "xai/grok-4.3:high"
    }
  },
  {
    "name": "grok-medium",
    "label": "Grok Medium",
    "group": "GROK",
    "roles": {
      "default": "xai/grok-4.3:medium",
      "executor": "xai/grok-4.3:low",
      "planner": "xai/grok-4.3:medium",
      "critic": "xai/grok-4.3:high",
      "architect": "xai/grok-4.3:xhigh"
    }
  },
  {
    "name": "grok-pro",
    "label": "Grok Pro",
    "group": "GROK",
    "roles": {
      "default": "xai/grok-4.3:xhigh",
      "executor": "xai/grok-4.3:medium",
      "planner": "xai/grok-4.3:high",
      "critic": "xai/grok-4.3:xhigh",
      "architect": "xai/grok-4.3:xhigh"
    }
  },
  {
    "name": "grok-build-pro",
    "label": "Grok Build Pro",
    "group": "GROK",
    "roles": {
      "default": "grok-build/grok-composer-2.5-fast",
      "executor": "grok-build/grok-build",
      "planner": "grok-build/grok-composer-2.5-fast",
      "critic": "grok-build/grok-composer-2.5-fast",
      "architect": "grok-build/grok-build"
    }
  },
  {
    "name": "cursor-eco",
    "label": "Cursor Eco",
    "group": "CURSOR",
    "roles": {
      "default": "cursor/composer-1.5:low",
      "executor": "cursor/composer-1.5:minimal",
      "planner": "cursor/composer-1.5:low",
      "critic": "cursor/composer-1.5:medium",
      "architect": "cursor/composer-1.5:high"
    }
  },
  {
    "name": "cursor-medium",
    "label": "Cursor Medium",
    "group": "CURSOR",
    "roles": {
      "default": "cursor/composer-1.5:medium",
      "executor": "cursor/composer-1.5:low",
      "planner": "cursor/composer-1.5:medium",
      "critic": "cursor/composer-1.5:high",
      "architect": "cursor/composer-1.5:xhigh"
    }
  },
  {
    "name": "cursor-pro",
    "label": "Cursor Pro",
    "group": "CURSOR",
    "roles": {
      "default": "cursor/composer-1.5:xhigh",
      "executor": "cursor/composer-1.5:medium",
      "planner": "cursor/composer-1.5:high",
      "critic": "cursor/composer-1.5:xhigh",
      "architect": "cursor/composer-1.5:xhigh"
    }
  },
  {
    "name": "minimax-eco",
    "label": "MiniMax Eco",
    "group": "MINIMAX",
    "roles": {
      "default": "minimax-code/minimax-m3:low",
      "executor": "minimax-code/minimax-m3:minimal",
      "planner": "minimax-code/minimax-m3:low",
      "critic": "minimax-code/minimax-m3:medium",
      "architect": "minimax-code/minimax-m3:high"
    }
  },
  {
    "name": "minimax-medium",
    "label": "MiniMax Medium",
    "group": "MINIMAX",
    "roles": {
      "default": "minimax-code/minimax-m3:medium",
      "executor": "minimax-code/minimax-m3:low",
      "planner": "minimax-code/minimax-m3:medium",
      "critic": "minimax-code/minimax-m3:high",
      "architect": "minimax-code/minimax-m3:xhigh"
    }
  },
  {
    "name": "minimax-pro",
    "label": "MiniMax Pro",
    "group": "MINIMAX",
    "roles": {
      "default": "minimax-code/minimax-m3:xhigh",
      "executor": "minimax-code/minimax-m3:medium",
      "planner": "minimax-code/minimax-m3:high",
      "critic": "minimax-code/minimax-m3:xhigh",
      "architect": "minimax-code/minimax-m3:xhigh"
    }
  },
  {
    "name": "alibaba-token-plan-balanced",
    "label": "Alibaba Token Plan Balanced",
    "group": "ALIBABA TOKEN PLAN",
    "roles": {
      "default": "alibaba-token-plan/qwen3.8-max-preview:medium",
      "executor": "alibaba-token-plan/deepseek-v4-pro:xhigh",
      "planner": "alibaba-token-plan/glm-5.2:high",
      "critic": "alibaba-token-plan/glm-5.2:high",
      "architect": "alibaba-token-plan/qwen3.8-max-preview:xhigh"
    }
  },
  {
    "name": "alibaba-token-plan-qwenmaxxing",
    "label": "Alibaba Token Plan Qwenmaxxing",
    "group": "ALIBABA TOKEN PLAN",
    "roles": {
      "default": "alibaba-token-plan/qwen3.8-max-preview:medium",
      "executor": "alibaba-token-plan/qwen3.8-max-preview:low",
      "planner": "alibaba-token-plan/qwen3.8-max-preview:medium",
      "critic": "alibaba-token-plan/qwen3.8-max-preview:xhigh",
      "architect": "alibaba-token-plan/qwen3.8-max-preview:xhigh"
    }
  },
  {
    "name": "opus-codex",
    "label": "Opus + Codex",
    "group": "COMBOS",
    "roles": {
      "default": "anthropic/claude-opus-4-8:xhigh",
      "executor": "openai-codex/gpt-5.6-terra:low",
      "planner": "anthropic/claude-sonnet-5",
      "critic": "openai-codex/gpt-5.6-sol:xhigh",
      "architect": "openai-codex/gpt-5.6-sol:high"
    }
  },
  {
    "name": "codex-opencodego",
    "label": "Codex + OpenCodeGo",
    "group": "COMBOS",
    "roles": {
      "default": "openai-codex/gpt-5.6-sol:low",
      "executor": "opencode-go/deepseek-v4-pro",
      "planner": "opencode-go/kimi-k2.6",
      "critic": "opencode-go/mimo-v2.5-pro",
      "architect": "openai-codex/gpt-5.6-sol:high"
    }
  },
  {
    "name": "fable-opus-codex",
    "label": "Fable + Opus + Codex",
    "group": "COMBOS",
    "roles": {
      "default": "anthropic/claude-fable-5:high",
      "executor": "openai-codex/gpt-5.6-terra:medium",
      "planner": "anthropic/claude-opus-4-8:medium",
      "critic": "anthropic/claude-opus-4-8:high",
      "architect": "openai-codex/gpt-5.6-sol:xhigh"
    }
  }
];
