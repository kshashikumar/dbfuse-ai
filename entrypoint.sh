#!/bin/sh

set -e

echo "Starting DBFuse AI..."
if [ -n "$PORT" ]; then
	echo "- PORT: $PORT"
else
	echo "- PORT: (default 5000)"
fi

if [ -n "$DBFUSE_USERNAME" ] && [ -n "$DBFUSE_PASSWORD" ]; then
	echo "- Basic Auth: enabled"
else
	echo "- Basic Auth: disabled (set DBFUSE_USERNAME and DBFUSE_PASSWORD to enable)"
fi

if [ -n "$AI_PROVIDER" ] || [ -n "$AI_MODEL" ] || [ -n "$AI_API_KEY" ]; then
	echo "- AI: provider=$AI_PROVIDER model=$AI_MODEL key=$( [ -n "$AI_API_KEY" ] && echo set || echo not-set )"
else
	echo "- AI: disabled (configure AI_PROVIDER, AI_MODEL, AI_API_KEY to enable)"
fi

exec node src/index.js