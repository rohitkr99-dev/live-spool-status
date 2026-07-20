"""
logger.py
---------------------------------
Central logging module for the
Live Spool Status & Ageing System.

All modules should use this logger
instead of creating their own.
"""

from pathlib import Path
import logging


def setup_logger() -> logging.Logger:
    """
    Create and configure the application logger.

    Returns
    -------
    logging.Logger
        Configured logger instance.
    """

    # Create logs folder if it doesn't exist
    log_folder = Path("logs")
    log_folder.mkdir(exist_ok=True)

    log_file = log_folder / "application.log"

    logger = logging.getLogger("LiveSpoolStatus")

    # Prevent duplicate log entries
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # Write logs to file
    file_handler = logging.FileHandler(
        log_file,
        encoding="utf-8"
    )
    file_handler.setFormatter(formatter)

    # Also display logs in the terminal
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger


# Create a shared logger instance
logger = setup_logger()
