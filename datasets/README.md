# Datasets

The four datasets DocBot TeleMed is trained and seeded on, shipped in this
folder so the project is reproducible from a fresh clone.

| File | Rows | Size | Used for | Import command |
|---|---|---|---|---|
| `Final_Augmented_dataset_Diseases_and_Symptoms.csv.gz` | 246,945 | 1.6 MB (182 MB uncompressed) | Disease–symptom knowledge base (773 diseases, 377 symptoms, 5,389 links) | `npm run kb:import --workspace server` |
| `Symptom2Disease.csv` | 1,200 | 225 KB | Naive Bayes text classifier — 24 classes of patient wording | `npm run kb:text-import --workspace server` |
| `doc_bot_medical_symptom_training_dataset.csv` | 144 | 60 KB | Curated triage layer — urgency levels, red flags, recommended specialties | `npm run kb:triage-import --workspace server` |
| `doc_bot_india_doctor_directory_synthetic.csv` | 6,210 | 1.6 MB | Bookable doctor directory (30 specialties × 69 cities) | `npm run doctors:import --workspace server` |

All four resolve automatically — the import scripts default to this folder, so
no path arguments are needed from a fresh clone. Each script still accepts an
explicit path (or an env var: `KB_CSV_PATH`, `KB_TEXT_CSV_PATH`,
`KB_TRIAGE_CSV_PATH`) if you keep your copy elsewhere.

## The big one, explained

`Final_Augmented_dataset_Diseases_and_Symptoms.csv` is a wide binary matrix:
one row per disease occurrence, one column per symptom, cells are `0`/`1`.
At 182 MB it exceeds GitHub's 100 MB file limit, so it ships **gzipped** —
CSV compresses extremely well (this one to 1.6 MB, a ~114× ratio).
`kb-import.ts` decompresses it on the fly while streaming, so you never need
to unpack it manually. If you want the plain CSV anyway:

```bash
cd datasets
gzip -d -k Final_Augmented_dataset_Diseases_and_Symptoms.csv.gz
```

## Re-running imports

Every import is **idempotent** — each one TRUNCATEs its target tables and
rebuilds from the CSV, so re-running is always safe:

```bash
npm run kb:import --workspace server        # ~3 s, rebuilds kb_diseases/kb_symptoms/kb_disease_symptom
npm run kb:text-import --workspace server   # ~0.2 s, rebuilds kb_text_classes
npm run kb:triage-import --workspace server # instant, rebuilds kb_triage_conditions
npm run doctors:import --workspace server   # rebuilds the 6,210 directory doctors (replaces previous import)
```

After importing, verify with the evaluation harness:

```bash
npm run kb:eval --workspace server   # hold-out top-1 / top-3 / specialty accuracy
```

## Data provenance & ethics

- The doctor directory is **synthetic** (`is_synthetic_demo_record` column) —
  names, fees and ratings are fabricated for demo purposes. Real booking
  targets real doctors only through the app's registration + admin approval flow.
- All patient-facing demo data is fictional; passwords in the seed are bcrypt
  hashes; verification documents (uploads/) are git-ignored and never committed.
- The disease–symptom dataset describes symptom co-occurrence statistics, not
  patient records — it contains no personal data. DocBot's output is guidance,
  never a diagnosis (see the medical safety notice in the root README).
