# 🔥 Foundry Gas Diff Action

Easily compare gas snapshot generated by Foundry and get comparison in your pull request comments.

![image](https://github.com/user-attachments/assets/3ad43a2a-0b7e-4da1-b6d5-0354e5f6541d)

## Getting started

### Overview

This GitHub Action compares gas reports from two branches: the base branch (e.g., `main`) and the PR branch. It generates a detailed mardown report of the gas usage and posts it as a comment on the pull request. You can also choose whether to include fuzz tests in the report.

### Usage

To use this action in your GitHub Actions workflow, follow these steps:

1. **Add the Action to Your Workflow**

Create or update a GitHub Actions workflow file (e.g., `.github/workflows/gas-diff.yml`) in your repository. Add the following configuration:

```yaml
name: Generate Gas Diff

on:
  push:
    branches:
      - main
  pull_request:
    paths:
        # Optionally configure to run only for changes in specific files. For example:
        # paths:
        # - .gas-snapshot
        # - src/**
        # - test/**
        # - foundry.toml
        # - remappings.txt

jobs:
  gas-diff:
    runs-on: ubuntu-latest
    permissions: write-all
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Fetch all branches
        run: git fetch --all

      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
        with:
          version: nightly

      - name: Install Dependencies
        run: forge install

      - name: Generate gas diff
        uses: atarpara/foundry-snapshot-diff@v0.4
        with:
          # Optionally configure to run only for changes in specific files. For example:
          # token: ${{ secrets.GITHUB_TOKEN }}
          # base: main
          # head: ${{ github.head_ref }}
          # include-fuzz-tests: true
          # fresh-snapshots: true
          # include-new-contracts: true
        id : gas_diff
      
      - name: Add gas diff to sticky comment
        if: github.event_name == 'pull_request' || github.event_name == 'pull_request_target'
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          # delete the comment in case changes no longer impact gas costs
          delete: ${{ !steps.gas_diff.outputs.markdown }}
          message: ${{ steps.gas_diff.outputs.markdown }}

```

## Options
### `base` _{string}_

The gas diff reference branch name, used to fetch the previous gas report to compare the freshly generated gas report to.

_Defaults to: `${{ github.base_ref || github.ref_name }}`_

### `head` _{string}_

The gas diff target branch name, used to upload the freshly generated gas report.

_Defaults to: `${{ github.head_ref || github.ref_name }}`_

### `token` _{string}_

The github token allowing the action to upload and download gas reports generated by foundry. You should not need to customize this, as the action already has access to the default Github Action token.

_Defaults to: `${{ github.token }}`_


### `include-new-contracts` _{bool}_

Includes gas reports for new contracts in the generated report. This parameter allows you to control whether or not gas usage details for new contracts (contracts not present in the base snapshot) are included in the final report.

_Defaults to: `false`_

### `include-fuzz-test` _{bool}_

Determines whether to include fuzz test results in the gas report. The gas values will compare the average gas usage by each fuzz test.


_Defaults to: `false`_


### `fresh-shapshots` _{bool}_


Specifies whether to generate a fresh `.gas-snapshot` or fetch an existing one. If set to 'true', a new gas snapshot will be generated using the `forge snapshot` command. If set to 'false', the gas snapshot will be fetched directly from branch. 

_Defaults to: `false`_

## Acknowledgements

This repository is inspired by or directly modified from many sources, primarily:

- [foundry-gas-diff](https://github.com/Rubilmax/foundry-gas-diff)

