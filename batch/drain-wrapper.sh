#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FULL_INPUT="$SCRIPT_DIR/batch-input.full.tsv"
INPUT="$SCRIPT_DIR/batch-input.tsv"
STATE="$SCRIPT_DIR/batch-state.tsv"
BATCH_SIZE=5
LOG="$SCRIPT_DIR/drain-wrapper.log"
DONE_MARKER="$SCRIPT_DIR/drain-wrapper.done"

exec > >(tee -a "$LOG") 2>&1

rm -f "$DONE_MARKER"
# Only snapshot if full backup doesn't already exist (safe to restart)
if [[ ! -f "$FULL_INPUT" ]]; then
    cp "$INPUT" "$FULL_INPUT"
fi
HEADER=$(head -1 "$FULL_INPUT")
total_rows=$(tail -n +2 "$FULL_INPUT" | wc -l | tr -d ' ')
echo "=== Drain started $(date) | $total_rows total rows | ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-unset} ==="

batch_num=0
while true; do
    # Get pending IDs: in full input but not yet "completed" in state
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
        echo "=== All batches complete at $(date). Restoring full input. ==="
        cp "$FULL_INPUT" "$INPUT"
        break
    fi

    BATCH_IDS=$(printf '%s\n' "$PENDING_IDS" | head -n "$BATCH_SIZE")
    batch_count=$(printf '%s\n' "$BATCH_IDS" | awk 'NF' | wc -l | tr -d ' ')
    remaining_after=$((total_pending - batch_count))
    batch_num=$((batch_num + 1))
    total_batches=$(( (total_pending + BATCH_SIZE - 1) / BATCH_SIZE ))

    echo "=== Batch $batch_num/$total_batches: IDs [$(printf '%s\n' "$BATCH_IDS" | tr '\n' ',' | sed 's/,$//')]  |  $remaining_after remaining after ==="

    # Write batch-input.tsv with only these IDs
    printf '%s\n' "$HEADER" > "$INPUT"
    while IFS= read -r bid; do
        [[ -z "$bid" ]] && continue
        awk -F'\t' -v id="$bid" 'FNR>1 && $1==id' "$FULL_INPUT" >> "$INPUT"
    done <<< "$BATCH_IDS"

    ANTHROPIC_MODEL=claude-sonnet-4-6 bash "$SCRIPT_DIR/batch-runner.sh" --parallel 5

    echo "=== Batch $batch_num done at $(date) ==="
done

touch "$DONE_MARKER"
echo "=== Drain complete at $(date) ==="
