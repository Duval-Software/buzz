#!/usr/bin/env bash
# Compare feature branches with their integration branch, not the upstream mirror.
set -euo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)
base_branch=main
case "$(git remote get-url origin)" in
  *Duval-Software/buzz*) base_branch=creatorhive-web ;;
esac
if [ "$branch" = "$base_branch" ] || [ "$branch" = "HEAD" ]; then
  exit 0
fi

git fetch --quiet origin "$base_branch"
git rev-parse --verify --quiet "origin/$base_branch" >/dev/null || exit 0

base=$(git merge-base HEAD "origin/$base_branch")
if [ "$base" = "$(git rev-parse "origin/$base_branch")" ]; then
  exit 0
fi

overlap=$(comm -12 \
  <(git diff --name-only "$base" "origin/$base_branch" -- | sort) \
  <(git diff --name-only "$base" HEAD -- | sort))

if [ -z "$overlap" ]; then
  exit 0
fi

{
  echo "Branch is behind origin/$base_branch, which changed files this branch also touches:"
  echo "$overlap" | sed 's/^/  /'
  echo "Run 'git merge origin/$base_branch',"
  echo "resolve, re-run checks, then push."
} >&2
exit 1
