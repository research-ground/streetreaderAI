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

import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { fromEvent } from 'rxjs';
import { HOTKEYS, HotkeyConfig } from '../config/hotkeys_config';
import { StateService, ModifierKey } from './state_service';
import { CommandService } from './command_service';

@Injectable({
  providedIn: 'root'
})
export class HotkeyService {
  private document = inject(DOCUMENT);
  private stateService = inject(StateService);
  private commandService = inject(CommandService);

  constructor() {
    fromEvent<KeyboardEvent>(this.document, 'keydown').subscribe((event) => {
      this.handleKeyDown(event);
    });
  }

  private handleKeyDown(event: KeyboardEvent) {
    // Ignore hotkeys if the user is typing in an input field
    const target = event.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    
    // Escape should work even in inputs to allow closing dialogs/cancelling
    const isSpecialKey = event.key === 'Escape';
    
    if (isInput && !isSpecialKey) {
      return;
    }

    const modifier = this.stateService.modifierKey();

    for (const config of Object.values(HOTKEYS)) {
      if (this.isMatch(event, config, modifier)) {
        event.preventDefault();
        event.stopPropagation();
        this.commandService.execute(config.command);
        break;
      }
    }
  }

  private isMatch(event: KeyboardEvent, config: HotkeyConfig, globalModifier: ModifierKey): boolean {
    const { ctrlKey, altKey, shiftKey, metaKey, code, key } = event;
    
    // Check if the physical key matches
    const physicalKeyMatch = code === `Key${config.key.toUpperCase()}` || 
                             code === config.key || 
                             key.toLowerCase() === config.key.toLowerCase();

    if (!physicalKeyMatch) return false;

    // Handle keys with explicit modifiers in config (like '?' requiring Shift)
    if (config.ctrlKey !== undefined || config.altKey !== undefined || config.shiftKey !== undefined || config.metaKey !== undefined) {
      return (config.ctrlKey || false) === ctrlKey &&
             (config.altKey || false) === altKey &&
             (config.shiftKey || false) === shiftKey &&
             (config.metaKey || false) === metaKey;
    }

    // Escape is special
    if (config.key === 'Escape') return !ctrlKey && !altKey && !shiftKey && !metaKey;

    // Check for "plain" key (no modifiers at all)
    const isPlain = !ctrlKey && !altKey && !shiftKey && !metaKey;

    // Check if modifiers match the global preference EXACTLY
    const isGlobalModifierMatch = 
      (globalModifier === 'ctrl'       && ctrlKey && !altKey && !shiftKey && !metaKey) ||
      (globalModifier === 'alt'        && altKey && !ctrlKey && !shiftKey && !metaKey) ||
      (globalModifier === 'meta'       && metaKey && !ctrlKey && !altKey && !shiftKey) ||
      (globalModifier === 'shift-ctrl' && ctrlKey && shiftKey && !altKey && !metaKey) ||
      (globalModifier === 'shift-alt'  && altKey && shiftKey && !ctrlKey && !metaKey) ||
      (globalModifier === 'shift-meta' && metaKey && shiftKey && !ctrlKey && !altKey);

    // Arrow keys: allow if plain OR if the global modifier matches
    if (config.key.startsWith('Arrow')) {
      return isPlain || isGlobalModifierMatch;
    }

    // All other keys REQUIRE the global modifier match
    return isGlobalModifierMatch;
  }
}