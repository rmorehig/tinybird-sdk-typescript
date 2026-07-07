# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `branch_data_mode: "none"` config option to create cloud branches without copying any production data.

### Changed

- `branch_data_mode` now defaults to `"none"`: cloud branches are created empty unless `"last_partition"` is set explicitly. This restores the pre-`branch_data_mode` behavior and avoids branch-creation timeouts on workspaces with large partitions. Set `branch_data_mode: "last_partition"` in your config to keep copying production data into branches.

## [0.0.80] - 2026-06-24

### Security

- Bumped `esbuild` from `^0.24.0` to `^0.25.0` to resolve GHSA-67mh-4wv8-2f99 (esbuild dev-server CORS), flagged by Dependabot at moderate severity.

## [0.0.79] - 2026-06-23

### Added

- DynamoDB connector support via `defineDynamoDBConnection` and datasource `dynamodb` ingestion config.
- Migration and code generation support for DynamoDB connections and datasources.

### Changed

- Cloud branch creation now reads `branch_data_mode` from `tinybird.config.json` and passes it to the branch create API.
- Branch create API options now use `branch_data_mode` (query param `data`) instead of `lastPartition`.
- `BranchDataMode` is now a string type union instead of an enum.

## [0.0.78] - 2026-06-15

### Changed

- Updated Tinybird CLI behavior to match the `4.6.1` branch-management changes.
- Branch data config handling now uses `branch_data_mode`; legacy `branch_data_on_create` now triggers an explicit migration error.
- `branch_data_mode` now only accepts `last_partition` as a user-facing value.
- In local development mode, branch data mode warnings are now shown only when `branch_data_mode` is explicitly set in `tinybird.config.json`.
- `tinybird branch create` and `tinybird branch clear` now show a deprecation warning (instead of failing) when `--ignore-datasource` is passed, then continue by ignoring that flag.
