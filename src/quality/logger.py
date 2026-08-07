"""
src/quality/logger.py
---------------------------------------------------------
Separate logger for the Quality Assurance/Control dashboard
pipeline (rework charts - see src/quality/pipeline.py) so its log
lines don't interleave confusingly with the Projects pipeline's
logs/application.log or the other departments' own log files. Same
setup pattern as src/production/logger.py / src/packing/logger.py.
"""

from pathlib import Path
import logging


def _setup_logger() -> logging.Logger:
    log_folder = Path("logs")
    log_folder.mkdir(exist_ok=True)

    log_file = log_folder / "quality.log"

    logger = logging.getLogger("QualityDashboard")

    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger


logger = _setup_logger()
