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

import { Injectable, signal, inject, effect } from '@angular/core';
import { StateService } from './state_service';
import { NavigationService } from './navigation_service';
import { DescriptionService } from './description_service';
import { SpeechOutputService } from './speech_output_service';
import { SpeechInputService } from './speech_input_service';
import { CommandService, AppCommand } from './command_service';
import { ToastService } from './toast_service';
import { StreetViewLinksService } from './street_view_links_service';
import { ApiService } from './api_service';
import { Subscription } from 'rxjs';

export type AppActivityState = 'IDLE' | 'TRAVELING' | 'TURNING' | 'MOVING' | 'LISTENING';

@Injectable({
  providedIn: 'root'
})
export class AppController {
  private stateService = inject(StateService);
  private navigationService = inject(NavigationService);
  private descriptionService = inject(DescriptionService);
  private speechOutputService = inject(SpeechOutputService);
  private speechInputService = inject(SpeechInputService);
  private commandService = inject(CommandService);
  private toastService = inject(ToastService);
  private streetViewLinksService = inject(StreetViewLinksService);
  private apiService = inject(ApiService);

  private activityState = signal<AppActivityState>('IDLE');
  private waitingOnDescription = signal<boolean>(false);
  private waitingOnAnswer = signal<boolean>(false);
  
  private currentAskSubscription: Subscription | null = null;

  readonly activity = this.activityState.asReadonly();
  readonly isWaitingOnDescription = this.waitingOnDescription.asReadonly();
  readonly isWaitingOnAnswer = this.waitingOnAnswer.asReadonly();

  constructor() {
    effect(() => {
       const loading = this.stateService.state().isLoading;
       if (!loading) {
          const current = this.activityState();
          if (current === 'TRAVELING' || current === 'TURNING' || current === 'MOVING') {
              this.activityState.set('IDLE');
          }
       }
    }, { allowSignalWrites: true });
  }
  
  setListening(isListening: boolean) {
      if (isListening) {
          this.activityState.set('LISTENING');
          this.cancelOngoingTasks();
      } else {
          if (this.activityState() === 'LISTENING') {
              this.activityState.set('IDLE');
          }
      }
  }

  setTraveling() {
      this.activityState.set('TRAVELING');
  }

  cancelOngoingTasks() {
    if (this.waitingOnDescription() || this.waitingOnAnswer()) {
        this.descriptionService.cancel();
        if (this.currentAskSubscription) {
            this.currentAskSubscription.unsubscribe();
            this.currentAskSubscription = null;
        }
        this.waitingOnDescription.set(false);
        this.waitingOnAnswer.set(false);
        this.speechOutputService.stop();
    }
  }

