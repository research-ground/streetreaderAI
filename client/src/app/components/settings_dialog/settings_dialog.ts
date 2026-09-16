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

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { StateService, ModifierKey } from '../../services/state_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { DescriptionCacheService } from '../../services/description_cache_service';

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [
    CommonModule, 
    MatDialogModule, 
    MatButtonModule, 
    MatSlideToggleModule, 
    MatIconModule, 
    MatSelectModule, 
    MatSliderModule, 
    MatFormFieldModule,
    MatCheckboxModule,
    FormsModule
  ],
  template: `
    <h2 mat-dialog-title>Settings</h2>
    <mat-dialog-content>
      <div class="settings-section">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Global Modifier Key</mat-label>
          <mat-select [value]="stateService.modifierKey()" (selectionChange)="stateService.setModifierKey($event.value)">
            <mat-option value="alt">Alt</mat-option>
            <mat-option value="ctrl">Ctrl</mat-option>
            <mat-option value="meta">Command (Mac)</mat-option>
            <mat-option value="shift-ctrl">Ctrl + Shift</mat-option>
            <mat-option value="shift-alt">Alt + Shift</mat-option>
            <mat-option value="shift-meta">Command + Shift (Mac)</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Describe direction using</mat-label>
          <mat-select [value]="stateService.orientationDisplayMode()" (selectionChange)="stateService.setOrientationDisplayMode($event.value)">
            <mat-option value="headings">Cardinal Directions</mat-option>
            <mat-option value="degrees">Degrees</mat-option>
            <mat-option value="both">Cardinal directions and degrees</mat-option>
          </mat-select>
        </mat-form-field>

        <div class="setting-item">
          <span class="setting-label">Allow movement commands in chat</span>
          <mat-slide-toggle 
            [checked]="stateService.chatControlsApp()" 
            (change)="stateService.setChatControlsApp($event.checked)">
          </mat-slide-toggle>
        </div>

        <div class="setting-item">
          <span class="setting-label">Automatically generate descriptions ({{ stateService.getHotkeyString('A') }})</span>
          <mat-slide-toggle 
            [checked]="stateService.autoDescribe()" 
            (change)="stateService.setAutoDescribe($event.checked)">
          </mat-slide-toggle>
        </div>

        <div class="setting-item">
          <span class="setting-label">Self-voicing speech output ({{ stateService.getHotkeyString('S') }})</span>
          <mat-slide-toggle 
            [checked]="speechOutputService.enabled()" 
            (change)="speechOutputService.setEnabled($event.checked)">
          </mat-slide-toggle>
        </div>
      </div>

      <div class="settings-section">
        <h3>Voice Settings</h3>
        
        <div class="setting-group">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Voice</mat-label>
            <mat-select [value]="speechOutputService.selectedVoice()" (selectionChange)="speechOutputService.setVoice($event.value)">
              @for (voice of speechOutputService.availableVoices(); track voice.name) {
                <mat-option [value]="voice">{{ voice.name }} ({{ voice.lang }})</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <div class="slider-container">
            <span class="setting-label" id="rate-label">Speed: {{ speechOutputService.rate() | number: '1.1-1' }}x</span>
            <mat-slider min="0.5" max="2" step="0.1" discrete>
              <input matSliderThumb [value]="speechOutputService.rate()" (input)="onRateChange($event)" aria-labelledby="rate-label">
            </mat-slider>
          </div>
        </div>
      </div>

      <!-- Reset Settings -->
      <div class="danger-zone">
        <h3>Reset Settings</h3>
        <div class="danger-item">
          <span class="danger-text">
            <strong>Delete saved data</strong>
            <small>This will reset all your settings (modifier key, speech preferences, etc.) and clear the description cache. The page will reload.</small>
          </span>
          <button mat-stroked-button (click)="clearCache()">Reset</button>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .settings-section { margin-bottom: 24px; }
    .danger-zone {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }
    .danger-zone h3 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .danger-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .danger-text {
      display: flex;
      flex-direction: column;
      margin-right: 16px;
    }
    .danger-text small {
      color: #666;
      font-size: 12px;
    }
    .setting-item { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: 8px 0;
    }
    .setting-group {
      padding: 16px;
      background: #f9f9f9;
      border-radius: 8px;
      margin-top: 8px;
    }
    .setting-label { font-weight: 500; }
    .full-width { width: 100%; margin-top: 8px; }
    .slider-container {
      display: flex;
      flex-direction: column;
      margin-top: 16px;
    }
    h3 { margin-top: 0; color: #666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
    mat-slider { width: 100%; }
  `]
})
export class SettingsDialog {
  protected readonly stateService = inject(StateService);
  protected readonly speechOutputService = inject(SpeechOutputService);
  private readonly cache = inject(DescriptionCacheService);
  protected readonly dialogRef = inject(MatDialogRef<SettingsDialog>);

  protected onRateChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.speechOutputService.setRate(parseFloat(target.value));
  }

  protected clearCache() {
    this.cache.clear();
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('streetreader_')) {
        localStorage.removeItem(key);
      }
    });
    window.location.reload();
  }
}
