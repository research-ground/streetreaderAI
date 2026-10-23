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

import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type AppCommand = 
  | { type: 'SEARCH_ADDRESS', payload: string }
  | { type: 'NAVIGATE_TO_IMAGE', payload: string }
  | { type: 'EXECUTE_AI_ACTION', payload: string }
  | { type: 'ROTATE_LEFT' }
  | { type: 'ROTATE_RIGHT' }
  | { type: 'TURN_LEFT' }
  | { type: 'TURN_RIGHT' }
  | { type: 'TURN_AROUND' }
  | { type: 'MOVE_FORWARD' }
  | { type: 'MOVE_BACKWARD' }
  | { type: 'DESCRIBE_VIEW' }
  | { type: 'STOP_SPEECH' }
  | { type: 'TOGGLE_VOICE' }
  | { type: 'TOGGLE_TTS' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'SHOW_HOTKEYS' }
  | { type: 'LOCATION_INFO' }
  | { type: 'CLOSE_MODALS' }
  | { type: 'FOCUS_SEARCH' }
  | { type: 'FOCUS_CHAT' }
  | { type: 'TOGGLE_CURTAIN' }
  | { type: 'TOGGLE_AUTO_DESCRIBE' };

@Injectable({
  providedIn: 'root'
})
export class CommandService {
  private commandSubject = new Subject<AppCommand>();
  commands$ = this.commandSubject.asObservable();

  execute(command: AppCommand) {
    this.commandSubject.next(command);
  }
}
