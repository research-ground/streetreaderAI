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

import { Component, inject, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { UiService } from './services/ui_service';
import { StateService } from './services/state_service';
import { ApiService } from './services/api_service';
import { HotkeyService } from './services/hotkey_service';
import { CommandService, AppCommand } from './services/command_service';
import { NavigationService } from './services/navigation_service';
import { StreetViewLinksService } from './services/street_view_links_service';
import { DescriptionService } from './services/description_service';
import { SpeechOutputService } from './services/speech_output_service';
import { SpeechInputService } from './services/speech_input_service';
import { ToastService } from './services/toast_service';
import { SettingsDialog } from './components/settings_dialog/settings_dialog';
import { HotkeysDialog } from './components/hotkeys_dialog/hotkeys_dialog';
import { WelcomeDialogComponent } from './components/welcome_dialog/welcome_dialog';
import { ActivationDialogComponent } from './components/activation_dialog/activation_dialog';
import { PaletteComponent } from './components/palette/palette';
import { RadarViewComponent } from './components/radar_view/radar_view';
import { AppController } from "./services/app_controller";
import { DemoModeService } from './demo_mode';

import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    PaletteComponent,
    RadarViewComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  protected uiService = inject(UiService);
  protected stateService = inject(StateService);
  private apiService = inject(ApiService);
  private commandService = inject(CommandService);
  private navigationService = inject(NavigationService);
  private streetViewLinksService = inject(StreetViewLinksService);
  private descriptionService = inject(DescriptionService);
  protected speechOutputService = inject(SpeechOutputService);
  private speechInputService = inject(SpeechInputService);
  private hotkeyService = inject(HotkeyService); 
  private toastService = inject(ToastService);
  protected appController = inject(AppController);
  protected demoModeService = inject(DemoModeService);
  private dialog = inject(MatDialog);

  private commandSubscription?: Subscription;

  protected leftComponents = computed(() => this.uiService.getComponentsBySide('left'));
  protected rightComponents = computed(() => this.uiService.getComponentsBySide('right'));
  protected currentImage = this.stateService.currentImage;
  protected currentAddress = computed(() => this.stateService.state().address);
  protected currentHeading = computed(() => this.stateService.state().heading);
  protected isLoading = computed(() => this.stateService.state().isLoading);
  protected adjacentNodes = computed(() => this.stateService.state().adjacentNodes);
  protected intersectionInfo = computed(() => this.streetViewLinksService.analyzeIntersection(this.currentHeading(), this.adjacentNodes()));
  protected formattedIntersection = computed(() => {
    const info = this.intersectionInfo();
    if (info.streets.length === 0) return '';

    const ahead = info.streets.filter(s => s.directions.includes('forward')).map(s => s.name);
    const sides = info.streets.filter(s => !s.directions.includes('forward') && (s.directions.includes('paths to the left') || s.directions.includes('paths to the right')));

    let msg = '';
    if (ahead.length > 0) {
      msg += `Ahead: ${ahead.join(' and ')}`;
    }

    if (sides.length > 0) {
      const sideStrs = sides.map(s => {
        const dirs = [];
        if (s.directions.includes('paths to the left')) dirs.push('Left');
        if (s.directions.includes('paths to the right')) dirs.push('Right');
        return `${dirs.join(' and ')}: ${s.name}`;
      });
      msg += (msg ? '; ' : '') + sideStrs.join(', ');
    }

    return msg;
  });

  ngOnInit() {
    this.commandSubscription = this.commandService.commands$.subscribe(command => this.handleCommand(command));
    this.appController.setTraveling();
    this.apiService.getConfig().subscribe({
      next: (cfg) => {
        this.demoModeService.applyRuntimeConfig(cfg.demoMode);
        const address = cfg.startingAddress || '601 N 34th St, Seattle, WA';
        this.navigationService.loadLocationWithHeading(address, 0);
      },
      error: () => {
        this.navigationService.loadLocationWithHeading('601 N 34th St, Seattle, WA', 0);
      }
    });

    if (this.stateService.showWelcome()) {
      this.openWelcome();
    } else if (this.speechOutputService.enabled()) {
      // If welcome is off but TTS is on, we need an interaction to unlock audio
      this.openActivationDialog();
    }
  }

  ngOnDestroy() {
    this.commandSubscription?.unsubscribe();
  }

  protected openWelcome() {
    const dialogRef = this.dialog.open(WelcomeDialogComponent, { 
      width: '900px',
      maxWidth: '95vw',
      panelClass: 'wide-dialog',
      disableClose: true,
      autoFocus: false
    });

    dialogRef.afterClosed().subscribe(() => {
      // First interaction happened, speak initial greeting
      const addr = this.stateService.state().address;
      this.speechOutputService.speak(
        addr
          ? `Street Reader A I initialized. You are at ${addr}.`
          : 'Street Reader A I initialized. You are at 411 15th Avenue East, Seattle.'
      );
      if (this.stateService.autoDescribe()) {
        this.descriptionService.needsRefresh(false);
      }
    });
  }

  protected openActivationDialog() {
    this.stateService.setActivationDialog(true);
    const dialogRef = this.dialog.open(ActivationDialogComponent, {
      width: '450px',
      disableClose: true,
      autoFocus: true
    });

    dialogRef.afterClosed().subscribe(() => {
      this.stateService.setActivationDialog(false);
      const addr = this.stateService.state().address;
      this.speechOutputService.speak(
        addr
          ? `Speech activated. You are at ${addr}.`
          : 'Speech activated. You are at 411 15th Avenue East, Seattle.'
      );
      if (this.stateService.autoDescribe()) {
        this.descriptionService.needsRefresh(false);
      }
    });
  }

  private handleCommand(command: AppCommand) {
    // Let AppController handle core navigation, movement, and AI actions
    if (this.appController.handleCommand(command)) {
      return;
    }

    switch (command.type) {
      case 'TOGGLE_TTS': {
        const newState = !this.speechOutputService.enabled();
        this.speechOutputService.setEnabled(newState);
        const msg = `Self-voicing speech output ${newState ? 'on' : 'off'}`;
        this.speechOutputService.speak(msg);
        this.toastService.show(msg);
        break;
      }
      case 'SHOW_HOTKEYS':
        this.openHotkeys();
        break;
      case 'LOCATION_INFO': {
        const info = this.intersectionInfo();
        let msg = `Address: ${this.stateService.state().address || 'Unknown'}. `;
        msg += `Heading: ${this.stateService.formattedHeading()}. `;
        
        if (info.streets.length > 0) {
          const ahead = info.streets.filter(s => s.directions.includes('forward')).map(s => s.name);
          const sides = info.streets.filter(s => !s.directions.includes('forward') && (s.directions.includes('paths to the left') || s.directions.includes('paths to the right')));

          if (ahead.length > 0) msg += `Ahead: ${ahead.join(' and ')}. `;
          
          if (sides.length > 0) {
            const sideStrs = sides.map(s => {
              const dirs = [];
              if (s.directions.includes('paths to the left')) dirs.push('Left');
              if (s.directions.includes('paths to the right')) dirs.push('Right');
              return `${dirs.join(' and ')}: ${s.name}`;
            });
            msg += sideStrs.join(', ') + '.';
          }
        }
        this.toastService.show(msg);
        break;
      }
      case 'CLOSE_MODALS':
        this.dialog.closeAll();
        this.speechOutputService.stop();
        if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
          document.activeElement.blur();
        }
        break;
      case 'TOGGLE_VOICE':
        if (this.speechInputService.listening()) {
          this.speechInputService.stopListening();
        } else {
          this.speechInputService.startListening();
        }
        break;
      case 'FOCUS_SEARCH':
        this.focusElement('app-navigation input');
        break;
      case 'FOCUS_CHAT':
        this.focusElement('app-chat input');
        break;
      case 'TOGGLE_SETTINGS':
        this.openSettings();
        break;
      case 'TOGGLE_CURTAIN': {
        const newState = !this.stateService.screenCurtain();
        this.stateService.setScreenCurtain(newState);
        const msg = `Screen curtain ${newState ? 'on' : 'off'}`;
        this.speechOutputService.speak(msg);
        this.toastService.show(msg);
        break;
      }
      case 'TOGGLE_AUTO_DESCRIBE': {
        const newState = !this.stateService.autoDescribe();
        this.stateService.setAutoDescribe(newState);
        const msg = `Auto-description ${newState ? 'on' : 'off'}`;
        this.speechOutputService.speak(msg);
        this.toastService.show(msg);
        break;
      }
    }
  }


  private focusElement(selector: string) {
    const element = document.querySelector(selector) as HTMLInputElement;
    if (element) {
      element.value = '';
      element.focus();
    }
  }

  protected openSettings() {
    this.dialog.open(SettingsDialog, { width: '500px' });
  }

  protected openHotkeys() {
    this.dialog.open(HotkeysDialog, { 
      width: '700px',
      maxWidth: '95vw',
      panelClass: 'help-dialog',
      autoFocus: false
    });
  }

  protected getCurtainHotkey(): string {
    return this.stateService.getHotkeyString('T');
  }
}