  // Returns true if the command was handled, false if it should be handled by app.ts (like UI toggles)
  handleCommand(command: AppCommand): boolean {
    const currentState = this.activityState();
    const currentHeading = this.stateService.currentHeading();
    
    // In listening state, block almost everything except stopping voice
    if (currentState === 'LISTENING' && command.type !== 'TOGGLE_VOICE') {
      this.toastService.show('Please wait, currently listening...');
      return true; 
    }

    // In moving/turning state, block further movement until finished
    if (currentState === 'MOVING' || currentState === 'TURNING') {
        this.toastService.show('Action in progress...');
        return true;
    }

    switch (command.type) {
      case 'SEARCH_ADDRESS':
        this.cancelOngoingTasks();
        this.speechOutputService.stop();
        this.activityState.set('TRAVELING');
        this.navigationService.loadAddress(command.payload);
        this.toastService.show(`Searching for ${command.payload}`);
        return true;

      case 'NAVIGATE_TO_IMAGE':
        this.cancelOngoingTasks();
        this.speechOutputService.stop();
        this.activityState.set('MOVING');
        this.navigationService.navigateToImage(command.payload);
        return true;

      case 'EXECUTE_AI_ACTION':
        this.executeAction(command.payload);
        return true;

      case 'MOVE_FORWARD': {
        const bestNode = this.streetViewLinksService.findForwardNode(currentHeading, this.stateService.state().adjacentNodes);
        if (bestNode) {
          this.cancelOngoingTasks();
          this.speechOutputService.stop();
          this.activityState.set('MOVING');
          this.toastService.show(`Moving forward ${Math.round(bestNode.distanceMeters || 0)}m`);
          this.navigationService.navigateToNode(bestNode);
        } else {
          this.toastService.show('Cannot move forward');
        }
        return true;
      }
      
      case 'MOVE_BACKWARD': {
        const backHeading = (currentHeading + 180) % 360;
        const bestNode = this.streetViewLinksService.findBestNode(backHeading, this.stateService.state().adjacentNodes);
        if (bestNode) {
          this.cancelOngoingTasks();
          this.speechOutputService.stop();
          this.activityState.set('MOVING');
          this.toastService.show(`Moving backward ${Math.round(bestNode.distanceMeters || 0)}m`);
          this.navigationService.navigateToNode(bestNode);
        } else {
          this.toastService.show('Cannot move backward');
        }
        return true;
      }

      case 'ROTATE_LEFT':
        this.cancelOngoingTasks();
        this.speechOutputService.stop();
        this.activityState.set('TURNING');
        this.stateService.setHeading(currentHeading - 45);
        this.navigationService.updateViewForHeading();
        this.toastService.show(`Rotated left to ${this.stateService.formattedHeading()}`);
        return true;

      case 'ROTATE_RIGHT':
        this.cancelOngoingTasks();
        this.speechOutputService.stop();
        this.activityState.set('TURNING');
        this.stateService.setHeading(currentHeading + 45);
        this.navigationService.updateViewForHeading();
        this.toastService.show(`Rotated right to ${this.stateService.formattedHeading()}`);
        return true;

      case 'TURN_LEFT':
        this.cancelOngoingTasks();
        this.speechOutputService.stop();
        this.activityState.set('TURNING');
        this.stateService.setHeading(currentHeading - 90);
        this.navigationService.updateViewForHeading();
        this.toastService.show(`Turned left to ${this.stateService.formattedHeading()}`);
        return true;

      case 'TURN_RIGHT':
        this.cancelOngoingTasks();
        this.speechOutputService.stop();
        this.activityState.set('TURNING');
        this.stateService.setHeading(currentHeading + 90);
        this.navigationService.updateViewForHeading();
        this.toastService.show(`Turned right to ${this.stateService.formattedHeading()}`);
        return true;

      case 'TURN_AROUND':
        this.cancelOngoingTasks();
        this.speechOutputService.stop();
        this.activityState.set('TURNING');
        this.stateService.setHeading(currentHeading + 180);
        this.navigationService.updateViewForHeading();
        this.toastService.show(`Turned around to ${this.stateService.formattedHeading()}`);
        return true;

      case 'DESCRIBE_VIEW':
        this.cancelOngoingTasks(); // Only cancel previous descriptions/answers
        this.waitingOnDescription.set(true);
        this.toastService.show('Refreshing description');
        this.descriptionService.needsRefresh(true);
        // How to know when description finishes? The descriptionService needs to signal it.
        // For now, we will add a hook or set a timeout, or modify descriptionService later.
        return true;

      case 'TOGGLE_VOICE':
        if (this.speechInputService.listening()) {
          this.speechInputService.stopListening();
          this.setListening(false);
        } else {
          this.speechInputService.startListening();
          this.setListening(true);
        }
        return true;

      case 'STOP_SPEECH':
        this.speechOutputService.stop();
        this.cancelOngoingTasks();
        this.toastService.show('Speech stopped');
        return true;

      case 'LOCATION_INFO':
        // Let app.ts handle this for now since it builds the string? Or move it here.
        // Actually, we can just return false and let app.ts handle UI specific formatting if it's there.
        return false;
        
      default:
        // UI commands (TOGGLE_TTS, SHOW_HOTKEYS, CLOSE_MODALS, etc) handled by app.ts
        return false;
    }
  }
  
  public setWaitingOnDescription(val: boolean) {
      this.waitingOnDescription.set(val);
  }

  private executeAction(query: string) {
    const image = this.stateService.currentImage();
    if (!image) {
      const msg = 'I cannot answer questions without an image to view.';
      this.stateService.addChatMessage('assistant', msg);
      this.speechOutputService.speak(msg, true);
      return;
    }
    
    this.cancelOngoingTasks();
    this.waitingOnAnswer.set(true);

    // The scope-restriction preamble is applied server-side (ai/prompts.py).
    this.currentAskSubscription = this.apiService.askQuestion(image, query, this.stateService.chatControlsApp()).subscribe({
      next: (res) => {
        this.waitingOnAnswer.set(false);
        this.currentAskSubscription = null;
        if (res && res.answer) {
          this.stateService.addChatMessage('assistant', res.answer);
          this.speechOutputService.speak(res.answer, true);
          if (res.navigationalAction && res.navigationalAction !== 'NONE') {
             // Dispatch command for navigational action
             this.commandService.execute({ type: res.navigationalAction as any });
          }
        } else {
          const msg = 'Sorry, I could not process that request.';
          this.stateService.addChatMessage('assistant', msg);
          this.speechOutputService.speak(msg, true);
        }
      },
      error: (err) => {
        this.waitingOnAnswer.set(false);
        this.currentAskSubscription = null;
        console.error('Error executing action:', err);
        const msg = 'There was an error communicating with the AI service.';
        this.stateService.addChatMessage('assistant', msg);
        this.speechOutputService.speak(msg, true);
      }
    });
  }
}
