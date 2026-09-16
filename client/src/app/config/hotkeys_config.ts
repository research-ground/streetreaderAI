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

import { AppCommand } from "../services/command_service";

export interface HotkeyConfig {
  key: string;
  displayKey?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  description: string;
  command: AppCommand;
  section: 'User Interface' | 'Navigation' | 'System';
}

export const HOTKEYS: Record<string, HotkeyConfig> = {
  FOCUS_ADDRESS: {
    key: 'l',
    description: 'Jump to address field',
    command: { type: 'FOCUS_SEARCH' },
    section: 'User Interface'
  },
  ASK_QUESTION: {
    key: 'k',
    description: 'Jump to chat input field',
    command: { type: 'FOCUS_CHAT' },
    section: 'User Interface'
  },
  VOICE_COMMAND: {
    key: 'b',
    description: 'Start/stop voice command',
    command: { type: 'TOGGLE_VOICE' },
    section: 'User Interface'
  },
  LOCATION_INFO: {
    key: 'i',
    description: 'Show current location info',
    command: { type: 'LOCATION_INFO' },
    section: 'User Interface'
  },
  MOVE_FORWARD: {
    key: 'ArrowUp',
    displayKey: '↑',
    description: 'Move forward',
    command: { type: 'MOVE_FORWARD' },
    section: 'Navigation'
  },
  MOVE_BACKWARD: {
    key: 'ArrowDown',
    displayKey: '↓',
    description: 'Move backward',
    command: { type: 'MOVE_BACKWARD' },
    section: 'Navigation'
  },
  ROTATE_LEFT: {
    key: 'ArrowLeft',
    displayKey: '←',
    description: 'Rotate left by 45°',
    command: { type: 'ROTATE_LEFT' },
    section: 'Navigation'
  },
  ROTATE_RIGHT: {
    key: 'ArrowRight',
    displayKey: '→',
    description: 'Rotate right by 45°',
    command: { type: 'ROTATE_RIGHT' },
    section: 'Navigation'
  },
  DESCRIBE_VIEW: {
    key: 'd',
    description: 'Describe the current view',
    command: { type: 'DESCRIBE_VIEW' },
    section: 'Navigation'
  },
  TOGGLE_AUTO_DESCRIBE: {
    key: 'a',
    description: 'Toggle automatically generate descriptions',
    command: { type: 'TOGGLE_AUTO_DESCRIBE' },
    section: 'System'
  },
  TOGGLE_TTS: {
    key: 's',
    description: 'Toggle text-to-speech',
    command: { type: 'TOGGLE_TTS' },
    section: 'System'
  },
  SHOW_HOTKEYS: {
    key: '?',
    shiftKey: true,
    description: 'Show Help and keyboard shortcuts',
    command: { type: 'SHOW_HOTKEYS' },
    section: 'System'
  },
  TOGGLE_SETTINGS: {
    key: ',',
    description: 'Open settings',
    command: { type: 'TOGGLE_SETTINGS' },
    section: 'System'
  },
  TOGGLE_CURTAIN: {
    key: 't',
    description: 'Toggle screen curtain',
    command: { type: 'TOGGLE_CURTAIN' },
    section: 'System'
  },
  CLOSE_MODALS: {
    key: 'Escape',
    description: 'Close windows / Stop speech',
    command: { type: 'CLOSE_MODALS' },
    section: 'System'
  }
};