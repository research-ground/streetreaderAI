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

import { Component, inject, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { StateService } from '../../services/state_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { LoggingService } from '../../services/logging_service';

// Note: This component was originally a standard 'Welcome' screen.
// It has been repurposed into a 'First Run' preset selector.
// The option to "show this message when you start" has been explicitly removed,
// as this screen should only appear once until data is reset.

@Component({
  selector: 'app-first-run-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <div class="first-run-container">
      <h2 mat-dialog-title>Choose Control Scheme</h2>

      <mat-dialog-content #scrollTarget>
        <p class="intro-text">You can choose default settings depending on how you will use StreetReaderAI. 
           You can change settings at any time by pressing <kbd>Shift</kbd>+<kbd>/</kbd></p>

        <div class="presets-grid">
          <!-- Screen Reader Column -->
          <div class="preset-column">
            <h3>Screen reader user</h3>
            <ul>
              <li>Self-voicing off, your screen reader will read text (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> to toggle)</li>
              <li><kbd>Alt</kbd>+<kbd>Shift</kbd> as your hotkey activator</li>
              <li>Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> to set a location and <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> to chat with the agent</li>
              <li>Use the arrow keys, or <kbd>Alt</kbd>+<kbd>Shift</kbd> arrow keys, to move</li>
            </ul>
            <button mat-flat-button color="primary" (click)="selectPreset('screen-reader')">
              Select screen reader-optimized controls
            </button>
          </div>

          <!-- Default Column -->
          <div class="preset-column">
            <h3>Default</h3>
            <ul>
              <li>Self-voicing on, StreetReaderAI will read text aloud (press <kbd>Esc</kbd> to pause and <kbd>Alt</kbd>+<kbd>S</kbd> to toggle)</li>
              <li><kbd>Alt</kbd> as your hotkey activator</li>
              <li>Press <kbd>Alt</kbd>+<kbd>L</kbd> to set a location and <kbd>Alt</kbd>+<kbd>K</kbd> to chat with the agent</li>
              <li>Use the arrow keys to move</li>
            </ul>
            <button mat-flat-button color="primary" (click)="selectPreset('default')">
              Select default controls
            </button>
          </div>
        </div>
      </mat-dialog-content>
    </div>
  `,  styles: [`
    .first-run-container { padding: 8px; }
    h2 { margin-bottom: 8px; font-size: 24px; font-weight: 500; }
    .intro-text { margin-bottom: 24px; font-size: 16px; color: #444; }
    
    .presets-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-top: 16px;
    }

    .preset-column {
      display: flex;
      flex-direction: column;
      padding: 0 8px;
    }

    .preset-column h3 {
      margin-top: 0;
      font-size: 18px;
      color: #1976d2;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }

    .preset-column ul {
      margin: 0 0 24px 0;
      padding-left: 20px;
      flex: 1;
    }

    .preset-column li {
      margin-bottom: 12px;
      line-height: 1.4;
      font-size: 15px;
    }

    button { width: 100%; padding: 8px; }

    kbd {
      background-color: #fff;
      border-radius: 3px;
      border: 1px solid #ccc;
      box-shadow: 0 1px 0 rgba(0,0,0,0.2);
      color: #333;
      display: inline-block;
      font-size: 0.9em;
      font-weight: 700;
      line-height: 1;
      padding: 2px 4px;
      white-space: nowrap;
    }
  `]
})
export class WelcomeDialogComponent implements AfterViewInit {
  private stateService = inject(StateService);
  private speechService = inject(SpeechOutputService);
  private loggingService = inject(LoggingService);
  private readonly dialogRef = inject(MatDialogRef<WelcomeDialogComponent>);

  @ViewChild('scrollTarget') private readonly scrollTarget!: ElementRef;

  constructor() {
    // Escape key handled by MatDialog, but we want it to select 'default'
    this.dialogRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') {
        this.selectPreset('default');
      }
    });

    // Handle backdrop click as well
    this.dialogRef.backdropClick().subscribe(() => {
      this.selectPreset('default');
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      if (this.scrollTarget && this.scrollTarget.nativeElement) {
        this.scrollTarget.nativeElement.scrollTop = 0;
      }
    }, 0);
  }

  protected selectPreset(type: 'default' | 'screen-reader') {
    this.loggingService.logEvent({
      type: 'FIRST_RUN_PRESET_SELECTED',
      preset: type
    });

    if (type === 'screen-reader') {
      this.stateService.applyPreset('screen-reader');
      this.speechService.setEnabled(false);
    } else {
      this.stateService.applyPreset('default');
      this.speechService.setEnabled(true);
    }
    
    this.dialogRef.close();
  }
}
