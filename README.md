# Shared Workflows

This repository provides GitHub workflows that can be integrated into other
projects to provide Vulcan code consistency reviews.

## Deployment

Here is a very simple workflow example that triggers Vulcan reviews on new pull
requests.

Importantly, it requires the target repository to have defined the
`GEMINI_API_KEY` secret.

```yaml
name: Vulcan Review

on:
  pull_request:
    types:
      - 'opened'

jobs:
  review:
    uses: VulcanToolkit/github-action/.github/workflows/vulcan-review.yml@main
    permissions:
      contents: 'read'
      id-token: 'write'
      issues: 'write'
      pull-requests: 'write'
    with:
      additional_context: ''
      requested_pr_review: 'true'
      requested_commit_review: 'false'
    secrets:
      gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

More complicated integrations could use a dispatcher to call Vulcan with
different options, e.g. in response to a pull request comment that requests a
specific type of review.
