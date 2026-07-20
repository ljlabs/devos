import type { AllowSimilarPattern, Message, Thread } from "../src/types";
import type { SqliteDb } from "./db.sqlite";

export type ShellOperator = "&&" | "||" | "|" | ";";
export interface PatternVariant { label: string; pattern: string }
export interface PermissionPresentation {
  command: string;
  toolName?: string;
  allowOptionId: string;
  variants: PatternVariant[];
}
export type PermissionDecision =
  | { action: "auto_approve"; requestId: string | number; optionId: string; command: string; toolName?: string }
  | { action: "request_user"; raw: any; presentation: PermissionPresentation };

const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "Read"]);

function toolNameFromKind(kind?: string): string | undefined {
  const names: Record<string, string> = {
    execute: "Bash", write: "Write", create: "Write",
    edit: "Edit", read: "Read", delete: "Edit", move: "Edit",
    fetch: "WebFetch",
  };
  return kind ? names[kind.toLowerCase()] : undefined;
}

function isFetchPermission(toolName: string | undefined, kind?: string): boolean {
  return toolName?.toLowerCase() === "webfetch" || kind?.toLowerCase() === "fetch";
}

function fetchTarget(rawInput: any): string {
  return rawInput?.url ?? rawInput?.uri ?? rawInput?.href ?? rawInput?.domain ?? rawInput?.host ?? "";
}

function deriveFetchVariants(target: string): PatternVariant[] {
  if (!target) return [];
  let host = target;
  try {
    host = new URL(target).hostname;
  } catch {
    host = target.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
  }
  const domainPattern = `domain:${host.toLowerCase()}`;
  return [
    { label: target, pattern: target },
    { label: domainPattern, pattern: domainPattern },
  ];
}

export function parseToolPattern(value: string): { toolName: string; pattern: string } | null {
  const candidate = value.trim().replace(/^Always Allow\s+/i, "");
  const match = candidate.match(/^([A-Za-z][\w.-]*)\(([\s\S]*)\)$/);
  return match ? { toolName: match[1], pattern: match[2] } : null;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}
export function splitShellCommand(command: string): { commands: string[]; operators: ShellOperator[] } {
  const commands: string[] = [];
  const operators: ShellOperator[] = [];
  let quote: "'" | '"' | null = null;
  let start = 0;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if ((char === "'" || char === '"') && !isEscaped(command, i)) {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      continue;
    }
    if (quote) continue;

    let operator: ShellOperator | undefined;
    if (char === "&" && command[i + 1] === "&") operator = "&&";
    else if (char === "|" && command[i + 1] === "|") operator = "||";
    else if (char === "|") operator = "|";
    else if (char === ";") operator = ";";
    if (!operator) continue;

    const part = command.slice(start, i).trim();
    if (part) {
      commands.push(part);
      operators.push(operator);
    }
    i += operator.length - 1;
    start = i + 1;
  }

  const remainder = command.slice(start).trim();
  if (remainder) commands.push(remainder);
  if (operators.length >= commands.length) operators.length = Math.max(0, commands.length - 1);
  return { commands, operators };
}

function tokenizeShellWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if ((char === "'" || char === '"') && !isEscaped(command, i)) {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      current += char;
    } else if (/\s/.test(char) && !quote) {
      if (current) words.push(current);
      current = "";
    } else current += char;
  }
  if (current) words.push(current);
  return words;
}

function joinShellParts(parts: string[], operators: ShellOperator[]): string {
  return parts.reduce((result, part, index) =>
    index === 0 ? part : `${result} ${operators[index - 1]} ${part}`, "");
}

