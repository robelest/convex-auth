#!/bin/bash
set -e

bun run --cwd ../.. convex:run tests:init
npx playwright test
