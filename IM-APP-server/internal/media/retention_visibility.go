package media

import "errors"

var ErrRetentionNonPrefix = errors.New("retention plan is not a safe removable prefix")

func planQuota(plan RetentionPlan) int {
	if plan.MaxMessages > 0 {
		return NormalizeRetentionPolicy(RetentionPolicy{MaxMessages: plan.MaxMessages}).MaxMessages
	}
	return GroupRetentionCount
}

// RetentionMinSeq turns a recomputed plan into a monotonic history boundary.
// Do not advance across a retained message, including when timestamps arrive
// out of order. A zero result means there is nothing to remove. Hidden controls
// do not consume the quota; the authoritative adapter must keep handling them.
func RetentionMinSeq(plan RetentionPlan) (int64, error) {
	quota := planQuota(plan)
	if plan.Mode != "preview_only" || plan.Watermark < 0 || plan.Watermark >= 1<<53 || plan.OverCountThrough < 0 ||
		(plan.OverCountThrough > 0 && (plan.OverCountThrough >= plan.Watermark || len(plan.Kept)+len(plan.Candidates) < quota)) {
		return 0, ErrRetentionNonPrefix
	}
	if len(plan.Candidates) == 0 && plan.OverCountThrough == 0 {
		return 0, nil
	}
	boundary := plan.Watermark + 1
	for _, seq := range plan.Kept {
		if seq <= plan.OverCountThrough || seq > plan.Watermark {
			return 0, ErrRetentionNonPrefix
		}
		boundary = min(boundary, seq)
	}
	for _, candidate := range plan.Candidates {
		// Candidates must be both over-age and over-count (union keep rule).
		if candidate.Seq <= plan.OverCountThrough || candidate.Seq >= boundary || !candidate.OverAge || !candidate.OverCount {
			return 0, ErrRetentionNonPrefix
		}
	}
	if boundary >= 1<<53 {
		return 0, ErrRetentionNonPrefix
	}
	return boundary, nil
}
