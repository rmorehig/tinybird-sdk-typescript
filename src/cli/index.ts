#!/usr/bin/env node
/**
 * Tinybird CLI
 * Commands for building and deploying Tinybird projects
 */

import { config } from "dotenv";

// Load .env files in priority order (later files don't override earlier ones)
config({ path: ".env.local" });
config({ path: ".env" });

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { runInit } from "./commands/init.js";
import { runBuild } from "./commands/build.js";
import { runDeploy } from "./commands/deploy.js";
import { runGenerate } from "./commands/generate.js";
import { runPreview } from "./commands/preview.js";
import { runDev } from "./commands/dev.js";
import { runMigrate } from "./commands/migrate.js";
import { runLogin } from "./commands/login.js";
import {
  runBranchList,
  runBranchStatus,
  runBranchDelete,
} from "./commands/branch.js";
import { runClear } from "./commands/clear.js";
import { runInfo } from "./commands/info.js";
import { runPull } from "./commands/pull.js";
import {
  runOpenDashboard,
  type Environment,
} from "./commands/open-dashboard.js";
import { detectPackageManagerRunCmd } from "./utils/package-manager.js";
import type { DevMode } from "./config.js";
import { output, type ResourceChange } from "./output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8")
) as { version: string };
const VERSION = packageJson.version;

/**
 * Create and configure the CLI
 */
