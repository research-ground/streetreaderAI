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

import { Injectable, computed, inject, signal } from '@angular/core';
import { DEMO_LOCATIONS, DemoLocation, DemoQuestion, GENERIC_QUESTIONS } from './demo_config';
import { NavigationService } from '../services/navigation_service';
import { StateService } from '../services/state_service';
import { CommandService } from '../services/command_service';
import { ToastService } from '../services/toast_service';
import { SpeechOutputService } from '../services/speech_output_service';
import { AppController } from '../services/app_controller';

@Injectable({ providedIn: 'root' })
export class DemoModeService {
  private navigationService = inject(NavigationService);
  private stateService = inject(StateService);
  private commandService = inject(CommandService);
  private toastService = inject(ToastService);
  private speechOutputService = inject(SpeechOutputService);
  private appController = inject(AppController);

  readonly locations: DemoLocation[] = DEMO_LOCATIONS;
  readonly enabled = signal<boolean>(true);
  readonly activeLocationIndex = signal<number>(0);

  readonly activeLocation = computed<DemoLocation | null>(() => {
    const idx = this.activeLocationIndex();
    return idx >= 0 && idx < this.locations.length ? this.locations[idx] : null;
  });

  readonly activeQuestions = computed<DemoQuestion[]>(
    () => this.activeLocation()?.questions ?? GENERIC_QUESTIONS
  );

  private readonly boundKeyHandler = (event: KeyboardEvent) => this.onKeyDown(event);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyHandler);
    }
    this.commandService.commands$.subscribe((cmd) => {
      if (cmd.type === 'SEARCH_ADDRESS') {
        const matchedIdx = this.locations.findIndex(
          (l) => l.address.toLowerCase() === cmd.payload.trim().toLowerCase()
        );
        this.activeLocationIndex.set(matchedIdx);
      }
    });
  }

  applyRuntimeConfig(_serverDemoMode?: boolean): void {
    this.enabled.set(true);
  }

  setEnabled(value: boolean): void {
    this.enabled.set(value);
  }

  toggle(): void {
    this.setEnabled(!this.enabled());
  }

  selectLocation(loc: DemoLocation): void {
    const idx = this.locations.findIndex((l) => l.id === loc.id);
    if (idx >= 0) {
      this.activeLocationIndex.set(idx);
    }
    this.appController.cancelOngoingTasks();
    this.speechOutputService.stop();
    this.appController.setTraveling();
    this.toastService.show(`Preset [${loc.key}]: ${loc.title}`);
    this.navigationService.loadCoordinates(loc.latitude, loc.longitude, loc.heading);
  }

  askQuestion(q: DemoQuestion): void {
    if (this.appController.isWaitingOnAnswer()) {
      this.toastService.show('Still answering previous question...');
      return;
    }
    this.toastService.show(`Question [${q.key}]: ${q.label}`);
    this.stateService.addChatMessage('user', q.question);
    this.commandService.execute({ type: 'EXECUTE_AI_ACTION', payload: q.question });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.enabled()) {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    const key = event.key;
    const loc = this.locations.find((l) => l.key === key);
    if (loc) {
      event.preventDefault();
      this.selectLocation(loc);
      return;
    }

    const question = this.activeQuestions().find((q) => q.key === key);
    if (question) {
      event.preventDefault();
      this.askQuestion(question);
    }
  }
}
