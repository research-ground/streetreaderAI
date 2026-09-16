"""
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 """

import logging
import functools
import time
import os
from logging.handlers import RotatingFileHandler
from server.core.config import config


class LocalMultilineFormatter(logging.Formatter):
    """
    Formatter for local use that handles multiline messages by
    prefixing each line with the log level.
    """
    def format(self, record):
        message = record.getMessage()

        lines = message.splitlines()
        if len(lines) > 1:
            header = f"[{record.levelname}] "
            formatted_lines = [f"{header}{lines[0]}"]
            continuation = f"[{record.levelname}] | "
            for line in lines[1:]:
                formatted_lines.append(f"{continuation}{line}")
            return "\n".join(formatted_lines)

        return super().format(record)

# Initialize Logger
logger = logging.getLogger("StreetReaderAI")
handlers = []

local_fmt = '[%(levelname)s] %(message)s'
formatter = LocalMultilineFormatter(local_fmt)

stream_handler = logging.StreamHandler()
stream_handler.setFormatter(formatter)
handlers.append(stream_handler)

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log_dir = os.path.join(base_dir, "logs")
if not os.path.exists(log_dir):
    os.makedirs(log_dir)

log_path = os.path.join(log_dir, "app.log")
file_handler = RotatingFileHandler(
    filename=log_path,
    maxBytes=1024 * 1024 * 5,  # 5MB
    backupCount=5
)
file_handler.setFormatter(formatter)
handlers.append(file_handler)

for h in handlers:
    logger.addHandler(h)

if config.LOG_LEVEL == "VERBOSE":
    logger.setLevel(logging.DEBUG)
else:
    logger.setLevel(logging.ERROR)

logger.info(f"Logger initialized. Logging to console and {os.path.join('logs', 'app.log')}")

def log_call(func):
    """Decorator to log function entry, exit, execution time, and errors."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        func_name = f"{func.__module__}.{func.__name__}"
        logger.debug(f"Entering: {func_name}")

        start_time = time.perf_counter()
        try:
            result = func(*args, **kwargs)
            end_time = time.perf_counter()
            duration = end_time - start_time
            logger.debug(f"Exiting: {func_name} (took {duration:.4f}s)")
            return result
        except Exception as e:
            end_time = time.perf_counter()
            duration = end_time - start_time
            logger.error(f"Exception in {func_name} after {duration:.4f}s: {str(e)}")
            raise
    return wrapper
