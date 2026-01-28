# Example Service Records

These JSON files are real service records captured while dogfooding
the Nea Agora Service Recorder.

They are provided as illustrative artifacts, not ground truth.

## Notes

- Metrics and counters evolved between versions (v0.4 → v0.5).
- Some fields may be missing or zero in older records.
- Session attribution can fragment when switching chats or tabs.
- Records are observational only: no scoring, no evaluation.

## Files

- `service_record__chatgpt_minimal.json`  
  Minimal example showing schema and structure.

- `service_record__chatgpt_realistic.json`  
  A real multi-step session with iteration, copying, and feedback.

- `service_record__chatgpt_full_raw.json`  
  Full raw capture. Messy by design. Included for completeness.