function deriveFileVariants(filePath: string, workspacePath?: string): PatternVariant[] {
  const variants: PatternVariant[] = [{ label: filePath, pattern: filePath }];
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash !== -1) {
    const pattern = `${normalized.slice(0, slash)}/*`;
    variants.push({ label: pattern, pattern });
  }
  if (workspacePath) {
    const pattern = `${workspacePath.replace(/\\/g, "/").replace(/\/$/, "")}/*`;
    if (!variants.some((item) => item.pattern === pattern)) variants.push({ label: pattern, pattern });
  }
  if (!variants.some((item) => item.pattern === "*")) variants.push({ label: "*", pattern: "*" });
  return variants;
}
function deriveShellVariants(command: string): PatternVariant[] {
  const variants: PatternVariant[] = [{ label: command, pattern: command }];
  const shell = splitShellCommand(command);

  if (shell.commands.length > 1) {
    const parsed = shell.commands.map((subCommand) => {
      const parts = tokenizeShellWords(subCommand);
      const executable = parts[0] ?? subCommand;
      return {
        executable,
        executableName: executable.split(/[\\/]/).pop() ?? executable,
        firstArg: parts[1] ?? null,
        parts,
      };
    });
    const scoped = parsed.map(({ executable, firstArg }) => {
      if (!firstArg || firstArg.startsWith("-") || firstArg.startsWith("2>")) return `${executable} *`;
      const normalized = firstArg.replace(/\\/g, "/");
      const slash = normalized.lastIndexOf("/");
      return `${executable} ${slash === -1 ? normalized : normalized.slice(0, slash)}/*`;
    });
    const bare = parsed.map(({ executable, executableName, parts }) => {
      const interpreter = /^(?:python(?:\\d+(?:\\.\\d+)*)?(?:\\.exe)?|bash|sh|zsh|node(?:\\.exe)?)$/i.test(executableName);
      const executionFlag = parts[1];
      return interpreter && executionFlag && ["-c", "-lc", "-e"].includes(executionFlag)
        ? `${executable} ${executionFlag} *`
        : `${executable} *`;
    });
    variants.push({
      label: parsed.map(({ executableName }, i) => scoped[i].replace(parsed[i].executable, executableName)).join(", "),
      pattern: joinShellParts(scoped, shell.operators),
    });
    variants.push({
      label: parsed.map(({ executableName }) => `${executableName} *`).join(", "),
      pattern: joinShellParts(bare, shell.operators),
    });
    const uniqueVariants = variants.filter((variant, index, all) =>
      all.findIndex((candidate) => candidate.pattern === variant.pattern) === index
    );
    return uniqueVariants;
  }

  const parts = tokenizeShellWords(command);
  if (parts.length === 0) return variants;
  const executable = parts[0];
  const executableName = executable.split(/[\\/]/).pop() ?? executable;
  const positionalArgs: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith("-") || parts[i].startsWith("2>")) break;
    positionalArgs.push(parts[i]);
  }

  let maxDepth = positionalArgs.length;
  if (positionalArgs[0] && (/[\\/]/.test(positionalArgs[0]) || /\.\w{1,6}$/.test(positionalArgs[0]))) maxDepth = 1;
  for (let depth = maxDepth; depth >= 1; depth--) {
    const pattern = `${executable} ${positionalArgs.slice(0, depth).join(" ")} *`;
    if (pattern !== command && !variants.some((item) => item.pattern === pattern)) variants.push({ label: pattern, pattern });
  }

  const interpreter = /^(?:python(?:\d+(?:\.\d+)*)?(?:\.exe)?|bash|sh|zsh|node(?:\.exe)?)$/i.test(executableName);
  if (interpreter && ["-c", "-lc", "-e"].includes(parts[1])) {
    const pattern = `${executable} ${parts[1]} *`;
    if (!variants.some((item) => item.pattern === pattern)) variants.push({ label: pattern, pattern });
  }
  if (parts.length >= 2) {
    const pattern = `${executable} *`;
    if (!variants.some((item) => item.pattern === pattern)) variants.push({ label: `${executableName} *`, pattern });
  }
  return variants;
}

export function derivePatternVariants(command: string, kind?: string, workspacePath?: string): PatternVariant[] {
  if (!command) return [];
  if (kind?.toLowerCase() === "fetch") return deriveFetchVariants(command);
  return ["edit", "write", "create", "read"].includes(kind ?? "")
    ? deriveFileVariants(command, workspacePath)
    : deriveShellVariants(command);
}

type PatternRecord = string | {
  pattern: string;
  toolName?: string | null;
  variant?: string;
  createdAt?: string;
};
type PreparedPattern = { pattern: string; toolName?: string };

