type GjcPresetRole = 'default' | 'planner' | 'executor' | 'architect' | 'critic';

export type GjcBuiltinModelProfile = {
  name: string;
  label: string;
  group: string;
  roles: Partial<Record<GjcPresetRole, string>>;
};

/**
 * Built-in model profiles of the pinned @gajae-code/coding-agent (0.17.6).
 *
 * The upstream runtime module imports Bun-only utilities, so the Node sidecar
 * cannot load it directly and keeps this copy. Names, order and roles mirror
 * the SDK's BUILTIN_MODEL_PROFILES; each role holds the first selector of the
 * SDK's fallback chain, which is the model the preset runs when available.
 * label and group are app-authored display strings the SDK does not carry.
 * server/builtin-model-profiles-contract.bun.test.ts fails when an SDK bump moves
 * the SDK away from this copy.
 */
export const GJC_BUILTIN_MODEL_PROFILES: readonly GjcBuiltinModelProfile[] = [
  {
      "name": "codex-eco",
      "label": "Codex Eco",
      "group": "CODEX",
      "roles": {
          "default": "openai-codex/gpt-5.6-terra:low",
          "planner": "openai-codex/gpt-5.6-luna:high",
          "executor": "openai-codex/gpt-5.6-luna:low",
          "architect": "openai-codex/gpt-5.6-terra:high",
          "critic": "openai-codex/gpt-5.6-terra:xhigh"
      }
  },
  {
      "name": "codex-medium",
      "label": "Codex Medium",
      "group": "CODEX",
      "roles": {
          "default": "openai-codex/gpt-5.6-sol:low",
          "planner": "openai-codex/gpt-5.6-terra:high",
          "executor": "openai-codex/gpt-5.6-terra:low",
          "architect": "openai-codex/gpt-5.6-sol:high",
          "critic": "openai-codex/gpt-5.6-sol:xhigh"
      }
  },
  {
      "name": "codex-pro",
      "label": "Codex Pro",
      "group": "CODEX",
      "roles": {
          "default": "openai-codex/gpt-5.6-sol:medium",
          "planner": "openai-codex/gpt-5.6-sol:high",
          "executor": "openai-codex/gpt-5.6-terra:medium",
          "architect": "openai-codex/gpt-5.6-sol:xhigh",
          "critic": "openai-codex/gpt-5.6-sol:max"
      }
  },
  {
      "name": "lunamaxxing",
      "label": "Lunamaxxing",
      "group": "CODEX",
      "roles": {
          "default": "openai-codex/gpt-5.6-luna:medium",
          "planner": "openai-codex/gpt-5.6-luna:max",
          "executor": "openai-codex/gpt-5.6-luna:xhigh",
          "architect": "openai-codex/gpt-5.6-luna:max",
          "critic": "openai-codex/gpt-5.6-luna:max"
      }
  },
  {
      "name": "astra-lite",
      "label": "Astra Lite",
      "group": "CODEX",
      "roles": {
          "default": "openai-codex/gpt-6-astra:medium",
          "planner": "openai-codex/gpt-6-astra:xhigh",
          "executor": "openai-codex/gpt-5.6-luna:xhigh",
          "architect": "openai-codex/gpt-5.6-terra:xhigh",
          "critic": "openai-codex/gpt-5.6-sol:high"
      }
  },
  {
      "name": "astra-default",
      "label": "Astra Default",
      "group": "CODEX",
      "roles": {
          "default": "openai-codex/gpt-6-astra:medium",
          "planner": "openai-codex/gpt-6-astra:xhigh",
          "executor": "openai-codex/gpt-5.6-luna:max",
          "architect": "openai-codex/gpt-5.6-terra:xhigh",
          "critic": "openai-codex/gpt-5.6-sol:xhigh"
      }
  },
  {
      "name": "astra-heavy",
      "label": "Astra Heavy",
      "group": "CODEX",
      "roles": {
          "default": "openai-codex/gpt-6-astra:medium",
          "planner": "openai-codex/gpt-5.6-sol:max",
          "executor": "openai-codex/gpt-5.6-sol:max",
          "architect": "openai-codex/gpt-6-astra:max",
          "critic": "openai-codex/gpt-6-astra:max"
      }
  },
  {
      "name": "macos-omlx-fast",
      "label": "macOS oMLX Fast",
      "group": "OMLX",
      "roles": {
          "default": "omlx/Qwen3.6-35B-A3B-4bit:low",
          "planner": "omlx/Qwen3.6-35B-A3B-4bit:medium",
          "executor": "omlx/Qwen3.6-35B-A3B-4bit:low",
          "architect": "omlx/Qwen3.6-35B-A3B-4bit:high",
          "critic": "omlx/Qwen3.6-35B-A3B-4bit:high"
      }
  },
  {
      "name": "macos-omlx-balanced",
      "label": "macOS oMLX Balanced",
      "group": "OMLX",
      "roles": {
          "default": "omlx/Qwen3.6-35B-A3B-8bit:low",
          "planner": "omlx/Qwen3.6-35B-A3B-8bit:medium",
          "executor": "omlx/Qwen3.6-35B-A3B-8bit:low",
          "architect": "omlx/Qwen3.6-35B-A3B-8bit:high",
          "critic": "omlx/Qwen3.6-35B-A3B-8bit:high"
      }
  },
  {
      "name": "macos-omlx-quality",
      "label": "macOS oMLX Quality",
      "group": "OMLX",
      "roles": {
          "default": "omlx/Qwen3.6-35B-A3B-8bit:low",
          "planner": "omlx/Qwen3.6-35B-A3B-8bit:medium",
          "executor": "omlx/Qwen3.6-35B-A3B-8bit:low",
          "architect": "omlx/Qwen3.6-35B-A3B-8bit:high",
          "critic": "omlx/Qwen3.8-27B-8bit:high"
      }
  },
  {
      "name": "macos-omlx-abliterated-fast",
      "label": "macOS oMLX Abliterated Fast",
      "group": "OMLX",
      "roles": {
          "default": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:low",
          "planner": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:medium",
          "executor": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:low",
          "architect": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:high",
          "critic": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:high"
      }
  },
  {
      "name": "macos-omlx-abliterated-balanced",
      "label": "macOS oMLX Abliterated Balanced",
      "group": "OMLX",
      "roles": {
          "default": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:low",
          "planner": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:medium",
          "executor": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:low",
          "architect": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:high",
          "critic": "omlx/Qwen3.8-27B-Uncensored-MLX-4bit:high"
      }
  },
  {
      "name": "opencodego",
      "label": "OpenCodeGo",
      "group": "OPENCODEGO",
      "roles": {
          "default": "opencode-go/kimi-k3",
          "planner": "opencode-go/kimi-k3",
          "executor": "opencode-go/deepseek-v4-flash",
          "architect": "opencode-go/deepseek-v4-pro",
          "critic": "opencode-go/mimo-v2.5-pro"
      }
  },
  {
      "name": "commandcode-goat",
      "label": "Command Code GOAT",
      "group": "COMMAND CODE",
      "roles": {
          "default": "commandcode-goat/zai-org/GLM-5.3",
          "planner": "commandcode-goat/moonshotai/Kimi-K3",
          "executor": "commandcode-goat/deepseek/deepseek-v4-flash",
          "architect": "commandcode-goat/deepseek/deepseek-v4-pro",
          "critic": "commandcode-goat/zai-org/GLM-5.2"
      }
  },
  {
      "name": "open-weights-glm",
      "label": "Open Weights GLM",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "glm-5.2:medium",
          "planner": "glm-5.2:high",
          "executor": "glm-5.2:low",
          "architect": "glm-5.2:xhigh",
          "critic": "glm-5.2:high"
      }
  },
  {
      "name": "open-weights-deepseek",
      "label": "Open Weights DeepSeek",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "deepseek-v4-flash:high",
          "planner": "deepseek-v4-flash:high",
          "executor": "deepseek-v4-flash:medium",
          "architect": "deepseek-v4-flash:xhigh",
          "critic": "deepseek-v4-flash:xhigh"
      }
  },
  {
      "name": "open-weights-kimi",
      "label": "Open Weights Kimi",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "kimi-k3:high",
          "planner": "kimi-k3:xhigh",
          "executor": "kimi-k3:high",
          "architect": "kimi-k3:xhigh",
          "critic": "kimi-k3:high"
      }
  },
  {
      "name": "open-weights-luna",
      "label": "Open Weights Luna",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "gpt-5.6-luna:high",
          "planner": "gpt-5.6-luna:xhigh",
          "executor": "gpt-5.6-luna:high",
          "architect": "gpt-5.6-luna:xhigh",
          "critic": "gpt-5.6-luna:xhigh"
      }
  },
  {
      "name": "open-weights-spark",
      "label": "Open Weights Spark",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "muse-spark-1.2:medium",
          "planner": "muse-spark-1.2:high",
          "executor": "muse-spark-1.2:low",
          "architect": "muse-spark-1.2:xhigh",
          "critic": "muse-spark-1.2:high"
      }
  },
  {
      "name": "open-weights-spark-deepseek",
      "label": "Open Weights Spark + DeepSeek",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "muse-spark-1.2:medium",
          "planner": "muse-spark-1.2:high",
          "executor": "deepseek-v4-flash:high",
          "architect": "muse-spark-1.2:xhigh",
          "critic": "muse-spark-1.2:high"
      }
  },
  {
      "name": "open-weights-spark-luna",
      "label": "Open Weights Spark + Luna",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "muse-spark-1.2:medium",
          "planner": "muse-spark-1.2:high",
          "executor": "gpt-5.6-luna:high",
          "architect": "muse-spark-1.2:xhigh",
          "critic": "muse-spark-1.2:high"
      }
  },
  {
      "name": "open-weights-glm-deepseek",
      "label": "Open Weights GLM + DeepSeek",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "glm-5.2:medium",
          "planner": "glm-5.2:high",
          "executor": "deepseek-v4-flash:high",
          "architect": "glm-5.2:xhigh",
          "critic": "deepseek-v4-flash:xhigh"
      }
  },
  {
      "name": "open-weights-kimi-deepseek",
      "label": "Open Weights Kimi + DeepSeek",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "kimi-k3:high",
          "planner": "kimi-k3:xhigh",
          "executor": "deepseek-v4-flash:high",
          "architect": "kimi-k3:xhigh",
          "critic": "deepseek-v4-flash:xhigh"
      }
  },
  {
      "name": "open-weights-kimi-glm",
      "label": "Open Weights Kimi + GLM",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "glm-5.2:high",
          "planner": "kimi-k3:high",
          "executor": "glm-5.2:high",
          "architect": "kimi-k3:xhigh",
          "critic": "glm-5.2:xhigh"
      }
  },
  {
      "name": "open-weights-kimi-glm-deepseek",
      "label": "Open Weights Kimi + GLM + DeepSeek",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "glm-5.2:medium",
          "planner": "kimi-k3:high",
          "executor": "deepseek-v4-flash:high",
          "architect": "kimi-k3:xhigh",
          "critic": "glm-5.2:high"
      }
  },
  {
      "name": "open-weights-all",
      "label": "Open Weights All",
      "group": "OPEN WEIGHTS",
      "roles": {
          "default": "gpt-5.6-luna:high",
          "planner": "kimi-k3:high",
          "executor": "deepseek-v4-flash:high",
          "architect": "gpt-5.6-luna:xhigh",
          "critic": "glm-5.2:high"
      }
  },
  {
      "name": "claude-opus",
      "label": "Claude Opus",
      "group": "CLAUDE",
      "roles": {
          "default": "anthropic/claude-opus-5:xhigh",
          "planner": "anthropic/claude-opus-5:low",
          "executor": "anthropic/claude-sonnet-5",
          "architect": "anthropic/claude-opus-5:xhigh",
          "critic": "anthropic/claude-opus-5:high"
      }
  },
  {
      "name": "claude-fable",
      "label": "Claude Fable",
      "group": "CLAUDE",
      "roles": {
          "default": "anthropic/claude-fable-5-1:xhigh",
          "planner": "anthropic/claude-fable-5-1:low",
          "executor": "anthropic/claude-sonnet-5",
          "architect": "anthropic/claude-fable-5-1:xhigh",
          "critic": "anthropic/claude-fable-5-1:high"
      }
  },
  {
      "name": "glm-eco",
      "label": "GLM Eco",
      "group": "GLM",
      "roles": {
          "default": "zai/glm-5.3-flash:low",
          "planner": "zai/glm-5.3-flash:low",
          "executor": "zai/glm-5.3-flash:low",
          "architect": "zai/glm-5.3:high",
          "critic": "zai/glm-5.3:high"
      }
  },
  {
      "name": "glm-medium",
      "label": "GLM Medium",
      "group": "GLM",
      "roles": {
          "default": "zai/glm-5.3:high",
          "planner": "zai/glm-5.3:high",
          "executor": "zai/glm-5.3-flash:low",
          "architect": "zai/glm-5.3:max",
          "critic": "zai/glm-5.3:high"
      }
  },
  {
      "name": "glm-pro",
      "label": "GLM Pro",
      "group": "GLM",
      "roles": {
          "default": "zai/glm-5.3:max",
          "planner": "zai/glm-5.3:high",
          "executor": "zai/glm-5.3-flash:high",
          "architect": "zai/glm-5.3:max",
          "critic": "zai/glm-5.3:max"
      }
  },
  {
      "name": "kimi-coding-plan-eco",
      "label": "Kimi Coding Plan Eco",
      "group": "KIMI CODING PLAN",
      "roles": {
          "default": "kimi-code/k3:low",
          "planner": "kimi-code/k3:low",
          "executor": "kimi-code/k3:low",
          "architect": "kimi-code/k3:high",
          "critic": "kimi-code/k3:high"
      }
  },
  {
      "name": "kimi-coding-plan-medium",
      "label": "Kimi Coding Plan Medium",
      "group": "KIMI CODING PLAN",
      "roles": {
          "default": "kimi-code/k3:high",
          "planner": "kimi-code/k3:high",
          "executor": "kimi-code/k3:low",
          "architect": "kimi-code/k3:max",
          "critic": "kimi-code/k3:high"
      }
  },
  {
      "name": "kimi-coding-plan-pro",
      "label": "Kimi Coding Plan Pro",
      "group": "KIMI CODING PLAN",
      "roles": {
          "default": "kimi-code/k3:max",
          "planner": "kimi-code/k3:high",
          "executor": "kimi-code/k3:high",
          "architect": "kimi-code/k3:max",
          "critic": "kimi-code/k3:max"
      }
  },
  {
      "name": "mimo-eco",
      "label": "Mimo Eco",
      "group": "MIMO",
      "roles": {
          "default": "xiaomi/mimo-v2.5-pro:low",
          "planner": "xiaomi/mimo-v2.5-pro:low",
          "executor": "xiaomi/mimo-v2.5-pro:minimal",
          "architect": "xiaomi/mimo-v2.5-pro:high",
          "critic": "xiaomi/mimo-v2.5-pro:medium"
      }
  },
  {
      "name": "mimo-medium",
      "label": "Mimo Medium",
      "group": "MIMO",
      "roles": {
          "default": "xiaomi/mimo-v2.5-pro:medium",
          "planner": "xiaomi/mimo-v2.5-pro:medium",
          "executor": "xiaomi/mimo-v2.5-pro:low",
          "architect": "xiaomi/mimo-v2.5-pro:xhigh",
          "critic": "xiaomi/mimo-v2.5-pro:high"
      }
  },
  {
      "name": "mimo-pro",
      "label": "Mimo Pro",
      "group": "MIMO",
      "roles": {
          "default": "xiaomi/mimo-v2.5-pro:xhigh",
          "planner": "xiaomi/mimo-v2.5-pro:high",
          "executor": "xiaomi/mimo-v2.5-pro:medium",
          "architect": "xiaomi/mimo-v2.5-pro:xhigh",
          "critic": "xiaomi/mimo-v2.5-pro:xhigh"
      }
  },
  {
      "name": "grok-eco",
      "label": "Grok Eco",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.3:low",
          "planner": "xai/grok-4.3:low",
          "executor": "xai/grok-4.3:minimal",
          "architect": "xai/grok-4.3:high",
          "critic": "xai/grok-4.3:medium"
      }
  },
  {
      "name": "grok-medium",
      "label": "Grok Medium",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.3:medium",
          "planner": "xai/grok-4.3:medium",
          "executor": "xai/grok-4.3:low",
          "architect": "xai/grok-4.3:xhigh",
          "critic": "xai/grok-4.3:high"
      }
  },
  {
      "name": "grok-pro",
      "label": "Grok Pro",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.3:xhigh",
          "planner": "xai/grok-4.3:high",
          "executor": "xai/grok-4.3:medium",
          "architect": "xai/grok-4.3:xhigh",
          "critic": "xai/grok-4.3:xhigh"
      }
  },
  {
      "name": "grok-45-eco",
      "label": "Grok 4.5 Eco",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.5:low",
          "planner": "xai/grok-4.5:low",
          "executor": "xai/grok-4.5:low",
          "architect": "xai/grok-4.5:high",
          "critic": "xai/grok-4.5:medium"
      }
  },
  {
      "name": "grok-45-medium",
      "label": "Grok 4.5 Medium",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.5:medium",
          "planner": "xai/grok-4.5:medium",
          "executor": "xai/grok-4.5:low",
          "architect": "xai/grok-4.5:high",
          "critic": "xai/grok-4.5:high"
      }
  },
  {
      "name": "grok-45-pro",
      "label": "Grok 4.5 Pro",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.5:high",
          "planner": "xai/grok-4.5:high",
          "executor": "xai/grok-4.5:medium",
          "architect": "xai/grok-4.5:high",
          "critic": "xai/grok-4.5:high"
      }
  },
  {
      "name": "grok-46-eco",
      "label": "Grok 4.6 Eco",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.6:low",
          "planner": "xai/grok-4.6:low",
          "executor": "xai/grok-4.6:low",
          "architect": "xai/grok-4.6:high",
          "critic": "xai/grok-4.6:medium"
      }
  },
  {
      "name": "grok-46-medium",
      "label": "Grok 4.6 Medium",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.6:medium",
          "planner": "xai/grok-4.6:medium",
          "executor": "xai/grok-4.6:low",
          "architect": "xai/grok-4.6:high",
          "critic": "xai/grok-4.6:high"
      }
  },
  {
      "name": "grok-46-pro",
      "label": "Grok 4.6 Pro",
      "group": "GROK",
      "roles": {
          "default": "xai/grok-4.6:xhigh",
          "planner": "xai/grok-4.6:high",
          "executor": "xai/grok-4.6:medium",
          "architect": "xai/grok-4.6:xhigh",
          "critic": "xai/grok-4.6:xhigh"
      }
  },
  {
      "name": "grok-build-pro",
      "label": "Grok Build Pro",
      "group": "GROK",
      "roles": {
          "default": "grok-build/grok-composer-2.5-fast",
          "planner": "grok-build/grok-composer-2.5-fast",
          "executor": "grok-build/grok-build",
          "architect": "grok-build/grok-build",
          "critic": "grok-build/grok-composer-2.5-fast"
      }
  },
  {
      "name": "cursor-eco",
      "label": "Cursor Eco",
      "group": "CURSOR",
      "roles": {
          "default": "cursor/composer-2.5",
          "planner": "cursor/composer-2.5",
          "executor": "cursor/composer-2.5",
          "architect": "cursor/composer-2.5",
          "critic": "cursor/composer-2.5"
      }
  },
  {
      "name": "cursor-medium",
      "label": "Cursor Medium",
      "group": "CURSOR",
      "roles": {
          "default": "cursor/composer-2.5",
          "planner": "cursor/composer-2.5",
          "executor": "cursor/composer-2.5-fast",
          "architect": "cursor/composer-2.5-fast",
          "critic": "cursor/composer-2.5-fast"
      }
  },
  {
      "name": "cursor-pro",
      "label": "Cursor Pro",
      "group": "CURSOR",
      "roles": {
          "default": "cursor/composer-2.5-fast",
          "planner": "cursor/composer-2.5-fast",
          "executor": "cursor/composer-2.5-fast",
          "architect": "cursor/composer-2.5-fast",
          "critic": "cursor/composer-2.5-fast"
      }
  },
  {
      "name": "minimax-eco",
      "label": "MiniMax Eco",
      "group": "MINIMAX",
      "roles": {
          "default": "minimax-code/MiniMax-M3:low",
          "planner": "minimax-code/MiniMax-M3:low",
          "executor": "minimax-code/MiniMax-M3:minimal",
          "architect": "minimax-code/MiniMax-M3:high",
          "critic": "minimax-code/MiniMax-M3:medium"
      }
  },
  {
      "name": "minimax-medium",
      "label": "MiniMax Medium",
      "group": "MINIMAX",
      "roles": {
          "default": "minimax-code/MiniMax-M3:medium",
          "planner": "minimax-code/MiniMax-M3:medium",
          "executor": "minimax-code/MiniMax-M3:low",
          "architect": "minimax-code/MiniMax-M3:xhigh",
          "critic": "minimax-code/MiniMax-M3:high"
      }
  },
  {
      "name": "minimax-pro",
      "label": "MiniMax Pro",
      "group": "MINIMAX",
      "roles": {
          "default": "minimax-code/MiniMax-M3:xhigh",
          "planner": "minimax-code/MiniMax-M3:high",
          "executor": "minimax-code/MiniMax-M3:medium",
          "architect": "minimax-code/MiniMax-M3:xhigh",
          "critic": "minimax-code/MiniMax-M3:xhigh"
      }
  },
  {
      "name": "alibaba-token-plan-balanced",
      "label": "Alibaba Token Plan Balanced",
      "group": "ALIBABA TOKEN PLAN",
      "roles": {
          "default": "alibaba-token-plan/qwen3.8-max-preview:medium",
          "planner": "alibaba-token-plan/glm-5.2:high",
          "executor": "alibaba-token-plan/deepseek-v4-pro:xhigh",
          "architect": "alibaba-token-plan/qwen3.8-max-preview:xhigh",
          "critic": "alibaba-token-plan/glm-5.2:high"
      }
  },
  {
      "name": "alibaba-token-plan-pro",
      "label": "Alibaba Token Plan Pro",
      "group": "ALIBABA TOKEN PLAN",
      "roles": {
          "default": "alibaba-token-plan/qwen3.8-max-preview:medium",
          "planner": "alibaba-token-plan/glm-5.2:high",
          "executor": "alibaba-token-plan/deepseek-v4-flash-0731:max",
          "architect": "alibaba-token-plan/qwen3.8-max-preview:xhigh",
          "critic": "alibaba-token-plan/glm-5.2:xhigh"
      }
  },
  {
      "name": "alibaba-token-plan-qwenmaxxing",
      "label": "Alibaba Token Plan Qwenmaxxing",
      "group": "ALIBABA TOKEN PLAN",
      "roles": {
          "default": "alibaba-token-plan/qwen3.8-max-preview:medium",
          "planner": "alibaba-token-plan/qwen3.8-max-preview:medium",
          "executor": "alibaba-token-plan/qwen3.8-max-preview:low",
          "architect": "alibaba-token-plan/qwen3.8-max-preview:xhigh",
          "critic": "alibaba-token-plan/qwen3.8-max-preview:xhigh"
      }
  },
  {
      "name": "alibaba-token-plan-qwen-deepseek",
      "label": "Alibaba Token Plan Qwen + DeepSeek",
      "group": "ALIBABA TOKEN PLAN",
      "roles": {
          "default": "alibaba-token-plan/qwen3.8-max:high",
          "planner": "alibaba-token-plan/deepseek-v4-flash-0731:max",
          "executor": "alibaba-token-plan/deepseek-v4-flash-0731:high",
          "architect": "alibaba-token-plan/qwen3.8-max:xhigh",
          "critic": "alibaba-token-plan/qwen3.8-max:xhigh"
      }
  },
  {
      "name": "alibaba-token-plan-glm-deepseek",
      "label": "Alibaba Token Plan GLM + DeepSeek",
      "group": "ALIBABA TOKEN PLAN",
      "roles": {
          "default": "alibaba-token-plan/glm-5.2:high",
          "planner": "alibaba-token-plan/deepseek-v4-flash-0731:max",
          "executor": "alibaba-token-plan/deepseek-v4-flash-0731:high",
          "architect": "alibaba-token-plan/glm-5.2:xhigh",
          "critic": "alibaba-token-plan/glm-5.2:xhigh"
      }
  },
  {
      "name": "opus-codex",
      "label": "Opus + Codex",
      "group": "COMBOS",
      "roles": {
          "default": "anthropic/claude-opus-5:xhigh",
          "planner": "anthropic/claude-sonnet-5",
          "executor": "openai-codex/gpt-5.6-terra:low",
          "architect": "openai-codex/gpt-5.6-sol:high",
          "critic": "openai-codex/gpt-5.6-sol:xhigh"
      }
  },
  {
      "name": "codex-opencodego",
      "label": "Codex + OpenCodeGo",
      "group": "COMBOS",
      "roles": {
          "default": "openai-codex/gpt-5.6-sol:low",
          "planner": "opencode-go/kimi-k3",
          "executor": "opencode-go/deepseek-v4-pro",
          "architect": "openai-codex/gpt-5.6-sol:high",
          "critic": "opencode-go/mimo-v2.5-pro"
      }
  },
  {
      "name": "fable-opus-codex",
      "label": "Fable + Opus + Codex",
      "group": "COMBOS",
      "roles": {
          "default": "anthropic/claude-fable-5-1:high",
          "planner": "anthropic/claude-opus-5:medium",
          "executor": "openai-codex/gpt-5.6-terra:medium",
          "architect": "openai-codex/gpt-5.6-sol:xhigh",
          "critic": "anthropic/claude-opus-5:high"
      }
  },
  {
      "name": "astra-fable",
      "label": "Astra + Fable",
      "group": "COMBOS",
      "roles": {
          "default": "openai-codex/gpt-6-astra:medium",
          "planner": "openai-codex/gpt-6-astra:xhigh",
          "executor": "openai-codex/gpt-5.6-luna:max",
          "architect": "anthropic/claude-fable-5-1:xhigh",
          "critic": "anthropic/claude-fable-5-1:xhigh"
      }
  },
  {
      "name": "astra-fable-opus",
      "label": "Astra + Fable + Opus",
      "group": "COMBOS",
      "roles": {
          "default": "openai-codex/gpt-6-astra:medium",
          "planner": "anthropic/claude-opus-5:medium",
          "executor": "openai-codex/gpt-5.6-luna:max",
          "architect": "anthropic/claude-fable-5-1:xhigh",
          "critic": "anthropic/claude-fable-5-1:xhigh"
      }
  }
];
