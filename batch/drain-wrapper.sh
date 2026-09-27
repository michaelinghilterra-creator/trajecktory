#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FULL_INPUT="$SCRIPT_DIR/batch-input.full.tsv"
INPUT="$SCRIPT_DIR/batch-input.tsv"
STATE="$SCRIPT_DIR/batch-state.tsv"
BATCH_SIZE=5
LOG="$SCRIPT_DIR/drain-wrapper.log"
DONE_MARKER="$SCRIPT_DIR/drain-wrapper.done"
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-6}"
export ANTHROPIC_MODEL
MAX_RETRIES="${BATCH_MAX_RETRIES:-2}"
FRESH=false
RUNNER_FLAGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --fresh) FRESH=true; shift ;;
        --) shift; RUNNER_FLAGS=("$@"); break ;;
        *) echo "Unknown option: $1"; exit 2 ;;
    esac
done

exec > >(tee -a "$LOG") 2>&1

rm -f "$DONE_MARKER"
if [[ "$FRESH" == "true" ]]; then
    cp "$INPUT" "$FULL_INPUT"
elif [[ ! -f "$FULL_INPUT" ]]; then
    cp "$INPUT" "$FULL_INPUT"
elif [[ "$INPUT" -nt "$FULL_INPUT" ]]; then
    input_rows=$(tail -n +2 "$INPUT" | awk 'NF' | wc -l | tr -d ' ')
    if [[ "$input_rows" -gt 5 ]]; then
        echo "WARNING: $INPUT is newer than resume snapshot $FULL_INPUT; use --fresh to replace it"
    fi
fi

HEADER=$(head -1 "$FULL_INPUT")
total_rows=$(tail -n +2 "$FULL_INPUT" | wc -l | tr -d ' ')
echo "=== Drain started $(date) | $total_rows total rows | ANTHROPIC_MODEL=$ANTHROPIC_MODEL ==="

write_input_for_ids() {
    local ids="$1"
    printf '%s\n' "$HEADER" > "$INPUT"
    while IFS= read -r bid; do
        [[ -z "$bid" ]] && continue
        awk -F'\t' -v id="$bid" 'FNR>1 && $1==id' "$FULL_INPUT" >> "$INPUT"
    done <<< "$ids"
}

batch_num=0
while true; do
    if [[ -f "$STATE" ]]; then
        PENDING_IDS=$(awk -F'\t' '
            NR==FNR { if ($3=="completed" || $3=="failed" || $3=="skipped") done[$1]=1; next }
            FNR>1 && !done[$1] { print $1 }
        ' "$STATE" "$FULL_INPUT" | sort -n)
    else
        PENDING_IDS=$(tail -n +2 "$FULL_INPUT" | awk -F'\t' '{print $1}' | sort -n)
    fi

    total_pending=$(printf '%s\n' "$PENDING_IDS" | awk 'NF' | wc -l | tr -d ' ')
    if [[ "$total_pending" -eq 0 ]]; then
        echo "=== Main drain complete at $(date). Restoring full input. ==="
        cp "$FULL_INPUT" "$INPUT"
        break
    fi

    BATCH_IDS=$(printf '%s\n' "$PENDING_IDS" | head -n "$BATCH_SIZE")
    batch_count=$(printf '%s\n' "$BATCH_IDS" | awk 'NF' | wc -l | tr -d ' ')
    remaining_after=$((total_pending - batch_count))
    batch_num=$((batch_num + 1))
    total_batches=$(( (total_pending + BATCH_SIZE - 1) / BATCH_SIZE ))
    echo "=== Batch $batch_num/$total_batches: IDs [$(printf '%s\n' "$BATCH_IDS" | tr '\n' ',' | sed 's/,$//')] | $remaining_after remaining after ==="
    write_input_for_ids "$BATCH_IDS"
    bash "$SCRIPT_DIR/batch-runner.sh" --parallel 5 "${RUNNER_FLAGS[@]}"
    echo "=== Batch $batch_num done at $(date) ==="
done

if [[ -f "$STATE" ]]; then
    RETRY_IDS=$(awk -F'\t' -v max="$MAX_RETRIES" 'FNR>1 && $3=="failed" && ($9+0)<max { print $1 }' "$STATE" | sort -n)
else
    RETRY_IDS=""
fi

retry_batch=0
while [[ -n "$(printf '%s\n' "$RETRY_IDS" | awk 'NF')" ]]; do
    BATCH_IDS=$(printf '%s\n' "$RETRY_IDS" | awk 'NF' | head -n "$BATCH_SIZE")
    RETRY_IDS=$(printf '%s\n' "$RETRY_IDS" | awk 'NF' | tail -n +$((BATCH_SIZE + 1)))
    retry_batch=$((retry_batch + 1))
    echo "=== Retry batch $retry_batch: IDs [$(printf '%s\n' "$BATCH_IDS" | tr '\n' ',' | sed 's/,$//')] ==="
    write_input_for_ids "$BATCH_IDS"
    bash "$SCRIPT_DIR/batch-runner.sh" --parallel 5 --retry-failed "${RUNNER_FLAGS[@]}"
done

cp "$FULL_INPUT" "$INPUT"
rm -f "$FULL_INPUT"
touch "$DONE_MARKER"

completed=0
failed=0
skipped=0
if [[ -f "$STATE" ]]; then
    completed=$(awk -F'\t' 'FNR>1 && $3=="completed" { n++ } END { print n+0 }' "$STATE")
    failed=$(awk -F'\t' 'FNR>1 && $3=="failed" { n++ } END { print n+0 }' "$STATE")
    skipped=$(awk -F'\t' 'FNR>1 && $3=="skipped" { n++ } END { print n+0 }' "$STATE")
fi
echo "DRAIN_RESULT completed=$completed failed=$failed skipped=$skipped"
echo "=== Drain complete at $(date) ==="
