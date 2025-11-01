set -euo pipefail
set -x


ROOT="${1:?ROOT dir required}"
OUT="${2:?job dir required}"
THREADS="${3:-2}"

mkdir -p "$OUT/report"
LOG="$OUT/report/clang-tidy.txt"
FILES="$OUT/files.txt"

rm -f "$ROOT/compile_commands.json"

# Generate compile_commands
BUILD=""

if [[ ! -f "$ROOT/CMakeLists.txt" && ! -f "$ROOT/Makefile" && ! -f "$ROOT/makefile" ]]; then
  CAND="$(find "$ROOT" -maxdepth 3 -type f \
           \( -name CMakeLists.txt -o -name Makefile -o -name makefile \) | head -n 1)"
  if [[ -n "$CAND" ]]; then
    ROOT="$(dirname "$CAND")"
    echo "Adjusted ROOT=$ROOT (found build files deeper)" >>"$LOG"
  fi
fi


if [[ -f "$ROOT/CMakeLists.txt" ]]; then
  BUILD="$OUT/build"                  
  rm -rf "$BUILD";
  cmake -S "$ROOT" -B "$BUILD" -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_BUILD_TYPE=Release
elif [[ -f "$ROOT/Makefile" || -f "$ROOT/makefile" ]]; then
  BUILD="$OUT/build"
    rm -rf "$BUILD"; mkdir -p "$BUILD"
  ( cd "$ROOT" && bear --output "$BUILD/compile_commands.json" -- make -j"$THREADS" ) || true

  bear -- make -C "$ROOT" -j"$THREADS" || true
else
  echo "No CMakeLists.txt or Makefile found in $ROOT" | tee "$LOG"
  exit 2
fi

if [ ! -f "$BUILD/compile_commands.json" ]; then
  echo "compile_commands.json not found in $BUILD" | tee -a "$LOG"
  exit 3
fi

# File list
jq -r '.[].file' "$BUILD/compile_commands.json" | sort -u > "$FILES"

# Run clang-tidy
run-clang-tidy \
  -clang-tidy-binary /usr/local/bin/clang-tidy-nc \
  -p "$BUILD" -j "${THREADS:-2}" \
  -header-filter='^'"$ROOT"'/(src|include)/' \
  -checks='bugprone-*,modernize-*,performance-*,readability-*' \
  2>&1 | tee "$LOG"
CODE=${PIPESTATUS[0]}

# Generate summaryy
WARN=$(grep -E ":[0-9]+:[0-9]+: warning: " -c "$LOG" || true)
ERRS=$(grep -E ":[0-9]+:[0-9]+: error: "   -c "$LOG" || true)
printf '{ "warnings": %s, "errors": %s }\n' "${WARN:-0}" "${ERRS:-0}" > "$OUT/report/summary.json"

exit "$CODE"
