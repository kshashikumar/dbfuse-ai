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

# Sync environment into .env so the UI reflects current container settings
ENV_FILE="/app/.env"
TMP_ENV_FILE="/app/.env.tmp"
keys="AI_MODEL AI_API_KEY AI_PROVIDER PORT DBFUSE_USERNAME DBFUSE_PASSWORD"

# Helper to read existing value from .env
get_existing_val() {
	key="$1"
	if [ -f "$ENV_FILE" ]; then
		# Extract the value after KEY=
		sed -n "s/^${key}=\(.*\)$/\1/p" "$ENV_FILE" | tail -n 1
	fi
}

mkdir -p /app
rm -f "$TMP_ENV_FILE"
touch "$TMP_ENV_FILE"

for k in $keys; do
	env_val=$(eval echo "\${$k}")
	if [ -n "$env_val" ]; then
		val="$env_val"
	else
		existing=$(get_existing_val "$k")
		if [ -n "$existing" ]; then
			val="$existing"
		else
			case "$k" in
				PORT) val="5000" ;;
				DBFUSE_USERNAME) val="root" ;;
				DBFUSE_PASSWORD) val="root" ;;
				*) val="" ;;
			esac
		fi
	fi
	# Quote if contains spaces or equals
	if echo "$val" | grep -qE '[ =]'; then
		echo "$k=\"$val\"" >> "$TMP_ENV_FILE"
	else
		echo "$k=$val" >> "$TMP_ENV_FILE"
	fi
done

mv "$TMP_ENV_FILE" "$ENV_FILE"
echo "- Synchronized /app/.env with runtime environment"

exec node src/index.js