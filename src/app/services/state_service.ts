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

import { Injectable, signal, computed } from '@angular/core';
import { Link, NearbyPlace } from './api_service';
import { safeStorage } from './safe_storage';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type ModifierKey = 'alt' | 'ctrl' | 'shift-ctrl' | 'shift-alt' | 'meta' | 'shift-meta';
export type OrientationDisplayMode = 'degrees' | 'headings' | 'both';

export interface AppState {
  // Current View State
  location: {
    lat: number;
    lng: number;
    imageId?: string | null;
    canonicalNodeId?: string;
    status?: 'ok' | 'path_only';
  };
  heading: number;

  // Metadata for current location
  address: string | null;
  description: string | null;
  currentImage: string | null;
  adjacentNodes: Link[];
  nearbyPOIs: NearbyPlace[];
  
  // App Session State
  chatHistory: ChatMessage[];
  isLoading: boolean;
  modifierKey: ModifierKey;
  orientationDisplayMode: OrientationDisplayMode;
  chatControlsApp: boolean;
  autoDescribe: boolean;
  showWelcome: boolean;
  screenCurtain: boolean;
  showActivationDialog: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class StateService {
  private readonly WELCOME_KEY = 'streetreader_show_welcome';
  private readonly MODIFIER_KEY = 'streetreader_modifier_key';
  private readonly ORIENTATION_MODE_KEY = 'streetreader_orientation_mode';
  private readonly CHAT_CONTROLS_KEY = 'streetreader_chat_controls';
  private readonly AUTO_DESCRIBE_KEY = 'streetreader_auto_describe';
  private readonly CURTAIN_KEY = 'streetreader_curtain_enabled';

  private initialState: AppState = {
    location: { lat: 0, lng: 0 },
    heading: 0,
    address: null,
    description: null,
    currentImage: null,
    adjacentNodes: [],
    nearbyPOIs: [],
    chatHistory: [],
    isLoading: false,
    modifierKey: (safeStorage.getItem(this.MODIFIER_KEY) as ModifierKey) || 'alt',
    orientationDisplayMode: (safeStorage.getItem(this.ORIENTATION_MODE_KEY) as OrientationDisplayMode) || 'both',
    chatControlsApp: safeStorage.getItem(this.CHAT_CONTROLS_KEY) !== 'false', // Default to true
    autoDescribe: safeStorage.getItem(this.AUTO_DESCRIBE_KEY) !== 'false',
    showWelcome: safeStorage.getItem(this.WELCOME_KEY) !== 'false',
    screenCurtain: safeStorage.getItem(this.CURTAIN_KEY) === 'true',
    showActivationDialog: false
  };

  private appState = signal<AppState>(this.initialState);

  // Selectors
  readonly state = this.appState.asReadonly();
  readonly currentLocation = computed(() => this.appState().location);
  readonly currentHeading = computed(() => this.appState().heading);
  readonly currentImage = computed(() => this.appState().currentImage);
  readonly modifierKey = computed(() => this.appState().modifierKey);
  readonly orientationDisplayMode = computed(() => this.appState().orientationDisplayMode);
  readonly chatControlsApp = computed(() => this.appState().chatControlsApp);
  readonly autoDescribe = computed(() => this.appState().autoDescribe);
  readonly showWelcome = computed(() => this.appState().showWelcome);
  readonly screenCurtain = computed(() => this.appState().screenCurtain);
  readonly showActivationDialog = computed(() => this.appState().showActivationDialog);

  readonly formattedHeading = computed(() => {
    const heading = this.appState().heading;
    return this.formatHeadingValue(heading);
  });

  setModifierKey(key: ModifierKey) {
    safeStorage.setItem(this.MODIFIER_KEY, key);
    this.appState.update(s => ({ ...s, modifierKey: key }));
  }

  setOrientationDisplayMode(mode: OrientationDisplayMode) {
    safeStorage.setItem(this.ORIENTATION_MODE_KEY, mode);
    this.appState.update(s => ({ ...s, orientationDisplayMode: mode }));
  }

  setChatControlsApp(enabled: boolean) {
    safeStorage.setItem(this.CHAT_CONTROLS_KEY, enabled.toString());
    this.appState.update(s => ({ ...s, chatControlsApp: enabled }));
  }

  setAutoDescribe(enabled: boolean) {
    safeStorage.setItem(this.AUTO_DESCRIBE_KEY, enabled.toString());
    this.appState.update(s => ({ ...s, autoDescribe: enabled }));
  }

  setShowWelcome(enabled: boolean) {
    safeStorage.setItem(this.WELCOME_KEY, enabled.toString());
    this.appState.update(s => ({ ...s, showWelcome: enabled }));
  }

  setScreenCurtain(enabled: boolean) {
    safeStorage.setItem(this.CURTAIN_KEY, enabled.toString());
    this.appState.update(s => ({ ...s, screenCurtain: enabled }));
  }

  setActivationDialog(show: boolean) {
    this.appState.update(s => ({ ...s, showActivationDialog: show }));
  }

  applyPreset(type: 'default' | 'screen-reader') {
    if (type === 'screen-reader') {
      this.setModifierKey('shift-alt');
    } else {
      this.setModifierKey('alt');
    }
    this.setShowWelcome(false);
  }

  updateLocation(lat: number, lng: number, imageId?: string | null, canonicalNodeId?: string, status: 'ok' | 'path_only' = 'ok') {
    console.log('Location update: node=', canonicalNodeId, 'image=', imageId, 'status=', status);
    this.appState.update(s => ({
      ...s,
      location: { lat, lng, imageId: imageId ?? null, canonicalNodeId, status }
    }));
  }

  updateHeading(delta: number) {
    this.appState.update(s => {
      let newHeading = (s.heading + delta) % 360;
      if (newHeading < 0) newHeading += 360;
      return { ...s, heading: newHeading };
    });
  }

  setHeading(heading: number) {
    const newHeading = (heading + 360) % 360;
    this.appState.update(s => ({ ...s, heading: newHeading }));
  }

  setMetadata(data: Partial<Pick<AppState, 'address' | 'description' | 'adjacentNodes' | 'nearbyPOIs'>>) {
    this.appState.update(s => ({ ...s, ...data }));
  }

  setImage(image: string | null) {
    this.appState.update(s => ({ ...s, currentImage: image }));
  }

  addChatMessage(role: 'user' | 'assistant', content: string) {
    const newMessage: ChatMessage = { role, content, timestamp: new Date() };
    this.appState.update(s => ({
      ...s,
      chatHistory: [...s.chatHistory, newMessage]
    }));
  }

  setLoading(isLoading: boolean) {
    this.appState.update(s => ({ ...s, isLoading }));
  }

  getHotkeyString(key: string): string {
    const mod = this.appState().modifierKey;
    let modStr = '';
    if (mod === 'ctrl') modStr = 'Ctrl';
    else if (mod === 'alt') modStr = 'Alt';
    else if (mod === 'meta') modStr = 'Cmd';
    else if (mod === 'shift-ctrl') modStr = 'Ctrl+Shift';
    else if (mod === 'shift-alt') modStr = 'Alt+Shift';
    else if (mod === 'shift-meta') modStr = 'Cmd+Shift';
    
    return `${modStr}+${key.toUpperCase()}`;
  }

  formatHeadingValue(degrees: number): string {
    const mode = this.appState().orientationDisplayMode;
    const cardinal = this.getCardinalDirection(degrees);
    const degStr = `${Math.round(degrees)}°`;

    if (mode === 'degrees') return degStr;
    if (mode === 'headings') return cardinal;
    return `${cardinal} (${degStr})`;
  }

  private getCardinalDirection(degrees: number): string {
    const directions = ['North', 'North East', 'East', 'South East', 'South', 'South West', 'West', 'North West'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
  }
}
