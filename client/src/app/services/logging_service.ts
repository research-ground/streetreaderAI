/*
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
 */

import { Injectable, inject } from '@angular/core';
import { CommandService, AppCommand } from './command_service';

export interface LogEntry {
  timestamp: string;
  event: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class LoggingService {
  private readonly STORAGE_KEY = 'street_reader_events_log';
  private commandService = inject(CommandService);

  constructor() {
    // Automatically log all commands from the CommandService
    this.commandService.commands$.subscribe(command => {
      this.logEvent(command);
    });
  }

  /**
   * Logs an event with a timestamp to localStorage.
   */
  logEvent(event: unknown) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      event: event
    };

    const logs = this.getLogs();
    logs.push(entry);

    // Keep only the last 500 entries to prevent localStorage from filling up
    const trimmedLogs = logs.slice(-500);

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmedLogs));
    } catch (err) {
      console.error('Failed to save log to localStorage:', err);
    }
  }

  /**
   * Retrieves all logs from localStorage.
   */
  getLogs(): LogEntry[] {
    const storedLogs = localStorage.getItem(this.STORAGE_KEY);
    if (!storedLogs) return [];
    try {
      return JSON.parse(storedLogs);
    } catch (err) {
      console.error('Failed to parse logs from localStorage:', err);
      return [];
    }
  }

  /**
   * Clears all stored logs.
   */
  clearLogs() {
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
