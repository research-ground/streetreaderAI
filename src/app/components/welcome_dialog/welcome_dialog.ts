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

import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { StateService } from '../../services/state_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { LoggingService } from '../../services/logging_service';
import { ConfigService } from '../../services/config_service';

@Component({
  selector: 'app-first-run-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  template: `
    <div class="first-run-container">
      <h2 mat-dialog-title>Welcome to StreetReaderAI</h2>

      <mat-dialog-content #scrollTarget>
        <p class="intro-text">
          Choose your initial accessibility and control preferences below to begin exploring.
          You can change any of these options later in Settings (<kbd>Shift</kbd>+<kbd>/</kbd>).
        </p>

        <p class="prototype-note">
          <strong>Note:</strong> StreetReaderAI is a research prototype and will likely have bugs.
          You can <a href="https://github.com/research-ground/streetreaderAI/issues" target="_blank" rel="noopener noreferrer">file bugs on GitHub</a>
          or send feedback to <a href="mailto:streetreaderai-team@google.com">streetreaderai-team&#64;google.com</a>.
        </p>

        <section class="setup-section" aria-labelledby="setup-controls-heading">
          <h3 id="setup-controls-heading">Accessibility &amp; Controls</h3>
          <div class="option-group">
            <div class="option-row">
              <div class="option-description">
                <span class="option-title">Self-voicing speech output</span>
                <small>Speak descriptions and street announcements aloud using built-in TTS. Turn off if you use a screen reader.</small>
              </div>
              <mat-slide-toggle
                [checked]="speechOutputService.enabled()"
                (change)="speechOutputService.setEnabled($event.checked)"
                aria-label="Self-voicing speech output">
              </mat-slide-toggle>
            </div>

            <div class="option-row">
              <div class="option-description">
                <span class="option-title">Automatically generate scene descriptions</span>
                <small>Describe each new street view location automatically when you arrive.</small>
              </div>
              <mat-slide-toggle
                [checked]="stateService.autoDescribe()"
                (change)="stateService.setAutoDescribe($event.checked)"
                aria-label="Automatically generate scene descriptions">
              </mat-slide-toggle>
            </div>

            <div class="option-row">
              <div class="option-description">
                <span class="option-title">Allow movement commands in chat</span>
                <small>Let conversational requests like "turn left" or "move forward" navigate the view.</small>
              </div>
              <mat-slide-toggle
                [checked]="stateService.chatControlsApp()"
                (change)="stateService.setChatControlsApp($event.checked)"
                aria-label="Allow movement commands in chat">
              </mat-slide-toggle>
            </div>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Global Hotkey Modifier</mat-label>
              <mat-select
                [value]="stateService.modifierKey()"
                (selectionChange)="stateService.setModifierKey($event.value)">
                <mat-option value="alt">Alt (Default)</mat-option>
                <mat-option value="shift-alt">Alt + Shift (Recommended for Screen Readers)</mat-option>
                <mat-option value="ctrl">Ctrl</mat-option>
                <mat-option value="shift-ctrl">Ctrl + Shift</mat-option>
                <mat-option value="meta">Command (Mac)</mat-option>
                <mat-option value="shift-meta">Command + Shift (Mac)</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Describe direction using</mat-label>
              <mat-select
                [value]="stateService.orientationDisplayMode()"
                (selectionChange)="stateService.setOrientationDisplayMode($event.value)">
                <mat-option value="both">Cardinal directions and degrees</mat-option>
                <mat-option value="headings">Cardinal Directions</mat-option>
                <mat-option value="degrees">Degrees</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        </section>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button
          mat-flat-button
          color="primary"
          class="start-button"
          (click)="completeSetup()">
          Start Exploring
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .first-run-container { padding: 4px 8px; }
    h2 { margin-bottom: 4px; font-size: 22px; font-weight: 500; }
    .intro-text { margin-bottom: 10px; font-size: 14px; color: #444; line-height: 1.45; }
    .prototype-note {
      margin: 0 0 18px 0;
      padding: 10px 12px;
      background: #f3f6fb;
      border-left: 3px solid #1976d2;
      border-radius: 4px;
      font-size: 13px;
      color: #333;
      line-height: 1.45;
    }
    .prototype-note a {
      color: #1565c0;
      text-decoration: none;
      font-weight: 500;
    }
    .prototype-note a:hover {
      text-decoration: underline;
    }
    .setup-section { margin-bottom: 20px; }
    .setup-section h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #1976d2;
    }
    .option-group {
      padding: 14px 16px;
      background: #f9f9f9;
      border-radius: 8px;
      border: 1px solid #ececec;
    }
    .option-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px solid #eaeaea;
    }
    .option-row:last-of-type {
      margin-bottom: 8px;
    }
    .option-description {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .option-title {
      font-weight: 500;
      font-size: 14px;
      color: #222;
    }
    .option-description small {
      color: #666;
      font-size: 12px;
      line-height: 1.35;
    }
    .full-width { width: 100%; margin-top: 8px; }
    .start-button {
      min-width: 180px;
      padding: 8px 20px;
    }
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
  `],
})
export class WelcomeDialogComponent implements AfterViewInit {
  protected readonly stateService = inject(StateService);
  protected readonly configService = inject(ConfigService);
  protected readonly speechOutputService = inject(SpeechOutputService);
  private readonly loggingService = inject(LoggingService);
  private readonly dialogRef = inject(MatDialogRef<WelcomeDialogComponent>);

  @ViewChild('scrollTarget') private readonly scrollTarget!: ElementRef;

  constructor() {
    this.dialogRef.keydownEvents().subscribe((event) => {
      if (event.key === 'Escape') {
        this.completeSetup();
      }
    });

    this.dialogRef.backdropClick().subscribe(() => {
      this.completeSetup();
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      if (this.scrollTarget && this.scrollTarget.nativeElement) {
        this.scrollTarget.nativeElement.scrollTop = 0;
      }
    }, 0);
  }

  protected completeSetup() {
    this.loggingService.logEvent({
      type: 'FIRST_RUN_SETUP_COMPLETED',
      aiProvider: this.configService.aiProvider(),
      imageryProvider: this.configService.imageryProvider(),
      locationService: this.configService.locationService(),
      modifierKey: this.stateService.modifierKey(),
      speechEnabled: this.speechOutputService.enabled(),
      autoDescribe: this.stateService.autoDescribe(),
      chatControlsApp: this.stateService.chatControlsApp(),
    });

    this.stateService.setShowWelcome(false);
    this.dialogRef.close();
  }
}
