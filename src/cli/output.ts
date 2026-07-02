/**
 * Console output utilities with color support
 * Provides consistent formatting similar to the Python CLI
 */

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[91m",
  green: "\x1b[92m",
  yellow: "\x1b[38;5;208m",
  blue: "\x1b[94m",
  gray: "\x1b[90m",
} as const;

// Check if colors should be disabled
const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;

function colorize(text: string, color: keyof typeof colors): string {
  if (noColor) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Output a success message (green)
 */
export function success(message: string): void {
  console.log(colorize(message, "green"));
}

/**
 * Output an error message (red)
 */
export function error(message: string): void {
  console.error(colorize(message, "red"));
}

/**
 * Output a warning message (yellow/orange)
 */
export function warning(message: string): void {
  console.log(colorize(message, "yellow"));
}

/**
 * Output an info message (default color)
 */
export function info(message: string): void {
  console.log(message);
}

/**
 * Output a highlighted message (blue)
 */
export function highlight(message: string): void {
  console.log(colorize(message, "blue"));
}

/**
 * Output a gray message (dimmed)
 */
export function gray(message: string): void {
  console.log(colorize(message, "gray"));
}

/**
 * Output a bold message
 */
export function bold(message: string): void {
  console.log(colorize(message, "bold"));
}

/**
 * Format a timestamp for console output
 */
export function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Show a resource change (checkmark + path + status)
 * @deprecated Use showChangesTable instead for table format
 */
export function showResourceChange(
  path: string,
  status: "created" | "changed" | "deleted"
): void {
  console.log(`✓ ${path} ${status}`);
}

/**
 * Resource change entry for table display
 */
export interface ResourceChange {
  status: "new" | "modified" | "deleted";
  name: string;
  type: "datasource" | "pipe" | "connection";
}

/**
 * Show changes table similar to Python CLI
 * Displays a formatted table of resource changes
 */
export function showChangesTable(changes: ResourceChange[]): void {
  if (changes.length === 0) {
    gray("* No changes to be deployed");
    return;
  }

  info("\n* Changes to be deployed:");

  // Calculate column widths
  const statusWidth = Math.max(6, ...changes.map((c) => c.status.length));
  const nameWidth = Math.max(4, ...changes.map((c) => c.name.length));
  const typeWidth = Math.max(4, ...changes.map((c) => c.type.length));

  // Build table
  const separator = `├${"─".repeat(statusWidth + 2)}┼${"─".repeat(nameWidth + 2)}┼${"─".repeat(typeWidth + 2)}┤`;
  const topBorder = `┌${"─".repeat(statusWidth + 2)}┬${"─".repeat(nameWidth + 2)}┬${"─".repeat(typeWidth + 2)}┐`;
  const bottomBorder = `└${"─".repeat(statusWidth + 2)}┴${"─".repeat(nameWidth + 2)}┴${"─".repeat(typeWidth + 2)}┘`;

  const padRight = (str: string, width: number) => str + " ".repeat(width - str.length);

  // Print table
  console.log(topBorder);
  console.log(`│ ${padRight("status", statusWidth)} │ ${padRight("name", nameWidth)} │ ${padRight("type", typeWidth)} │`);
  console.log(separator);

  for (const change of changes) {
    console.log(`│ ${padRight(change.status, statusWidth)} │ ${padRight(change.name, nameWidth)} │ ${padRight(change.type, typeWidth)} │`);
  }

  console.log(bottomBorder);
}

/**
 * Show a warning for a resource
 */
export function showResourceWarning(
  level: string,
  resource: string,
  message: string
): void {
  warning(`△ ${level}: ${resource}: ${message}`);
}

/**
 * Show build errors in formatted style
 */
export function showBuildErrors(errors: Array<{ filename?: string; error: string }>): void {
  for (const err of errors) {
    if (err.filename) {
      error(`${err.filename}`);
      // Indent the error message
      const lines = err.error.split("\n");
      for (const line of lines) {
        error(`  ${line}`);
      }
    } else {
      error(err.error);
    }
    console.log(); // Empty line between errors
  }
}

/**
 * Show final build success message
 */
export function showBuildSuccess(durationMs: number, isRebuild = false): void {
  const prefix = isRebuild ? "Rebuild" : "Build";
  success(`\n✓ ${prefix} completed in ${formatDuration(durationMs)}`);
}

/**
 * Show final build failure message
 */
export function showBuildFailure(isRebuild = false): void {
  const prefix = isRebuild ? "Rebuild" : "Build";
  error(`\n✗ ${prefix} failed`);
}

/**
 * Show no changes message
 */
export function showNoChanges(): void {
  warning("△ Not deploying. No changes.");
}

/**
 * Show waiting for deployment message
 */
export function showWaitingForDeployment(): void {
  info("» Waiting for deployment to be ready...");
}

/**
 * Show deployment ready message
 */
export function showDeploymentReady(): void {
  success("✓ Deployment is ready");
}

/**
 * Show deployment live message
 */
export function showDeploymentLive(deploymentId: string): void {
  success(`✓ Deployment #${deploymentId} is live!`);
}

/**
 * Show waiting for deployment promotion message
 */
export function showWaitingForPromote(): void {
  info("» Waiting for deployment to be promoted...");
}

/**
 * Show deployment submitted message (used when --no-wait is set)
 */
export function showDeploymentSubmitted(deploymentId: string, autoPromote: boolean): void {
  const autoFrag = autoPromote
    ? " It will be auto-promoted when ready."
    : " It won't be auto-promoted when ready.";
  success(`✓ Deployment #${deploymentId} submitted.${autoFrag}`);
}

/**
 * Show deployment promoted message
 */
export function showDeploymentPromoted(): void {
  success("✓ Deployment promoted");
}

/**
 * Show validating deployment message
 */
export function showValidatingDeployment(): void {
  info("» Validating deployment...");
}

/**
 * Show final deploy success message
 */
export function showDeploySuccess(durationMs: number): void {
  success(`\n✓ Deploy completed in ${formatDuration(durationMs)}`);
}

/**
 * Show final deploy failure message
 */
export function showDeployFailure(): void {
  error(`\n✗ Deploy failed`);
}

/**
 * Branch info for display
 */
export interface BranchDisplayInfo {
  /** Git branch name */
  gitBranch: string | null;
  /** Tinybird branch name */
  tinybirdBranch: string | null;
  /** Whether the branch was newly created */
  wasCreated: boolean;
  /** Dashboard URL for the branch */
  dashboardUrl?: string;
  /** Whether using local mode */
  isLocal?: boolean;
}

/**
 * Show branch information in a compact, styled format
 */
export function showBranchInfo(info: BranchDisplayInfo): void {
  const status = info.wasCreated
    ? colorize("✓ created", "green")
    : colorize("existing", "gray");

  if (info.isLocal) {
    // Show git branch
    if (info.gitBranch) {
      console.log(`» Git branch:      ${info.gitBranch}`);
    }
    // Show local branch
    const name = info.tinybirdBranch ?? "unknown";
    console.log(`» Tinybird Local branch: ${name} ${status}`);
    // Show dashboard URL
    if (info.dashboardUrl) {
      console.log(colorize(`  ↳ ${info.dashboardUrl}`, "gray"));
    }
  } else {
    // Show git branch
    if (info.gitBranch) {
      console.log(`» Git branch:      ${info.gitBranch}`);
    }
    // Show Tinybird branch
    if (info.tinybirdBranch) {
      console.log(`» Tinybird branch: ${info.tinybirdBranch} ${status}`);
    }
    // Show dashboard URL
    if (info.dashboardUrl) {
      console.log(colorize(`  ↳ ${info.dashboardUrl}`, "gray"));
    }
  }
  console.log("");
}

/**
 * Info display data
 */
export interface InfoDisplayData {
  cloud?: {
    workspaceName: string;
    workspaceId: string;
    userEmail: string;
    apiHost: string;
    dashboardUrl?: string;
    token: string;
  };
  local?: {
    running: boolean;
    workspaceName?: string;
    workspaceId?: string;
    apiHost: string;
    dashboardUrl?: string;
    token?: string;
  };
  project?: {
    cwd: string;
    configPath: string;
    devMode: string;
    gitBranch: string | null;
    tinybirdBranch: string | null;
    isMainBranch: boolean;
  };
  branch?: {
    name: string;
    id: string;
    token: string;
    dashboardUrl?: string;
  };
}

/**
 * Show project and workspace info
 */
export function showInfo(data: InfoDisplayData): void {
  // Cloud section
  if (data.cloud) {
    highlight("» Workspace:");
    console.log(`  Name:      ${data.cloud.workspaceName}`);
    console.log(`  ID:        ${data.cloud.workspaceId}`);
    console.log(`  User:      ${data.cloud.userEmail}`);
    console.log(`  API:       ${data.cloud.apiHost}`);
    if (data.cloud.dashboardUrl) {
      console.log(`  Dashboard: ${data.cloud.dashboardUrl}`);
    }
    console.log(`  Token:     ${data.cloud.token}`);
    console.log();
  }

  // Local section
  if (data.local) {
    highlight("» Local:");
    if (!data.local.running) {
      warning("  Tinybird local is not running.");
      console.log("  Start with: docker run -d -p 7181:7181 tinybirdco/tinybird-local");
    } else if (data.local.workspaceName) {
      console.log(`  Name:      ${data.local.workspaceName}`);
      console.log(`  ID:        ${data.local.workspaceId}`);
      console.log(`  API:       ${data.local.apiHost}`);
      if (data.local.dashboardUrl) {
        console.log(`  Dashboard: ${data.local.dashboardUrl}`);
      }
      console.log(`  Token:     ${data.local.token}`);
    } else {
      console.log(`  API:       ${data.local.apiHost}`);
      warning("  Could not get workspace info.");
    }
    console.log();
  }

  // Branch section (current branch when working on a branch)
  if (data.branch) {
    highlight("» Branch:");
    console.log(`  Name:      ${data.branch.name}`);
    console.log(`  ID:        ${data.branch.id}`);
    if (data.branch.dashboardUrl) {
      console.log(`  Dashboard: ${data.branch.dashboardUrl}`);
    }
    console.log(`  Token:     ${data.branch.token}`);
    console.log();
  } else if (data.project?.devMode === "branch") {
    // Show message when in branch mode but no branch (on main or no git)
    highlight("» Branch:");
    if (!data.project.gitBranch) {
      warning("  Git branch not detected. Switch to a git branch first.");
    } else if (data.project.isMainBranch) {
      warning("  On main branch. Switch to a feature branch first.");
    }
    console.log();
  }

  // Project section
  if (data.project) {
    highlight("» Project:");
    console.log(`  Directory: ${data.project.cwd}`);
    console.log(`  Config:    ${data.project.configPath}`);
    console.log(`  Dev mode:  ${data.project.devMode}`);
    if (data.project.gitBranch) {
      console.log(`  Git:       ${data.project.gitBranch}${data.project.isMainBranch ? " (main)" : ""}`);
    }
    console.log();
  }

}

/**
 * Output object containing all output functions
 */
export const output = {
  success,
  error,
  warning,
  info,
  highlight,
  gray,
  bold,
  formatTime,
  formatDuration,
  showResourceChange,
  showChangesTable,
  showResourceWarning,
  showBuildErrors,
  showBuildSuccess,
  showBuildFailure,
  showNoChanges,
  showWaitingForDeployment,
  showDeploymentReady,
  showWaitingForPromote,
  showDeploymentPromoted,
  showDeploymentSubmitted,
  showDeploymentLive,
  showValidatingDeployment,
  showDeploySuccess,
  showDeployFailure,
  showBranchInfo,
  showInfo,
};
