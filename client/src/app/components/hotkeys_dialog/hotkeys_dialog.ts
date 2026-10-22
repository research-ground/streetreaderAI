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
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { HOTKEYS, HotkeyConfig } from '../../config/hotkeys_config';
import { StateService } from '../../services/state_service';

@Component({
  selector: 'app-hotkeys-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatListModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Help</h2>
    <mat-dialog-content class="help-content" #scrollTarget>
      <section>
        <h3>How to use StreetReaderAI</h3>
        <ul>
          <li>Select the location bar in the top left (or press @for (m of modKeys(); track m) { <kbd>{{m}}</kbd>+ }<kbd>L</kbd>) to enter an address, or choose from one of the suggested locations. <strong>Note that only US locations are currently supported.</strong></li>
          <li>Use the arrow keys (<kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>←</kbd>, <kbd>→</kbd>) to move forward and backward and to turn in 45-degree increments. You can also move with (@for (m of modKeys(); track m) { <kbd>{{m}}</kbd>+ }arrow keys).</li>
          <li>As you move, StreetReaderAI will generate a description of the scene in front of you (press @for (m of modKeys(); track m) { <kbd>{{m}}</kbd>+ }<kbd>A</kbd> to toggle).</li>
          <li>You can ask StreetReaderAI questions about the current location in the chat window (or press @for (m of modKeys(); track m) { <kbd>{{m}}</kbd>+ }<kbd>K</kbd>). You can also enter voice commands by clicking the microphone icon (or press @for (m of modKeys(); track m) { <kbd>{{m}}</kbd>+ }<kbd>B</kbd>). You can use this feature to learn about the environment or control the camera (e.g., "move left").</li>
          <li>To change the settings, click the Settings icon (or press <kbd>Shift</kbd>+<kbd>/</kbd> or <kbd>?</kbd>).</li>
          <li>To experience the non-visual interface, you can hide the map by activating the screen curtain (press @for (m of modKeys(); track m) { <kbd>{{m}}</kbd>+ }<kbd>T</kbd>).</li>
        </ul>
      </section>

      <section>
        <h3>Things to try</h3>
        <ul>
          <li>Visit familiar locations and landmarks</li>
          <li>Ask questions about the environment</li>
          <li>Use chat and voice commands to move around</li>
        </ul>
      </section>

      <section>
        <h3>Keyboard Shortcuts</h3>
        <div class="hotkeys-grid">
          @for (section of sections; track section) {
            <div class="hotkey-section">
              <h4>{{ section }}</h4>
              <mat-list>
                @for (shortcut of getShortcutsBySection(section); track shortcut.key) {
                  <mat-list-item>
                    <div class="shortcut-row">
                      <span class="shortcut-desc">{{ shortcut.description }}</span>
                      <div class="key-container">
                        @if (shortcut.ctrlKey) { <kbd>Ctrl</kbd> + }
                        @if (shortcut.altKey) { <kbd>Alt</kbd> + }
                        @if (shortcut.metaKey) { <kbd>Cmd</kbd> + }
                        @if (shortcut.shiftKey) { <kbd>Shift</kbd> + }
                        
                        @if (needsGlobalModifier(shortcut)) {
                          @if (modifier() === 'ctrl' || modifier() === 'shift-ctrl') { <kbd>Ctrl</kbd> + }
                          @if (modifier() === 'alt' || modifier() === 'shift-alt') { <kbd>Alt</kbd> + }
                          @if (modifier() === 'meta' || modifier() === 'shift-meta') { <kbd>Cmd</kbd> + }
                          @if (modifier() === 'shift-ctrl' || modifier() === 'shift-alt' || modifier() === 'shift-meta') { <kbd>Shift</kbd> + }
                        }

                        <kbd>{{ (shortcut.displayKey || shortcut.key) | uppercase }}</kbd>

                        @if (shortcut.key.startsWith('Arrow')) {
                          or @for (m of modKeys(); track m) { <kbd>{{m}}</kbd>+ }<kbd>{{ (shortcut.displayKey || shortcut.key) | uppercase }}</kbd>
                        }
                      </div>
                    </div>
                  </mat-list-item>
                }
              </mat-list>
            </div>
          }
        </div>
      </section>

      <section class="attribution-section">
        <h3>Data Sources &amp; Attribution</h3>
        <ul class="attribution-list">
          <li>
            <strong>Road Network &amp; Map Data:</strong>
            &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, licensed under the <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener noreferrer">Open Database License (ODbL)</a>.
          </li>
          <li>
            <strong>Street-Level Imagery (Mapillary):</strong>
            &copy; <a href="https://www.mapillary.com/" target="_blank" rel="noopener noreferrer">Mapillary</a> contributors, licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>.
          </li>
          <li>
            <strong>Street-Level Imagery (Panoramax):</strong>
            &copy; <a href="https://panoramax.xyz/" target="_blank" rel="noopener noreferrer">Panoramax</a> contributors (IGN / OpenStreetMap France community instances), licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a> / <a href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/" target="_blank" rel="noopener noreferrer">Etalab Open Licence 2.0</a>.
          </li>
          <li>
            <strong>Geocoding &amp; Places:</strong>
            Powered by <a href="https://developers.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps Platform</a> (&copy; Google) and <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener noreferrer">OpenStreetMap Nominatim</a>.
          </li>
          <li>
            <strong>AI Scene Descriptions &amp; Q&amp;A:</strong>
            Powered by <a href="https://ai.google.dev/" target="_blank" rel="noopener noreferrer">Google Gemini</a> (&copy; Google).
          </li>
        </ul>
      </section>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .help-content {
      line-height: 1.4;
      font-size: 16px;
    }
    section { margin-bottom: 8px; }
    h3 { 
      border-bottom: 1px solid #ddd;
      padding-bottom: 1px;
      margin-bottom: 4px;
      color: #1976d2;
      font-size: 1.2rem;
    }
    h4 {
      margin: 6px 0 2px 0;
      font-size: 14px;
      text-transform: uppercase;
      color: #777;
    }
    ul { padding-left: 18px; margin-bottom: 4px; }
    li { margin-bottom: 6px; }
    p { margin: 2px 0; }
    .hotkeys-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 2px;
      padding: 0;
    }
    .shortcut-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      font-size: 16px;
    }
    .shortcut-desc { padding-right: 6px; }
    kbd {
      background-color: #fff;
      border-radius: 2px;
      border: 1px solid #ccc;
      box-shadow: 0 1px 0 rgba(0,0,0,0.1);
      color: #333;
      display: inline-block;
      font-size: 0.9em;
      font-weight: 700;
      line-height: 1;
      padding: 2px 4px;
      white-space: nowrap;
    }
    .key-container { color: #555; flex-shrink: 0; }
    mat-list-item { height: auto !important; padding: 0 !important; }
    a { color: #1565c0; text-decoration: none; }
    a:hover { text-decoration: underline; }
  `]
})
export class HotkeysDialog implements AfterViewInit {
  private stateService = inject(StateService);
  private readonly hotkeys = Object.values(HOTKEYS);
  protected readonly sections: ('User Interface' | 'Navigation' | 'System')[] = ['User Interface', 'Navigation', 'System'];
  protected readonly dialogRef = inject(MatDialogRef<HotkeysDialog>);

  @ViewChild('scrollTarget') private readonly scrollTarget!: ElementRef;

  protected readonly modifier = this.stateService.modifierKey;

  ngAfterViewInit() {
    setTimeout(() => {
      if (this.scrollTarget && this.scrollTarget.nativeElement) {
        this.scrollTarget.nativeElement.scrollTop = 0;
      }
    }, 0);
  }

  protected modKeys() {
    const m = this.modifier();
    if (m === 'ctrl') return ['Ctrl'];
    if (m === 'alt') return ['Alt'];
    if (m === 'meta') return ['Cmd'];
    if (m === 'shift-ctrl') return ['Ctrl', 'Shift'];
    if (m === 'shift-alt') return ['Alt', 'Shift'];
    if (m === 'shift-meta') return ['Cmd', 'Shift'];
    return ['Ctrl'];
  }

  protected getShortcutsBySection(section: string) {
    return this.hotkeys.filter(h => h.section === section);
  }

  protected needsGlobalModifier(config: HotkeyConfig): boolean {
    if (config.ctrlKey || config.altKey || config.shiftKey || config.metaKey) return false;
    if (config.key === 'Escape') return false;
    if (config.key.startsWith('Arrow')) return false;
    return true;
  }
}
