# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.84] - 2026-09-08

### Changed

- Branch creation job polling now waits up to 5 minutes (60 attempts at a 5s interval), up from 2 minutes at a 1s interval.

## [0.0.83] - 2026-07-20

### Fixed

- Query params that are plain objects (including `p.json()` values) are now JSON-serialized instead of becoming `"[object Object]"` via `String(value)`. Pre-stringified JSON strings and primitive params are unchanged.

## [0.0.82] - 2026-07-15

### Changed

- Cloud branches are now created empty by default: when `branch_data_mode` is omitted from the config, no production data is copied into new branches. This restores the default behavior of `0.0.78` and earlier; only versions `0.0.79` through `0.0.81` copied the last partition of production data into branches by default. Set `branch_data_mode: "last_partition"` in your config to keep copying production data into branches. 

## [0.0.81] - 2026-07-07

### Changed

- Deployment process now uses server-side auto-promotion: instead of polling and manually switching the deployment live or deleting the previous one, this is handled automatically. The `tb deploy` command now accepts `--wait` / `--no-wait` and `--auto` / `--no-auto` flags (both default to `true`), for consistent behavior with the CLI.

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
