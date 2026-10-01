import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Host-side configuration for the standalone TUI: which OpenCode models each
 * operation uses, the command to invoke, and the pipeline knobs. Precedence:
 * CLI flags > environment variables > this file > defaults.
 */
export interface AugmentConfig {
  model?: string;
  draftModel?: string;
  challengeModel?: string;
  command?: string;
  server?: string;
  agent?: string;
  timeoutMs?: number;
  challengeRounds?: number;
}

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()
    ? process.env.XDG_CONFIG_HOME
    : path.join(os.homedir(), ".config");
  return path.join(base, "neolit", "augment.json");
}

export function loadAugmentConfig(): AugmentConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    const config: AugmentConfig = {};
    for (const key of ["model", "draftModel", "challengeModel", "command", "server", "agent"] as const) {
      if (typeof raw[key] === "string" && (raw[key] as string).trim()) config[key] = raw[key] as string;
    }
    for (const key of ["timeoutMs", "challengeRounds"] as const) {
      if (typeof raw[key] === "number" && Number.isSafeInteger(raw[key])) config[key] = raw[key];
    }
    return config;
  } catch {
    return {};
  }
}

export function saveAugmentConfig(patch: AugmentConfig): AugmentConfig {
  const merged = { ...loadAugmentConfig(), ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

/** The environment layer, applied over the file. */
export function configFromEnvironment(env: NodeJS.ProcessEnv = process.env): AugmentConfig {
  const config: AugmentConfig = {};
  if (env.AUGMENT_OPENCODE_MODEL) config.model = env.AUGMENT_OPENCODE_MODEL;
  if (env.AUGMENT_OPENCODE_DRAFT_MODEL) config.draftModel = env.AUGMENT_OPENCODE_DRAFT_MODEL;
  if (env.AUGMENT_OPENCODE_CHALLENGE_MODEL) config.challengeModel = env.AUGMENT_OPENCODE_CHALLENGE_MODEL;
  if (env.AUGMENT_OPENCODE_COMMAND) config.command = env.AUGMENT_OPENCODE_COMMAND;
  if (env.AUGMENT_OPENCODE_SERVER) config.server = env.AUGMENT_OPENCODE_SERVER;
  if (env.AUGMENT_OPENCODE_AGENT) config.agent = env.AUGMENT_OPENCODE_AGENT;
  const timeout = Number(env.AUGMENT_OPENCODE_TIMEOUT_MS);
  if (Number.isSafeInteger(timeout) && timeout > 0) config.timeoutMs = timeout;
  const rounds = Number(env.AUGMENT_CHALLENGE_ROUNDS);
  if (Number.isSafeInteger(rounds) && rounds >= 0 && rounds <= 2) config.challengeRounds = rounds;
  return config;
}

export function effectiveConfig(file: AugmentConfig = loadAugmentConfig(), env: AugmentConfig = configFromEnvironment()): AugmentConfig {
  return { ...file, ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) };
}