function createCli(): Command {
  const program = new Command();

  program
    .name("tinybird")
    .description("Tinybird TypeScript SDK CLI")
    .version(VERSION);

  // Init command
  program
    .command("init")
    .description("Initialize a new Tinybird TypeScript project")
    .option("-f, --force", "Overwrite existing files")
    .option("--skip-login", "Skip browser login flow")
    .option("-m, --mode <mode>", "Development mode: 'branch' or 'local'")
    .option("-p, --path <path>", "Path for Tinybird client files")
    .action(async (options) => {
      // Validate mode if provided
      if (options.mode && !["branch", "local"].includes(options.mode)) {
        console.error(
          `Error: Invalid mode '${options.mode}'. Use 'branch' or 'local'.`
        );
        process.exit(1);
      }

      const result = await runInit({
        force: options.force,
        skipLogin: options.skipLogin,
        devMode: options.mode,
        clientPath: options.path,
      });

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      // Detect package manager for run command
      const clientPath = result.clientPath ?? "tinybird";
      const sdkCheckDir = result.clientPath
        ? dirname(join(process.cwd(), clientPath))
        : process.cwd();
      const runCmd = detectPackageManagerRunCmd(sdkCheckDir);

      if (result.loggedIn) {
        console.log(`\nLogged in successfully!`);
        if (result.workspaceName) {
          console.log(`  Workspace: ${result.workspaceName}`);
        }
        if (result.userEmail) {
          console.log(`  User: ${result.userEmail}`);
        }

        if (result.existingDatafiles && result.existingDatafiles.length > 0) {
          console.log(
            `\nAdded ${result.existingDatafiles.length} existing datafile(s) to tinybird.json.`
          );
        }
        console.log("\nNext steps:");
        console.log(`  1. Edit your schema in ${clientPath}`);
        console.log(`  2. Run '${runCmd} tinybird:build' to start development`);
      } else if (result.loggedIn === false) {
        console.log("\nLogin was skipped or failed.");
        console.log("\nNext steps:");
        console.log(`  1. Run 'npx tinybird login' to authenticate`);
        console.log(`  2. Edit your schema in ${clientPath}`);
        console.log(`  3. Run '${runCmd} tinybird:build' to start development`);
      } else {
        console.log("\nNext steps:");
        console.log(`  1. Edit your schema in ${clientPath}`);
        console.log(`  2. Run '${runCmd} tinybird:build' to start development`);
      }
    });

  // Login command
  program
    .command("login")
    .description("Authenticate with Tinybird via browser")
    .action(async () => {
      console.log("Starting authentication...\n");

      const result = await runLogin();

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log("\nAuthentication successful!");
      if (result.workspaceName) {
        console.log(`  Workspace: ${result.workspaceName}`);
      }
      if (result.userEmail) {
        console.log(`  User: ${result.userEmail}`);
      }
      if (result.baseUrl) {
        console.log(`  API Host: ${result.baseUrl}`);
      }
    });

  // Info command
  program
    .command("info")
    .description("Show information about the current project and workspace")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const result = await runInfo({ json: options.json });

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (options.json) {
        // JSON output
        const jsonOutput = {
          cloud: result.cloud,
          local: result.local,
          branch: result.branch,
          project: result.project,
          branches: result.branches,
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        // Human-readable output
        output.showInfo({
          cloud: result.cloud,
          local: result.local,
          branch: result.branch,
          project: result.project,
        });
      }
    });

  // Pull command
  program
    .command("pull")
    .description(
      "Download datasources, pipes, and connections from Tinybird as datafiles"
    )
    .option(
      "-o, --output-dir <path>",
      "Directory where pulled files are written",
      "."
    )
    .option("-f, --force", "Overwrite existing files")
    .action(async (options) => {
      output.highlight("Pulling resources from Tinybird...");

      const result = await runPull({
        outputDir: options.outputDir,
        overwrite: options.force,
      });

      if (!result.success) {
        output.error(result.error ?? "Pull failed");
        process.exit(1);
      }

      const files = result.files ?? [];
      const stats = result.stats ?? {
        datasources: 0,
        pipes: 0,
        connections: 0,
        total: files.length,
      };

      for (const file of files) {
        const status = file.status === "created" ? "created" : "changed";
        output.showResourceChange(file.relativePath, status);
      }

      output.success(
        `\nPulled ${stats.total} file(s): ${stats.datasources} datasource(s), ${stats.pipes} pipe(s), ${stats.connections} connection(s)`
      );
      output.success(`Completed in ${output.formatDuration(result.durationMs)}`);
    });

  // Open command
  program
    .command("open")
    .description("Open the Tinybird dashboard in the default browser")
    .option(
      "-e, --env <env>",
      "Which environment to open: 'cloud', 'local', or 'branch'"
    )
    .action(async (options) => {
      const validEnvs = ["cloud", "local", "branch"];
      if (options.env && !validEnvs.includes(options.env)) {
        console.error(
          `Error: Invalid environment '${
            options.env
          }'. Use one of: ${validEnvs.join(", ")}`
        );
        process.exit(1);
      }

      const result = await runOpenDashboard({
        environment: options.env as Environment | undefined,
      });

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`Opening ${result.environment} dashboard...`);
      if (result.browserOpened) {
        console.log(`Dashboard: ${result.url}`);
      } else {
        console.log(`Could not open browser. Please visit: ${result.url}`);
      }
    });

  // Build command
  program
    .command("build")
    .description("Build and push resources to a Tinybird branch (not main)")
    .option("--dry-run", "Generate without pushing to API")
    .option("--debug", "Show debug output including API requests/responses")
    .option("--local", "Use local Tinybird container")
    .option("--branch", "Use Tinybird cloud with branches")
    .option(
      "--last-partition",
      '[DEPRECATED] Use `branch_data_on_create: "last_partition"` in tinybird.config.json. Copy the last partition of production data when creating a cloud branch.'
    )
    .action(async (options) => {
      if (options.debug) {
        process.env.TINYBIRD_DEBUG = "1";
      }

      // Determine devMode override
      let devModeOverride: DevMode | undefined;
      if (options.local) {
        devModeOverride = "local";
      } else if (options.branch) {
        devModeOverride = "branch";
      }

      const result = await runBuild({
        dryRun: options.dryRun,
        devModeOverride,
        lastPartition: options.lastPartition,
      });

      const { build, deploy, branchInfo } = result;

      // Show branch info
      if (branchInfo) {
        output.showBranchInfo(branchInfo);
      }

      output.highlight("Building...");

      if (!result.success) {
        // Show detailed errors if available
        if (deploy?.errors && deploy.errors.length > 0) {
          output.showBuildErrors(deploy.errors);
        } else if (result.error) {
          output.error(result.error);
        }
        output.showBuildFailure();
        process.exit(1);
      }

      if (options.dryRun) {
        console.log("\n[Dry run] Resources not deployed to API");

        // Show generated content
        if (build) {
          console.log("\n--- Generated Datasources ---");
          build.resources.datasources.forEach((ds) => {
            console.log(`\n${ds.name}.datasource:`);
            console.log(ds.content);
          });

          console.log("\n--- Generated Pipes ---");
          build.resources.pipes.forEach((pipe) => {
            console.log(`\n${pipe.name}.pipe:`);
            console.log(pipe.content);
          });
        }
        output.showBuildSuccess(result.durationMs);
      } else if (deploy) {
        if (deploy.result === "no_changes") {
          output.showNoChanges();
        } else {
          // Show datasource changes
          if (deploy.datasources) {
            for (const name of deploy.datasources.created) {
              output.showResourceChange(`${name}.datasource`, "created");
            }
            for (const name of deploy.datasources.changed) {
              output.showResourceChange(`${name}.datasource`, "changed");
            }
            for (const name of deploy.datasources.deleted) {
              output.showResourceChange(`${name}.datasource`, "deleted");
            }
          }

          // Show pipe changes
          if (deploy.pipes) {
            for (const name of deploy.pipes.created) {
              output.showResourceChange(`${name}.pipe`, "created");
            }
            for (const name of deploy.pipes.changed) {
              output.showResourceChange(`${name}.pipe`, "changed");
            }
            for (const name of deploy.pipes.deleted) {
              output.showResourceChange(`${name}.pipe`, "deleted");
            }
          }

          output.showBuildSuccess(result.durationMs);
        }
      }
    });

  // Generate command
  program
    .command("generate")
    .description("Generate Tinybird datafiles from TypeScript definitions")
    .option("--json", "Output JSON artifacts (for external consumers)")
    .option(
      "-o, --output-dir <path>",
      "Write generated files to a target directory"
    )
    .action(async (options) => {
      const result = await runGenerate({
        outputDir: options.outputDir,
      });

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const stats = result.stats ?? {
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
        totalCount: 0,
      };

      console.log(
        `Generated ${stats.totalCount} resources (${stats.datasourceCount} datasources, ${stats.pipeCount} pipes, ${stats.connectionCount} connections)`
      );
      if (result.outputDir) {
        console.log(`Written to: ${result.outputDir}`);
      }
      console.log(`Completed in ${output.formatDuration(result.durationMs)}`);
    });

  // Migrate command
  program
    .command("migrate")
    .description(
      "Migrate .datasource/.pipe/.connection files into TypeScript definitions"
    )
    .argument(
      "<patterns...>",
      "One or more file paths, directories, or glob patterns"
    )
    .option(
      "-o, --out <path>",
      "Output TypeScript path (default: ./tinybird.migration.ts)"
    )
    .option("--dry-run", "Preview migration without writing files")
    .option("--force", "Overwrite output file if it already exists")
    .option(
      "--no-strict",
      "Do not fail command when some resources cannot be migrated"
    )
    .action(async (patterns: string[], options) => {
      const result = await runMigrate({
        patterns,
        out: options.out,
        strict: options.strict,
        dryRun: options.dryRun,
        force: options.force,
      });

      const migratedCounts = {
        datasources: result.migrated.filter((resource) => resource.kind === "datasource")
          .length,
        pipes: result.migrated.filter((resource) => resource.kind === "pipe").length,
        connections: result.migrated.filter(
          (resource) => resource.kind === "connection"
        ).length,
      };

      console.log(
        `Migrated: ${migratedCounts.datasources} datasource(s), ${migratedCounts.pipes} pipe(s), ${migratedCounts.connections} connection(s)`
      );

      if (result.migrated.length > 0) {
        if (result.dryRun) {
          console.log(`[Dry run] Output would be written to: ${result.outputPath}`);
        } else {
          console.log(`Output written to: ${result.outputPath}`);
        }
      } else {
        console.log("No resources were migrated.");
      }

      if (result.errors.length > 0) {
        console.log("\nErrors:");
        for (const error of result.errors) {
          console.log(
            `- ${error.filePath} (${error.resourceKind}:${error.resourceName}): ${error.message}`
          );
        }
      }

      if (!result.success) {
        process.exit(1);
      }
    });

  // Deploy command
  program
    .command("deploy")
    .description("Deploy resources to main Tinybird workspace (production)")
    .option("--dry-run", "Generate without pushing to API")
    .option("--check", "Validate deploy with Tinybird API without applying")
    .option(
      "--allow-destructive-operations",
      "Allow deploys that delete existing datasources, pipes, or connections"
    )
    .option("--debug", "Show debug output including API requests/responses")
    .action(async (options) => {
      if (options.debug) {
        process.env.TINYBIRD_DEBUG = "1";
      }

      output.highlight("Deploying to main workspace...");

      const result = await runDeploy({
        dryRun: options.dryRun,
        check: options.check,
        allowDestructiveOperations: options.allowDestructiveOperations,
        callbacks: {
          onChanges: (deployChanges) => {
            // Show changes table immediately after deployment is created
            const changes: ResourceChange[] = [];

            for (const name of deployChanges.datasources.created) {
              changes.push({ status: "new", name, type: "datasource" });
            }
            for (const name of deployChanges.datasources.changed) {
              changes.push({ status: "modified", name, type: "datasource" });
            }
            for (const name of deployChanges.datasources.deleted) {
              changes.push({ status: "deleted", name, type: "datasource" });
            }

            for (const name of deployChanges.pipes.created) {
              changes.push({ status: "new", name, type: "pipe" });
            }
            for (const name of deployChanges.pipes.changed) {
              changes.push({ status: "modified", name, type: "pipe" });
            }
            for (const name of deployChanges.pipes.deleted) {
              changes.push({ status: "deleted", name, type: "pipe" });
            }

            for (const name of deployChanges.connections.created) {
              changes.push({ status: "new", name, type: "connection" });
            }
            for (const name of deployChanges.connections.changed) {
              changes.push({ status: "modified", name, type: "connection" });
            }
            for (const name of deployChanges.connections.deleted) {
              changes.push({ status: "deleted", name, type: "connection" });
            }

            output.showChangesTable(changes);
          },
          onWaitingForReady: () => output.showWaitingForDeployment(),
          onDeploymentReady: () => output.showDeploymentReady(),
          onDeploymentLive: (id) => output.showDeploymentLive(id),
          onValidating: () => output.showValidatingDeployment(),
        },
      });

      const { build, deploy } = result;

      if (!result.success) {
        // Show detailed errors if available
        if (deploy?.errors && deploy.errors.length > 0) {
          output.showBuildErrors(deploy.errors);
        } else {
          const errorMessage = result.error ?? deploy?.error;
          output.error(errorMessage ?? "Deploy failed (run with TINYBIRD_DEBUG=1 for more info)");
        }
        output.showDeployFailure();
        process.exit(1);
      }

      if (options.dryRun) {
        console.log("\n[Dry run] Resources not deployed to API");

        // Show generated content
        if (build) {
          console.log("\n--- Generated Datasources ---");
          build.resources.datasources.forEach((ds) => {
            console.log(`\n${ds.name}.datasource:`);
            console.log(ds.content);
          });

          console.log("\n--- Generated Pipes ---");
          build.resources.pipes.forEach((pipe) => {
            console.log(`\n${pipe.name}.pipe:`);
            console.log(pipe.content);
          });
        }
        output.showDeploySuccess(result.durationMs);
      } else if (options.check) {
        console.log("\n[Check] Resources validated with Tinybird API");
        output.showDeploySuccess(result.durationMs);
      } else if (deploy) {
        if (deploy.result === "no_changes") {
          output.showNoChanges();
        } else {
          // Changes table was already shown via onChanges callback
          output.showDeploySuccess(result.durationMs);
        }
      }
    });

  // Preview command
  program
    .command("preview")
    .description(
      "Create a preview branch and deploy resources (for CI/testing)"
    )
    .option("--dry-run", "Generate without creating branch or deploying")
    .option("--check", "Validate deploy with Tinybird API without applying")
    .option("--debug", "Show debug output including API requests/responses")
    .option("--json", "Output JSON instead of human-readable format")
    .option("-n, --name <name>", "Override preview branch name")
    .option("--local", "Use local Tinybird container")
    .action(async (options) => {
      if (options.debug) {
        process.env.TINYBIRD_DEBUG = "1";
      }

      // Determine devMode override
      let devModeOverride: DevMode | undefined;
      if (options.local) {
        devModeOverride = "local";
      }

      if (!options.json) {
        const modeLabel = devModeOverride === "local" ? " (local)" : "";
        console.log(`Creating preview branch${modeLabel}...\n`);
      }

      const result = await runPreview({
        dryRun: options.dryRun,
        check: options.check,
        name: options.name,
        devModeOverride,
      });

      // JSON output mode
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.success) {
          process.exit(1);
        }
        return;
      }

      // Human-readable output mode
      if (!result.success) {
        // Parse error message for individual errors (one per line)
        const errorLines = result.error?.split("\n") ?? ["Unknown error"];
        for (const line of errorLines) {
          console.log(pc.red(`- ${line}`));
        }
        console.log("");
        console.log(pc.red(`✗ Preview failed`));
        process.exit(1);
      }

      // Success output
      const durationSec = (result.durationMs / 1000).toFixed(1);
      if (result.branch) {
        if (options.dryRun) {
          console.log(pc.green(`✓ Preview branch: ${result.branch.name}`));
          console.log(pc.dim("  (dry run - branch not created)"));
        } else {
          console.log(pc.green(`✓ Preview branch: ${result.branch.name}`));
          console.log(pc.dim(`  ID: ${result.branch.id}`));
          console.log(pc.dim(`  (use --json to get branch token)`));
        }
      }

      if (result.build) {
        console.log(
          pc.green(
            `✓ Generated ${result.build.datasourceCount} datasource(s), ${result.build.pipeCount} pipe(s)`
          )
        );
      }

      if (options.dryRun) {
        console.log(pc.dim("\n[Dry run] Resources not deployed to API"));
      } else if (options.check) {
        console.log(pc.green("\n✓ Resources validated with Tinybird API"));
      } else if (result.deploy) {
        if (result.deploy.result === "no_changes") {
          console.log(pc.green("✓ No changes detected - already up to date"));
        } else {
          console.log(pc.green("✓ Deployed to preview branch"));
        }
      }

      console.log("");
      console.log(pc.green(`✓ Preview completed in ${durationSec}s`));
    });

  // Dev command
  program
    .command("dev")
    .description("Watch for changes and sync with Tinybird")
    .option("--local", "Use local Tinybird container")
    .option("--branch", "Use Tinybird cloud with branches")
    .option(
      "--last-partition",
      '[DEPRECATED] Use `branch_data_on_create: "last_partition"` in tinybird.config.json. Copy the last partition of production data when creating a cloud branch.'
    )
    .action(async (options) => {
      // Determine devMode override
      let devModeOverride: DevMode | undefined;
      if (options.local) {
        devModeOverride = "local";
      } else if (options.branch) {
        devModeOverride = "branch";
      }

      try {
        const controller = await runDev({
          devModeOverride,
          lastPartition: options.lastPartition,
          onLoginComplete: (info) => {
            console.log("\nAuthentication successful!");
            if (info.workspaceName) {
              console.log(`  Workspace: ${info.workspaceName}`);
            }
            if (info.userEmail) {
              console.log(`  User: ${info.userEmail}`);
            }
            console.log("");
          },
          onBranchReady: (info) => {
            if (info.isLocal) {
              output.showBranchInfo({
                gitBranch: info.gitBranch,
                tinybirdBranch: info.localWorkspace?.name ?? null,
                wasCreated: info.wasCreated ?? false,
                dashboardUrl: info.dashboardUrl,
                isLocal: true,
              });
            } else if (info.isMainBranch) {
              console.log("On main branch - deploying to workspace\n");
            } else if (info.gitBranch) {
              output.showBranchInfo({
                gitBranch: info.gitBranch,
                tinybirdBranch: info.tinybirdBranch?.name ?? null,
                wasCreated: info.wasCreated ?? false,
                dashboardUrl: info.dashboardUrl,
                isLocal: false,
              });
            } else {
              console.log("Not in a git repository - deploying to workspace\n");
            }
          },
          onBuildStart: () => {
            output.highlight("Building...");
          },
          onBuildComplete: (result) => {
            if (!result.success) {
              // Show detailed errors if available
              const { deploy } = result;
              if (deploy?.errors && deploy.errors.length > 0) {
                output.showBuildErrors(deploy.errors);
              } else {
                const errorMessage = result.error ?? deploy?.error;
                output.error(errorMessage ?? "Build failed (run with TINYBIRD_DEBUG=1 for more info)");
              }
              output.showBuildFailure(true);
              return;
            }

            const { deploy } = result;

            if (deploy) {
              if (deploy.result === "no_changes") {
                output.showNoChanges();
              } else {
                // Show datasource changes
                if (deploy.datasources) {
                  for (const name of deploy.datasources.created) {
                    output.showResourceChange(`${name}.datasource`, "created");
                  }
                  for (const name of deploy.datasources.changed) {
                    output.showResourceChange(`${name}.datasource`, "changed");
                  }
                  for (const name of deploy.datasources.deleted) {
                    output.showResourceChange(`${name}.datasource`, "deleted");
                  }
                }

                // Show pipe changes
                if (deploy.pipes) {
                  for (const name of deploy.pipes.created) {
                    output.showResourceChange(`${name}.pipe`, "created");
                  }
                  for (const name of deploy.pipes.changed) {
                    output.showResourceChange(`${name}.pipe`, "changed");
                  }
                  for (const name of deploy.pipes.deleted) {
                    output.showResourceChange(`${name}.pipe`, "deleted");
                  }
                }

                output.showBuildSuccess(result.durationMs, true);
              }
            }
          },
          onSchemaValidation: (validation) => {
            if (validation.issues.length > 0) {
              output.info("Schema validation:");
              for (const issue of validation.issues) {
                if (issue.type === "error") {
                  output.error(`  ERROR [${issue.pipeName}]: ${issue.message}`);
                } else {
                  output.warning(
                    `  WARN [${issue.pipeName}]: ${issue.message}`
                  );
                }
              }
            }
          },
          onError: (err) => {
            output.error(err.message);
          },
        });

        console.log("Watching for changes... (Ctrl+C to stop)\n");

        // Handle shutdown
        const shutdown = async () => {
          console.log("\nShutting down...");
          await controller.stop();
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        // Keep process alive
        await new Promise(() => {});
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  // Branch command
  const branchCommand = new Command("branch").description(
    "Manage Tinybird branches"
  );

  branchCommand
    .command("list")
    .description("List all Tinybird branches")
    .action(async () => {
      const result = await runBranchList();

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (!result.branches || result.branches.length === 0) {
        console.log("No branches found.");
        return;
      }

      console.log("Branches:");
      result.branches.forEach((branch) => {
        console.log(`  - ${branch.name} (created: ${branch.created_at})`);
      });
    });

  branchCommand
    .command("status")
    .description("Show current branch status")
    .action(async () => {
      const result = await runBranchStatus();

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log("Branch Status:");
      console.log(`  Git branch: ${result.gitBranch ?? "(not in git repo)"}`);
      if (
        result.tinybirdBranchName &&
        result.tinybirdBranchName !== result.gitBranch
      ) {
        console.log(
          `  Tinybird branch name: ${result.tinybirdBranchName} (sanitized)`
        );
      }
      console.log(`  Main branch: ${result.isMainBranch ? "yes" : "no"}`);

      if (result.tinybirdBranch) {
        console.log(`  Tinybird branch: ${result.tinybirdBranch.name}`);
        console.log(`  Branch ID: ${result.tinybirdBranch.id}`);
        console.log(`  Created: ${result.tinybirdBranch.created_at}`);
        if (result.dashboardUrl) {
          console.log(`  Dashboard: ${result.dashboardUrl}`);
        }
      } else if (!result.isMainBranch && result.tinybirdBranchName) {
        console.log("  Tinybird branch: not created yet");
        console.log("  (Run 'npx tinybird dev' to create it)");
      }

      console.log(`  Cached token: ${result.hasCachedToken ? "yes" : "no"}`);
    });

  branchCommand
    .command("delete")
    .description("Delete a Tinybird branch")
    .argument("<name>", "Branch name to delete")
    .action(async (name) => {
      console.log(`Deleting branch '${name}'...`);

      const result = await runBranchDelete(name);

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`Branch '${name}' deleted successfully.`);
    });

  program.addCommand(branchCommand);

  // Clear command
  program
    .command("clear")
    .description("Clear the workspace or branch by deleting and recreating it")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--local", "Use local Tinybird container")
    .option("--branch", "Use Tinybird cloud with branches")
    .action(async (options) => {
      // Determine devMode override
      let devModeOverride: DevMode | undefined;
      if (options.local) {
        devModeOverride = "local";
      } else if (options.branch) {
        devModeOverride = "branch";
      }

      const modeLabel =
        devModeOverride === "local" ? "local workspace" : "branch";

      // Confirmation prompt unless --yes is passed
      if (!options.yes) {
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(
            `Are you sure you want to clear the ${modeLabel}? This will delete all resources. [y/N]: `,
            (ans) => {
              rl.close();
              resolve(ans);
            }
          );
        });

        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.log("Aborted.");
          return;
        }
      }

      console.log(`Clearing ${modeLabel}...`);

      const result = await runClear({ devModeOverride });

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      const typeLabel = result.isLocal ? "Workspace" : "Branch";
      console.log(`${typeLabel} '${result.name}' cleared successfully.`);
    });

  return program;
}

// Run CLI
const program = createCli();
program.parse();
