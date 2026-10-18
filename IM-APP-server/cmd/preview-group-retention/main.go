// preview-group-retention consumes normalized server snapshots on stdin. It
// never loads .env, connects to services, or performs a write/delete operation.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"im-app-server/internal/media"
)

func preview(input io.Reader, output io.Writer) error {
	data, err := io.ReadAll(io.LimitReader(input, (64<<20)+1))
	if err != nil || len(data) > 64<<20 {
		return fmt.Errorf("snapshot exceeds 64 MiB or could not be read")
	}
	var snapshot media.RetentionSnapshot
	if !json.Valid(data) {
		return fmt.Errorf("invalid JSON snapshot")
	}
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return fmt.Errorf("invalid snapshot fields")
	}
	plan, err := media.PlanGroupRetention(snapshot)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(plan)
}

func main() {
	if err := preview(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