function preparePattern(record: PatternRecord): PreparedPattern | null {
  const rawPattern = typeof record === "string" ? record : record.pattern;
  const explicitTool = typeof record === "string" ? undefined : record.toolName ?? undefined;
  const wrapped = parseToolPattern(rawPattern);
  if (wrapped && explicitTool && wrapped.toolName.toLowerCase() !== explicitTool.toLowerCase()) return null;
  return { pattern: wrapped?.pattern ?? rawPattern, toolName: explicitTool ?? wrapped?.toolName };
}

function toolMatches(patternTool: string | undefined, incomingTool: string | undefined): boolean {
  return !patternTool || (!!incomingTool && patternTool.toLowerCase() === incomingTool.toLowerCase());
}

function valueMatches(command: string, pattern: string): boolean {
  const normalizedCommand = command.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // WebFetch approvals use `domain:host`, while ACP sends the full URL.
  if (normalizedPattern.toLowerCase().startsWith("domain:")) {
    let host = normalizedCommand;
    try {
      host = new URL(normalizedCommand).hostname;
    } catch {
      host = normalizedCommand.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
    }
    return host.toLowerCase() === normalizedPattern.slice("domain:".length).toLowerCase();
  }

  if (normalizedPattern === "*") return true;
  return normalizedPattern.endsWith("*")
    ? normalizedCommand.startsWith(normalizedPattern.slice(0, -1))
    : normalizedCommand === normalizedPattern;
}
export function checkAllowedPattern(command: string, toolName: string | undefined, records: PatternRecord[]): boolean {
  if (!command || !records?.length) return false;
  const patterns = records.map(preparePattern).filter((item): item is PreparedPattern => !!item);
  const incoming = splitShellCommand(command);

  if (incoming.commands.length === 1) {
    return patterns.some((item) => {
      if (!toolMatches(item.toolName, toolName)) return false;
      const stored = splitShellCommand(item.pattern);
      return stored.commands.length === 1 && valueMatches(command, item.pattern);
    });
  }

  if (patterns.some((item) => toolMatches(item.toolName, toolName) &&
      !item.pattern.endsWith("*") && valueMatches(command, item.pattern))) return true;

  const structuredMatch = patterns.some((item) => {
    if (!toolMatches(item.toolName, toolName)) return false;
    const stored = splitShellCommand(item.pattern);
    return stored.commands.length === incoming.commands.length &&
      stored.commands.every((patternPart, index) => valueMatches(incoming.commands[index], patternPart));
  });
  if (structuredMatch) return true;

  return incoming.commands.every((part) => patterns.some((item) => {
    if (!toolMatches(item.toolName, toolName)) return false;
    const stored = splitShellCommand(item.pattern);
    return stored.commands.length === 1 && valueMatches(part, item.pattern);
  }));
}

export class PermissionManager {
  constructor(private readonly db: SqliteDb) {}

  getPatterns(): AllowSimilarPattern[] {
    return this.db.getAllowedPatterns();
  }

  savePattern(pattern: string, toolName?: string, variant?: AllowSimilarPattern["variant"]): AllowSimilarPattern {
    if (!pattern || typeof pattern !== "string") throw new Error("pattern (string) required");
    if (pattern.length > 500) throw new Error("pattern must be 500 characters or less");
    const wrapped = parseToolPattern(pattern);
    if (wrapped && toolName && wrapped.toolName.toLowerCase() !== toolName.toLowerCase()) {
      throw new Error("wrapped pattern tool does not match toolName");
    }
    const canonicalPattern = wrapped?.pattern ?? pattern;
    const canonicalTool = toolName ?? wrapped?.toolName;
    const existing = this.db.getAllowedPatterns().find((item) =>
      item.pattern === canonicalPattern && (item.toolName ?? "").toLowerCase() === (canonicalTool ?? "").toLowerCase());
    if (existing) return existing;

    return this.db.insertAllowedPattern({
      pattern: canonicalPattern,
      toolName: canonicalTool,
      variant: variant ?? (canonicalPattern.endsWith("*") ? "wildcard" : "exact"),
      createdAt: new Date().toISOString(),
    });
  }

  deletePattern(pattern: string, toolName?: string): boolean {
    const wrapped = parseToolPattern(pattern);
    const canonicalPattern = wrapped?.pattern ?? pattern;
    const canonicalTool = toolName ?? wrapped?.toolName;
    return canonicalTool
      ? this.db.deleteAllowedPattern(canonicalPattern, canonicalTool)
      : this.db.deleteAllowedPatternAnyTool(canonicalPattern);
  }

