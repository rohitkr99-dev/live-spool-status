"""
src/quality
---------------------------------------------------------
Independent pipeline for the Quality Assurance/Control department
dashboard - rework analysis from the Production Rework Data
workbook (data/upload/quality/).

Deliberately separate from src/pipeline.py (the Projects pipeline),
same principle as src/packing/ and src/production/: all business
logic/aggregation happens here in Python; the dashboard
(website/quality.html + website/js/quality-*.js) only ever reads
the JSON this writes. The one link back to the Projects pipeline is
one-directional and lives over there, not here - see src/merge.py
-> apply_rework_pdqc_override(), which reuses the same Rework Data
workbook (via src/reader.py -> read_rework(), not this package) to
override PDQC on the Master Spool Dataset.
"""
