"""
src/packing
---------------------------------------------------------
Independent pipeline for the Packing & Dispatch department dashboard.

Deliberately separate from src/pipeline.py (the Production / Spool
Ageing pipeline): different source workbooks, different shape, and -
per project decision - no join against master_spools.json for now.
Both pipelines share only generic helpers (logger, config_loader)
and follow the same design principle: all business logic/aggregation
happens here in Python; the dashboard (website/packing-dispatch.html
+ website/js/packing-*.js) only ever reads the JSON this writes.
"""
