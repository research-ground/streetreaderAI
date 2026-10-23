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
  computed,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { StateService } from '../../services/state_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { LoggingService } from '../../services/logging_service';
import {
  AiProviderType,
  ConfigService,
  ImageryProviderType,
  LocationProviderType,
} from '../../services/config_service';
import { RouteProviderService } from '../../services/route_provider_service';

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
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  template: `
    <div class="first-run-container">
      <h2 mat-dialog-title>Welcome to StreetReaderAI</h2>

      <mat-dialog-content #scrollTarget>
        <p class="intro-text">
          Choose your initial configuration below to begin exploring. Because scene description is
          core to StreetReaderAI, an AI vision API key is required to continue. You can change any
          of these options later in Settings (<kbd>Shift</kbd>+<kbd>/</kbd>).
        </p>

        <!-- 1. AI Vision Provider & Key (Required) -->
        <section class="setup-section" aria-labelledby="setup-ai-heading">
          <h3 id="setup-ai-heading">1. AI Scene Description (Required)</h3>
          <div class="option-group">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>AI Vision Provider</mat-label>
              <mat-select
                [value]="configService.aiProvider()"
                [disabled]="configService.isGeminiLocked()"
                (selectionChange)="onAiProviderChange($event.value)">
                <mat-option value="gemini">Google Gemini ({{ configService.geminiModelId }})</mat-option>
                <mat-option value="openai">OpenAI ({{ configService.openaiModelId }})</mat-option>
              </mat-select>
            </mat-form-field>

            @if (configService.isGeminiLocked()) {
              <div class="locked-notice" role="status">
                <mat-icon aria-hidden="true">lock</mat-icon>
                <span>Google Gemini API key is provided by the host/proxy and cannot be changed.</span>
              </div>
            } @else if (configService.aiProvider() === 'gemini') {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Gemini API Key (Required)</mat-label>
                <input
                  matInput
                  required
                  [type]="showGeminiKey() ? 'text' : 'password'"
                  [ngModel]="configService.geminiApiKey()"
                  (ngModelChange)="configService.setGeminiApiKey($event)"
                  placeholder="AIza..."
                  autocomplete="off" />
                <button
                  mat-icon-button
                  matSuffix
                  type="button"
                  (click)="showGeminiKey.set(!showGeminiKey())"
                  [attr.aria-label]="showGeminiKey() ? 'Hide Gemini API key' : 'Show Gemini API key'">
                  <mat-icon>{{ showGeminiKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
            } @else {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>OpenAI API Key (Required)</mat-label>
                <input
                  matInput
                  required
                  [type]="showOpenaiKey() ? 'text' : 'password'"
                  [ngModel]="configService.openaiApiKey()"
                  (ngModelChange)="configService.setOpenaiApiKey($event)"
                  placeholder="sk-..."
                  autocomplete="off" />
                <button
                  mat-icon-button
                  matSuffix
                  type="button"
                  (click)="showOpenaiKey.set(!showOpenaiKey())"
                  [attr.aria-label]="showOpenaiKey() ? 'Hide OpenAI API key' : 'Show OpenAI API key'">
                  <mat-icon>{{ showOpenaiKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
            }

            @if (!configService.hasActiveAiKey()) {
              <div class="validation-banner" role="alert">
                <mat-icon aria-hidden="true">key</mat-icon>
                <span>Please enter your {{ configService.aiProvider() === 'openai' ? 'OpenAI' : 'Gemini' }} API key to enable scene descriptions and continue.</span>
              </div>
            }
          </div>
        </section>

        <!-- 2. Accessibility & Control Options -->
        <section class="setup-section" aria-labelledby="setup-controls-heading">
          <h3 id="setup-controls-heading">2. Accessibility &amp; Controls</h3>
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

        <!-- 3. Street Imagery & Location Providers -->
        <section class="setup-section" aria-labelledby="setup-data-heading">
          <h3 id="setup-data-heading">3. Street Imagery &amp; Location Providers</h3>
          <div class="option-group">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Street Imagery Provider</mat-label>
              <mat-select
                [value]="configService.imageryProvider()"
                (selectionChange)="onImageryProviderChange($event.value)">
                <mat-option value="panoramax">Panoramax (Open — No Key Required)</mat-option>
                <mat-option value="mapillary">Mapillary (Requires Client Token)</mat-option>
              </mat-select>
            </mat-form-field>

            @if (configService.imageryProvider() === 'mapillary') {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Mapillary Client Token (Required for Mapillary)</mat-label>
                <input
                  matInput
                  required
                  [type]="showMapillaryToken() ? 'text' : 'password'"
                  [ngModel]="configService.mapillaryToken()"
                  (ngModelChange)="configService.setMapillaryToken($event)"
                  placeholder="MLY|..."
                  autocomplete="off" />
                <button
                  mat-icon-button
                  matSuffix
                  type="button"
                  (click)="showMapillaryToken.set(!showMapillaryToken())"
                  [attr.aria-label]="showMapillaryToken() ? 'Hide Mapillary token' : 'Show Mapillary token'">
                  <mat-icon>{{ showMapillaryToken() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
            }

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Location &amp; Geocoding Provider</mat-label>
              <mat-select
                [value]="configService.locationService()"
                [disabled]="configService.isGoogleMapsLocked()"
                (selectionChange)="onLocationServiceChange($event.value)">
                <mat-option value="osm">OpenStreetMap (Nominatim &amp; Overpass — No Key Required)</mat-option>
                <mat-option value="google">Google Maps Platform (Requires API Key)</mat-option>
              </mat-select>
            </mat-form-field>

            @if (configService.isGoogleMapsLocked()) {
              <div class="locked-notice" role="status">
                <mat-icon aria-hidden="true">lock</mat-icon>
                <span>Google Maps API key is provided by the host/proxy and cannot be changed.</span>
              </div>
            } @else if (configService.locationService() === 'google') {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Google Maps API Key (Required for Google Maps)</mat-label>
                <input
                  matInput
                  required
                  [type]="showGoogleKey() ? 'text' : 'password'"
                  [ngModel]="configService.googleMapsApiKey()"
                  (ngModelChange)="configService.setGoogleMapsApiKey($event)"
                  placeholder="AIza..."
                  autocomplete="off" />
                <button
                  mat-icon-button
                  matSuffix
                  type="button"
                  (click)="showGoogleKey.set(!showGoogleKey())"
                  [attr.aria-label]="showGoogleKey() ? 'Hide Google Maps API key' : 'Show Google Maps API key'">
                  <mat-icon>{{ showGoogleKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
            }
          </div>
        </section>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button
          mat-flat-button
          color="primary"
          class="start-button"
          [disabled]="!canProceed()"
          (click)="completeSetup()">
          Start Exploring
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .first-run-container { padding: 4px 8px; }
    h2 { margin-bottom: 4px; font-size: 22px; font-weight: 500; }
    .intro-text { margin-bottom: 18px; font-size: 14px; color: #444; line-height: 1.45; }
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
    .locked-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 8px;
      background: #e8f0fe;
      color: #174ea6;
      border-radius: 6px;
      font-size: 13px;
    }
    .locked-notice mat-icon,
    .validation-banner mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .validation-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: #fff4e5;
      color: #8a4b00;
      border: 1px solid #ffd599;
      border-radius: 6px;
      font-size: 13px;
    }
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
  private readonly routeProvider = inject(RouteProviderService);
  private readonly loggingService = inject(LoggingService);
  private readonly dialogRef = inject(MatDialogRef<WelcomeDialogComponent>);

  protected readonly showGeminiKey = signal(false);
  protected readonly showOpenaiKey = signal(false);
  protected readonly showMapillaryToken = signal(false);
  protected readonly showGoogleKey = signal(false);

  protected readonly canProceed = computed(
    () =>
      this.configService.hasActiveAiKey() &&
      this.configService.hasActiveImageryConfig() &&
      this.configService.hasActiveLocationConfig()
  );

  @ViewChild('scrollTarget') private readonly scrollTarget!: ElementRef;

  constructor() {
    this.dialogRef.keydownEvents().subscribe((event) => {
      if (event.key === 'Escape' && this.canProceed()) {
        this.completeSetup();
      }
    });

    this.dialogRef.backdropClick().subscribe(() => {
      if (this.canProceed()) {
        this.completeSetup();
      }
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      if (this.scrollTarget && this.scrollTarget.nativeElement) {
        this.scrollTarget.nativeElement.scrollTop = 0;
      }
    }, 0);
  }

  protected onAiProviderChange(provider: AiProviderType) {
    this.configService.setAiProvider(provider);
  }

  protected onImageryProviderChange(provider: ImageryProviderType) {
    this.configService.setImageryProvider(provider);
    this.routeProvider.resetState();
  }

  protected onLocationServiceChange(service: LocationProviderType) {
    this.configService.setLocationService(service);
  }

  protected completeSetup() {
    if (!this.canProceed()) {
      return;
    }

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
