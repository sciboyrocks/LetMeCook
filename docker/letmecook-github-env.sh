# Authenticates the gh CLI from the LetMeCook GitHub connection, so `gh` works
# in any project's terminal without a separate login. Git itself is handled by
# the git-credential-letmecook helper.

if [ -z "$GH_TOKEN" ] && [ -n "$LETMECOOK_API_KEY" ]; then
    GH_TOKEN=$(curl -fsS --max-time 3 \
        -H "X-API-Key: $LETMECOOK_API_KEY" \
        "${LETMECOOK_URL:-http://api:3000}/api/github/token" 2>/dev/null |
        sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    [ -n "$GH_TOKEN" ] && export GH_TOKEN || unset GH_TOKEN
fi
