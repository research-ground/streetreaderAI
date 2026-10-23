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

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../services/state_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { DescriptionCacheService } from '../../services/description_cache_service';
import {
  AiProviderType,
  ConfigService,
  ImageryProviderType,
  LocationProviderType,
} from '../../services/config_service';
import { RouteProviderService } from '../../services/route_provider_service';
import { NavigationService } from '../../services/navigation_service';
import { clearAllClientCaches } from '../../services/client_cache';

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
    MatInputModule,
    MatCheckboxModule,
    FormsModule,
  ],
  template: `
    <h2 mat-dialog-title>Settings</h2>
    <mat-dialog-content>
      <div class="settings-section">
        <h3>Data Sources &amp; API Keys</h3>
        <div class="setting-group">
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
              <mat-label>Mapillary Client Token</mat-label>
              <input
                matInput
                [type]="showMapillaryToken() ? 'text' : 'password'"
                [ngModel]="configService.mapillaryToken()"
                (ngModelChange)="onMapillaryTokenChange($event)"
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
          } @else {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Panoramax Instance API URL</mat-label>
              <input
                matInput
                type="url"
                [ngModel]="configService.panoramaxBaseUrl()"
                (ngModelChange)="configService.setPanoramaxBaseUrl($event)"
                placeholder="https://api.panoramax.xyz/api" />
            </mat-form-field>
          }

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Location &amp; Geocoding Provider</mat-label>
            <mat-select
              [value]="configService.locationService()"
              (selectionChange)="onLocationServiceChange($event.value)">
              <mat-option value="osm">OpenStreetMap (Nominatim &amp; Overpass — No Key Required)</mat-option>
              <mat-option value="google">Google Maps Platform (Requires API Key)</mat-option>
            </mat-select>
          </mat-form-field>

          @if (configService.locationService() === 'google') {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Google Maps API Key</mat-label>
              <input
                matInput
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

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>AI Vision Provider</mat-label>
            <mat-select
              [value]="configService.aiProvider()"
              (selectionChange)="onAiProviderChange($event.value)">
              <mat-option value="gemini">Google Gemini ({{ configService.geminiModelId }})</mat-option>
              <mat-option value="openai">OpenAI ({{ configService.openaiModelId }})</mat-option>
            </mat-select>
          </mat-form-field>

          @if (configService.aiProvider() === 'gemini') {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Gemini API Key</mat-label>
              <input
                matInput
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
              <mat-label>OpenAI API Key</mat-label>
              <input
                matInput
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

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Default Starting Address</mat-label>
            <input
              matInput
              type="text"
              [ngModel]="configService.startingAddress()"
              (ngModelChange)="configService.setStartingAddress($event)"
              placeholder="601 N 34th St, Seattle, WA" />
          </mat-form-field>
        </div>
      </div>

      <div class="settings-section">
        <h3>Controls &amp; Display</h3>
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
            <small>This will reset all your settings (API keys, modifier key, speech preferences, etc.) and clear the description cache. The page will reload.</small>
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
  protected readonly configService = inject(ConfigService);
  protected readonly speechOutputService = inject(SpeechOutputService);
  private readonly routeProvider = inject(RouteProviderService);
  private readonly navigationService = inject(NavigationService);
  private readonly cache = inject(DescriptionCacheService);
  protected readonly dialogRef = inject(MatDialogRef<SettingsDialog>);

  protected readonly showMapillaryToken = signal(false);
  protected readonly showGoogleKey = signal(false);
  protected readonly showGeminiKey = signal(false);
  protected readonly showOpenaiKey = signal(false);

  protected onImageryProviderChange(provider: ImageryProviderType) {
    this.configService.setImageryProvider(provider);
    this.routeProvider.resetState();
    if (this.configService.hasActiveImageryConfig()) {
      this.reloadCurrentLocation();
    }
  }

  protected onMapillaryTokenChange(token: string) {
    const hadToken = this.configService.mapillaryToken().length > 0;
    this.configService.setMapillaryToken(token);
    if (!hadToken && token.trim().length > 0 && this.configService.imageryProvider() === 'mapillary') {
      this.routeProvider.resetState();
      this.reloadCurrentLocation();
    }
  }

  protected onLocationServiceChange(service: LocationProviderType) {
    this.configService.setLocationService(service);
  }

  protected onAiProviderChange(provider: AiProviderType) {
    this.configService.setAiProvider(provider);
  }

  protected onRateChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.speechOutputService.setRate(parseFloat(target.value));
  }

  protected clearCache() {
    this.cache.clear();
    clearAllClientCaches();
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('streetreader_')) {
        localStorage.removeItem(key);
      }
    });
    window.location.reload();
  }

  private reloadCurrentLocation() {
    this.navigationService.clearSessionCache();
    const st = this.stateService.state();
    if (st.location.lat && st.location.lng) {
      this.navigationService.loadCoordinates(
        st.location.lat,
        st.location.lng,
        st.heading
      );
    } else {
      this.navigationService.loadLocationWithHeading(
        st.address || this.configService.startingAddress(),
        st.heading
      );
    }
  }
}
