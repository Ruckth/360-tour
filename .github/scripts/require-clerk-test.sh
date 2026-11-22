#!/usr/bin/env bash
set -eu
[[ "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" == pk_test_* ]]
[[ "${CLERK_SECRET_KEY:-}" == sk_test_* ]]
[[ -n "${CLERK_JWT_ISSUER_DOMAIN:-}" ]]