  evaluate(raw: any, workspacePath?: string): PermissionDecision | null {
    if (raw?.method !== "session/request_permission") return null;
    const toolCall = raw.params?.toolCall ?? {};
    const rawInput = toolCall.rawInput ?? {};
    const toolName = toolCall?._meta?.claudeCode?.toolName ??
      raw.params?._meta?.claudeCode?.toolName ?? toolNameFromKind(toolCall.kind);
    const fetchPermission = isFetchPermission(toolName, toolCall.kind);
    const command: string = fetchPermission
      ? fetchTarget(rawInput)
      : rawInput.command ?? rawInput.file_path ?? rawInput.path ?? "";
    const allowOptionId = raw.params?.options?.find((option: any) => option.kind === "allow_once")?.optionId ?? "allow";
    const presentation = {
      command,
      toolName,
      allowOptionId,
      variants: fetchPermission
        ? deriveFetchVariants(command)
        : derivePatternVariants(command, toolCall.kind, workspacePath),
    };

    if (command && checkAllowedPattern(command, toolName, this.db.getAllowedPatterns())) {
      return { action: "auto_approve", requestId: raw.id, optionId: allowOptionId, command, toolName };
    }
    return {
      action: "request_user",
      presentation,
      raw: { ...raw, params: { ...raw.params, allowSimilar: presentation } },
    };
  }

  resolveUserResponse(thread: Thread, optionId: string, selectedPattern?: string): { requestId: string | number; optionId: string } {
    if (thread.pendingPermissionId === undefined) throw new Error("no pending permission");
    const request = this.findPendingRequest(thread.id, thread.pendingPermissionId);
    if (!request) throw new Error("pending permission request not found");
    const decision = this.evaluateForDisplay(request);

    const selectedOption = request.params?.options?.find((option: any) => option.optionId === optionId);
    if (!selectedOption) throw new Error("option is not valid for this request");

    if (selectedPattern) {
      if (selectedOption.kind !== "allow_once") throw new Error("allow-similar requires an allow-once option");
      if (!decision.variants.some((item) => item.pattern === selectedPattern)) throw new Error("selected pattern is not valid for this request");
      this.savePattern(selectedPattern, decision.toolName, this.variantFor(decision.toolName));
    } else if (selectedOption.kind === "allow_always") {
      const parsed = parseToolPattern(selectedOption.name ?? "");
      this.savePattern(parsed?.pattern ?? decision.command, parsed?.toolName ?? decision.toolName, this.variantFor(parsed?.toolName ?? decision.toolName));
    }
    return { requestId: thread.pendingPermissionId, optionId };
  }

  private evaluateForDisplay(raw: any): PermissionPresentation {
    const existing = raw.params?.allowSimilar;
    if (existing?.variants) return existing;
    const toolCall = raw.params?.toolCall ?? {};
    const input = toolCall.rawInput ?? {};
    const toolName = toolCall?._meta?.claudeCode?.toolName ?? raw.params?._meta?.claudeCode?.toolName ?? toolNameFromKind(toolCall.kind);
    const fetchPermission = isFetchPermission(toolName, toolCall.kind);
    const command = fetchPermission
      ? fetchTarget(input)
      : input.command ?? input.file_path ?? input.path ?? "";
    const allowOptionId = raw.params?.options?.find((option: any) => option.kind === "allow_once")?.optionId ?? "allow";
    return {
      command,
      toolName,
      allowOptionId,
      variants: fetchPermission ? deriveFetchVariants(command) : derivePatternVariants(command, toolCall.kind),
    };
  }

  private findPendingRequest(threadId: string, requestId: string | number): any | undefined {
    return this.db.getMessagesByThread(threadId).reverse().find((message: Message) =>
      message.type === "session/request_permission" && message.raw?.id === requestId)?.raw;
  }

  private variantFor(toolName?: string): AllowSimilarPattern["variant"] {
    return toolName && FILE_TOOLS.has(toolName)
      ? toolName.toLowerCase() as AllowSimilarPattern["variant"]
      : "execute";
  }
}
